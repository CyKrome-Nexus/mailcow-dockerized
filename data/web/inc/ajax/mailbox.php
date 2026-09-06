<?php
/**
 * CyKrome Workspaces — Mailbox Backend AJAX API
 * Handles real-time Dovecot IMAP synchronization, Postfix SMTP dispatch,
 * and dynamic MariaDB quota & storage calculations.
 */

require_once $_SERVER['DOCUMENT_ROOT'] . '/inc/prerequisites.inc.php';

header('Content-Type: application/json; charset=utf-8');

function api_response($success, $data = [], $msg = '', $status = 200) {
  http_response_code($status);
  $out = array_merge([
    'success' => $success,
    'msg' => $msg,
    'csrf_token' => $_SESSION['CSRF']['TOKEN'] ?? ''
  ], $data);
  echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit();
}

// 1. Authentication check
if (!isset($_SESSION['mailcow_cc_role']) || !in_array($_SESSION['mailcow_cc_role'], ['user', 'admin', 'domainadmin'])) {
  api_response(false, [], 'Unauthorized', 401);
}

$role = $_SESSION['mailcow_cc_role'];
$session_user = $_SESSION['mailcow_cc_username'];

// 2. Resolve target mailbox
$target_user = null;
if ($role === 'user') {
  $target_user = $session_user;
} else {
  // Admin or Domain Admin can inspect specific mailbox
  $requested_user = $_GET['user'] ?? $_POST['user'] ?? $_SESSION['mailbox_target_user'] ?? null;
  if (!empty($requested_user) && hasMailboxObjectAccess($session_user, $role, $requested_user)) {
    $target_user = $requested_user;
  } else {
    // Find first accessible active mailbox
    $all_mailboxes = mailbox('get', 'mailboxes');
    if (!empty($all_mailboxes) && is_array($all_mailboxes)) {
      $target_user = $all_mailboxes[0];
    }
  }
  if (!empty($target_user)) {
    $_SESSION['mailbox_target_user'] = $target_user;
  }
}

if (empty($target_user)) {
  api_response(false, [], 'No accessible mailbox found on this system.', 404);
}

// 3. Helper: Dovecot IMAP Connection
function get_imap_mbox($target_user, $folder = 'INBOX') {
  $creds_file = '/etc/sogo/sieve.creds';
  if (!file_exists($creds_file)) {
    return false;
  }
  $content = trim(file_get_contents($creds_file));
  if (strpos($content, ':') === false) {
    return false;
  }
  list($master_user, $master_pass) = explode(':', $content, 2);
  $auth_user = $target_user . '*' . trim($master_user);
  $server = '{dovecot:993/imap/ssl/novalidate-cert}' . $folder;
  $mbox = @imap_open($server, $auth_user, trim($master_pass), 0, 1, ['DISABLE_AUTHENTICATOR' => 'GSSAPI']);
  return $mbox;
}

// Map frontend folder identifiers to Dovecot standard IMAP mailboxes
function map_folder($f) {
  $f = strtolower(trim($f));
  switch ($f) {
    case 'inbox': return 'INBOX';
    case 'sent': return 'Sent';
    case 'drafts': return 'Drafts';
    case 'archive': return 'Archive';
    case 'trash': return 'Trash';
    case 'spam':
    case 'junk': return 'Junk';
    default: return 'INBOX';
  }
}

// 4. Helper: Storage and Quota calculation from MariaDB
function get_real_storage($target_user) {
  global $pdo;
  $stmt = $pdo->prepare("
    SELECT m.username, m.name, m.quota, q.bytes, q.messages
    FROM mailbox m
    LEFT JOIN quota2 q ON m.username = q.username
    WHERE m.username = :user
    LIMIT 1
  ");
  $stmt->execute([':user' => $target_user]);
  $row = $stmt->fetch(PDO::FETCH_ASSOC);

  $quota = intval($row['quota'] ?? 0);
  $bytes = intval($row['bytes'] ?? 0);
  $messages = intval($row['messages'] ?? 0);

  $percent_used = 0;
  $storage_text = '0 MB of Unlimited used';

  if ($quota > 0) {
    $percent_used = min(100, max(0, round(($bytes / $quota) * 100)));
    $used_fmt = format_bytes($bytes);
    $quota_fmt = format_bytes($quota);
    $storage_text = "{$used_fmt} of {$quota_fmt} used";
  } else {
    $percent_used = ($bytes > 0) ? min(100, max(1, round(($bytes / (50 * 1024 * 1024 * 1024)) * 100))) : 0;
    if ($bytes === 0) {
      $storage_text = '0 MB of Unlimited used';
    } else {
      $used_fmt = format_bytes($bytes);
      $storage_text = "{$used_fmt} of Unlimited used";
    }
  }

  return [
    'bytes' => $bytes,
    'quota' => $quota,
    'messages' => $messages,
    'percent' => $percent_used,
    'text' => $storage_text,
  ];
}

function format_bytes($bytes) {
  if ($bytes < 1024 * 1024) {
    return round($bytes / 1024, 1) . ' KB';
  } elseif ($bytes < 1024 * 1024 * 1024) {
    return round($bytes / (1024 * 1024), 1) . ' MB';
  } else {
    return round($bytes / (1024 * 1024 * 1024), 2) . ' GB';
  }
}

// 5. Helper: MIME decode string
function decode_mime($str) {
  if (empty($str)) return '';
  $decoded = @iconv_mime_decode($str, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
  if ($decoded === false || empty($decoded)) {
    $decoded = imap_utf8($str);
  }
  return $decoded ?: $str;
}

// 6. Helper: Pleasant avatar colors
function get_avatar_color($seed) {
  $palette = [
    '#7c6cf0', '#22b8c4', '#d97706', '#c2410c', '#4f7df3',
    '#e05f8a', '#10b981', '#6366f1', '#06b6d4', '#f59e0b'
  ];
  $hash = crc32(strtolower(trim($seed)));
  return $palette[abs($hash) % count($palette)];
}

// 6b. Helper: Domains hosted on this mailcow instance, for external-sender
// detection (Outlook/Gmail-style "this message is from an external
// sender" banner). Cached for the life of the request.
function get_hosted_domains() {
  static $domains = null;
  if ($domains !== null) return $domains;

  global $pdo;
  $domains = [];
  $stmt = $pdo->query("SELECT `domain` FROM `domain` WHERE `active` = '1'");
  foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $d) {
    $domains[] = strtolower($d);
  }
  $stmt = $pdo->query("SELECT `alias_domain` FROM `alias_domain` WHERE `active` = '1'");
  foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $d) {
    $domains[] = strtolower($d);
  }
  return $domains;
}

// Is this sender address external to the organization (i.e. not on any
// domain hosted by this mailcow instance)?
function is_external_sender($sender_email) {
  $sender_email = strtolower(trim($sender_email));
  if (empty($sender_email) || strpos($sender_email, '@') === false) {
    return true;
  }
  $sender_domain = substr(strrchr($sender_email, '@'), 1);
  return !in_array($sender_domain, get_hosted_domains(), true);
}

// 6c. Helper: Block remote (http/https) images in HTML email bodies —
// mirrors Outlook/Gmail's default of not auto-loading remote images from
// untrusted senders (prevents tracking pixels and reduces exposure to
// image-parser/SSRF-style abuse). Returns [$html, $blocked_count].
// Inline data: images are left untouched since they don't phone home.
function block_remote_images($html) {
  $blocked = 0;
  $result = preg_replace_callback(
    '#<img\b([^>]*?)\bsrc\s*=\s*(["\'])\s*(https?:)([^"\']*)\2([^>]*)>#is',
    function ($m) use (&$blocked) {
      $blocked++;
      $remote_url = htmlspecialchars($m[3] . $m[4], ENT_QUOTES, 'UTF-8');
      return '<img' . $m[1] . 'src="" data-blocked-src="' . $remote_url . '"' . $m[5] . '>';
    },
    $html
  );
  return [$result !== null ? $result : $html, $blocked];
}

// 6d. Helper: SPF/DKIM/DMARC authentication status, read from the
// Authentication-Results header Rspamd stamps on every inbound message
// (data/conf/rspamd/local.d/milter_headers.conf, "authentication-results"
// routine). That routine runs with remove = 1, meaning Rspamd strips any
// Authentication-Results header already present on the incoming message
// before adding its own — so a sender cannot forge this header to make a
// spoofed message appear authenticated; the header present on a stored
// message is always the one our own filtering added.
function get_auth_results($mbox, $msgno) {
  $result = ['spf' => null, 'dkim' => null, 'dmarc' => null];
  $raw = @imap_fetchheader($mbox, $msgno);
  if (!$raw) return $result;

  // Unfold header continuation lines (RFC 5322 folding) before matching.
  $unfolded = preg_replace('/\r\n[ \t]+/', ' ', $raw);
  if (preg_match('/^Authentication-Results:\s*(.+)$/mi', $unfolded, $m)) {
    $line = $m[1];
    if (preg_match('/\bspf=([a-z]+)/i', $line, $mm)) $result['spf'] = strtolower($mm[1]);
    if (preg_match('/\bdkim=([a-z]+)/i', $line, $mm)) $result['dkim'] = strtolower($mm[1]);
    if (preg_match('/\bdmarc=([a-z]+)/i', $line, $mm)) $result['dmarc'] = strtolower($mm[1]);
  }
  return $result;
}

// True when authentication clearly failed and the sender's domain should
// not be trusted: DMARC policy explicitly rejected/quarantined the
// message, or both SPF and DKIM failed outright.
function is_auth_failed($auth) {
  if (in_array($auth['dmarc'], ['reject', 'quarantine'], true)) {
    return true;
  }
  if ($auth['spf'] === 'fail' && $auth['dkim'] === 'fail') {
    return true;
  }
  return false;
}

// 7. Helper: Format timestamp relative to now
function format_imap_date($timestamp) {
  if (!$timestamp) return '';
  $now = time();
  $today_start = strtotime('today midnight');
  $yesterday_start = strtotime('yesterday midnight');

  if ($timestamp >= $today_start) {
    return date('g:i A', $timestamp);
  } elseif ($timestamp >= $yesterday_start) {
    return 'Yesterday';
  } elseif ($timestamp >= ($today_start - 6 * 86400)) {
    return date('D', $timestamp);
  } elseif (date('Y', $timestamp) === date('Y', $now)) {
    return date('M j', $timestamp);
  } else {
    return date('M j, Y', $timestamp);
  }
}

// 8. Helper: Parse message body & parts
function decode_part_content($data, $encoding, $params = []) {
  if ($encoding === 3) {
    $data = base64_decode($data);
  } elseif ($encoding === 4) {
    $data = quoted_printable_decode($data);
  }

  // Handle charset conversion to UTF-8
  $charset = 'UTF-8';
  if (!empty($params)) {
    foreach ($params as $p) {
      if (strtolower($p->attribute ?? '') === 'charset') {
        $charset = strtoupper($p->value ?? 'UTF-8');
        break;
      }
    }
  }
  if ($charset !== 'UTF-8' && $charset !== 'US-ASCII') {
    $converted = @iconv($charset, 'UTF-8//IGNORE', $data);
    if ($converted !== false) {
      $data = $converted;
    }
  }

  return $data;
}

function get_message_body_content($mbox, $msgno) {
  $structure = @imap_fetchstructure($mbox, $msgno);
  if (!$structure) {
    $raw = @imap_body($mbox, $msgno);
    return ['html' => '', 'plain' => $raw ?: ''];
  }

  if (empty($structure->parts)) {
    $raw = @imap_body($mbox, $msgno);
    $decoded = decode_part_content($raw, $structure->encoding, $structure->parameters ?? []);
    if (strtolower($structure->subtype ?? '') === 'html') {
      return ['html' => $decoded, 'plain' => strip_tags($decoded)];
    } else {
      return ['html' => '', 'plain' => $decoded];
    }
  }

  $html = '';
  $plain = '';
  extract_parts_recursive($mbox, $msgno, $structure, '', $html, $plain);
  return ['html' => $html, 'plain' => $plain];
}

function extract_parts_recursive($mbox, $msgno, $part, $prefix, &$html, &$plain) {
  if (!empty($part->parts)) {
    foreach ($part->parts as $idx => $sub) {
      $partNum = $prefix ? ($prefix . '.' . ($idx + 1)) : ($idx + 1);
      extract_parts_recursive($mbox, $msgno, $sub, $partNum, $html, $plain);
    }
  } else {
    $partNum = $prefix ?: 1;
    $data = @imap_fetchbody($mbox, $msgno, $partNum);
    $decoded = decode_part_content($data, $part->encoding, $part->parameters ?? []);
    $subtype = strtolower($part->subtype ?? '');
    if ($subtype === 'html' && empty($html)) {
      $html = $decoded;
    } elseif ($subtype === 'plain' && empty($plain)) {
      $plain = $decoded;
    }
  }
}

// 9. Helper: Best-effort pre-filter for remote email HTML.
// This is defense-in-depth only, NOT the security boundary: remote HTML
// is fundamentally untrusted (crafted by arbitrary external senders), and
// no regex-based blacklist can safely neutralize arbitrary HTML/CSS/SVG.
// The actual boundary is the script-less sandboxed <iframe> the frontend
// renders this markup into (see renderSandboxedEmailBody in
// mailbox_app.js), which has no allow-scripts/allow-same-origin and thus
// cannot execute script or touch the parent session regardless of what
// slips through this filter.
function sanitize_email_html($dirty_html) {
  if (empty($dirty_html)) return '';
  // Strip dangerous tags (also matches self-closing / unclosed forms)
  $clean = preg_replace('#<script\b[^>]*>.*?</script>#is', '', $dirty_html);
  $clean = preg_replace('#<script\b[^>]*/?>#is', '', $clean);
  $clean = preg_replace('#<iframe\b[^>]*>.*?</iframe>#is', '', $clean);
  $clean = preg_replace('#<iframe\b[^>]*/?>#is', '', $clean);
  $clean = preg_replace('#<object\b[^>]*>.*?</object>#is', '', $clean);
  $clean = preg_replace('#<embed\b[^>]*/?>#is', '', $clean);
  $clean = preg_replace('#<style\b[^>]*>.*?</style>#is', '', $clean);
  $clean = preg_replace('#<link\b[^>]*/?>#is', '', $clean);
  $clean = preg_replace('#<meta\b[^>]*/?>#is', '', $clean);
  // Strip inline event handler attributes, allowing '/' or other
  // non-whitespace tag-attribute separators (e.g. "<svg/onload=...>"),
  // not just a preceding space.
  $clean = preg_replace('#[\s/]on[a-zA-Z]+\s*=\s*(".*?"|\'.*?\'|[^\s>]+)#is', '', $clean);
  // Neutralize javascript:/vbscript: URIs in href/src/action (quoted or
  // unquoted). data: is left alone for src (inline images are common in
  // email) but blocked for href/action/formaction, where a data:text/html
  // navigation could otherwise be used to smuggle a script.
  $clean = preg_replace('#\b(href|src|action|formaction)\s*=\s*(["\']?)\s*(javascript|vbscript):[^"\'\s>]*\2#is', '$1="#"', $clean);
  $clean = preg_replace('#\b(href|action|formaction)\s*=\s*(["\']?)\s*data:[^"\'\s>]*\2#is', '$1="#"', $clean);
  return $clean;
}

// Route action
$action = $_GET['action'] ?? $_POST['action'] ?? 'list';

switch ($action) {

  // ----------------------------------------------------
  // LIST EMAILS IN A FOLDER
  // ----------------------------------------------------
  case 'list':
    $folder_key = $_GET['folder'] ?? 'inbox';
    $imap_folder = map_folder($folder_key);
    $mbox = get_imap_mbox($target_user, $imap_folder);

    if (!$mbox) {
      api_response(false, ['emails' => []], 'Failed to connect to IMAP folder: ' . $imap_folder, 500);
    }

    $num_msgs = imap_num_msg($mbox);
    $emails = [];

    if ($num_msgs > 0) {
      $overviews = imap_fetch_overview($mbox, "1:{$num_msgs}");
      // Reverse order: newest first
      $overviews = array_reverse($overviews);

      foreach ($overviews as $item) {
        $subject = decode_mime($item->subject ?? '(No Subject)');
        $from_raw = $item->from ?? '';
        $from_parsed = imap_rfc822_parse_adrlist($from_raw, 'cykrome.test');
        $sender_name = '';
        $sender_email = '';
        if (!empty($from_parsed[0])) {
          $mailbox_part = $from_parsed[0]->mailbox ?? '';
          $host_part = $from_parsed[0]->host ?? '';
          $sender_email = $mailbox_part . '@' . $host_part;
          $sender_name = decode_mime($from_parsed[0]->personal ?? '');
        }
        if (empty($sender_name)) {
          $sender_name = $sender_email ?: decode_mime($from_raw);
        }

        // Initials
        $name_words = explode(' ', trim($sender_name));
        $initial = '';
        foreach ($name_words as $w) {
          if (!empty($w)) $initial .= strtoupper(mb_substr($w, 0, 1));
        }
        $initial = substr($initial, 0, 2) ?: 'EM';

        $udate = $item->udate ?? strtotime($item->date ?? 'now');
        $formatted_time = format_imap_date($udate);
        $is_unread = empty($item->seen);

        // Fetch small snippet preview
        $snippet = '';
        $body_preview = @imap_fetchbody($mbox, $item->msgno, '1', FT_PEEK);
        if ($body_preview) {
          $snippet = trim(preg_replace('/\s+/', ' ', strip_tags($body_preview)));
          if (strlen($snippet) > 85) {
            $snippet = mb_substr($snippet, 0, 85) . '…';
          }
        }
        if (empty($snippet)) {
          $snippet = $subject;
        }

        $emails[] = [
          'id' => intval($item->uid),
          'msgno' => intval($item->msgno),
          'folder' => $folder_key,
          'sender' => $sender_name,
          'emailAddr' => $sender_email,
          'subject' => $subject,
          'snippet' => $snippet,
          'time' => $formatted_time,
          'unread' => $is_unread,
          'initial' => $initial,
          'color' => get_avatar_color($sender_email),
          'date' => $item->date ?? '',
          'external' => is_external_sender($sender_email),
        ];
      }
    }

    // Compute unread and message counts for key folders
    $counts = [
      'inbox' => 0,
      'drafts' => 0,
      'spam' => 0
    ];

    $stat_inbox = @imap_status($mbox, '{dovecot:993/imap/ssl/novalidate-cert}INBOX', SA_UNSEEN);
    if ($stat_inbox) $counts['inbox'] = intval($stat_inbox->unseen);

    $stat_drafts = @imap_status($mbox, '{dovecot:993/imap/ssl/novalidate-cert}Drafts', SA_MESSAGES);
    if ($stat_drafts) $counts['drafts'] = intval($stat_drafts->messages);

    $stat_spam = @imap_status($mbox, '{dovecot:993/imap/ssl/novalidate-cert}Junk', SA_UNSEEN);
    if ($stat_spam) $counts['spam'] = intval($stat_spam->unseen);

    imap_close($mbox);

    // Compute real storage
    $storage = get_real_storage($target_user);

    api_response(true, [
      'emails' => $emails,
      'folder' => $folder_key,
      'target_user' => $target_user,
      'counts' => $counts,
      'storage' => $storage
    ]);
    break;

  // ----------------------------------------------------
  // READ FULL EMAIL BODY & MARK AS SEEN
  // ----------------------------------------------------
  case 'read':
    $folder_key = $_GET['folder'] ?? 'inbox';
    $uid = intval($_GET['uid'] ?? 0);
    if ($uid <= 0) {
      api_response(false, [], 'Invalid message UID', 400);
    }

    $imap_folder = map_folder($folder_key);
    $mbox = get_imap_mbox($target_user, $imap_folder);
    if (!$mbox) {
      api_response(false, [], 'Failed to connect to folder', 500);
    }

    $msgno = @imap_msgno($mbox, $uid);
    if (!$msgno) {
      imap_close($mbox);
      api_response(false, [], 'Message not found', 404);
    }

    // Mark as Seen in IMAP
    @imap_setflag_full($mbox, (string)$uid, "\\Seen", ST_UID);

    $header = @imap_headerinfo($mbox, $msgno);
    $subject = decode_mime($header->subject ?? '(No Subject)');
    $from_obj = $header->from[0] ?? null;
    $sender_name = $from_obj ? decode_mime($from_obj->personal ?? '') : '';
    $sender_email = $from_obj ? ($from_obj->mailbox . '@' . $from_obj->host) : '';
    if (empty($sender_name)) $sender_name = $sender_email;

    $body_data = get_message_body_content($mbox, $msgno);
    $clean_html = sanitize_email_html($body_data['html']);
    $plain_text = $body_data['plain'];

    $is_external = is_external_sender($sender_email);
    $auth = get_auth_results($mbox, $msgno);
    $auth_failed = is_auth_failed($auth);

    // Outlook/Gmail-style remote image blocking: images are only
    // auto-loaded for internal senders, or once the user explicitly opts
    // in via load_images=1 for this request.
    $load_images = !empty($_GET['load_images']) && $_GET['load_images'] == '1';
    $images_blocked = 0;
    if (!empty($clean_html) && (!$load_images && $is_external)) {
      list($clean_html, $images_blocked) = block_remote_images($clean_html);
    }

    $udate = $header->udate ?? strtotime($header->date ?? 'now');
    $formatted_time = format_imap_date($udate);

    // Name initials
    $name_words = explode(' ', trim($sender_name));
    $initial = '';
    foreach ($name_words as $w) {
      if (!empty($w)) $initial .= strtoupper(mb_substr($w, 0, 1));
    }
    $initial = substr($initial, 0, 2) ?: 'EM';

    imap_close($mbox);

    api_response(true, [
      'email' => [
        'id' => $uid,
        'folder' => $folder_key,
        'sender' => $sender_name,
        'emailAddr' => $sender_email,
        'subject' => $subject,
        'time' => $formatted_time,
        'fullDate' => $header->date ?? '',
        'unread' => false,
        'initial' => $initial,
        'color' => get_avatar_color($sender_email),
        'html' => $clean_html,
        'plain' => $plain_text,
        'external' => $is_external,
        'imagesBlocked' => $images_blocked,
        'auth' => $auth,
        'authFailed' => $auth_failed,
      ]
    ]);
    break;

  // ----------------------------------------------------
  // SEND MESSAGE VIA SMTP & APPEND TO SENT FOLDER
  // ----------------------------------------------------
  case 'send':
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
      api_response(false, [], 'Method not allowed', 405);
    }

    $to = trim($_POST['to'] ?? '');
    $subject = trim($_POST['subject'] ?? '');
    $body = trim($_POST['body'] ?? '');

    if (empty($to) || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
      api_response(false, [], 'Please provide a valid recipient email address.', 400);
    }
    if (empty($subject)) {
      $subject = '(No Subject)';
    }

    // Query sender display name
    global $pdo;
    $stmt = $pdo->prepare("SELECT name FROM mailbox WHERE username = :user LIMIT 1");
    $stmt->execute([':user' => $target_user]);
    $sender_display = $stmt->fetchColumn() ?: $target_user;

    // Build standard MIME message
    $date = date('r');
    $msg_id = '<' . time() . '.' . bin2hex(random_bytes(6)) . '@cykrome.test>';
    $raw_message = "From: {$sender_display} <{$target_user}>\r\n" .
                   "To: {$to}\r\n" .
                   "Subject: =?UTF-8?B?" . base64_encode($subject) . "?=\r\n" .
                   "Date: {$date}\r\n" .
                   "Message-ID: {$msg_id}\r\n" .
                   "MIME-Version: 1.0\r\n" .
                   "Content-Type: text/html; charset=UTF-8\r\n" .
                   "Content-Transfer-Encoding: 8bit\r\n\r\n" .
                   nl2br(htmlspecialchars($body, ENT_QUOTES, 'UTF-8'));

    // Deliver via Postfix SMTP on internal Docker network
    $smtp = @fsockopen('postfix', 25, $errno, $errstr, 10);
    if (!$smtp) {
      api_response(false, [], "Failed to connect to mail transport: {$errstr}", 500);
    }

    // SMTP handshakes
    $resp = fgets($smtp);
    fputs($smtp, "EHLO cykrome.test\r\n");
    while ($line = fgets($smtp)) {
      if (substr($line, 3, 1) === ' ') break;
    }

    fputs($smtp, "MAIL FROM:<{$target_user}>\r\n");
    $resp = fgets($smtp);
    fputs($smtp, "RCPT TO:<{$to}>\r\n");
    $resp = fgets($smtp);
    fputs($smtp, "DATA\r\n");
    $resp = fgets($smtp);

    fputs($smtp, $raw_message . "\r\n.\r\n");
    $resp = fgets($smtp);
    fputs($smtp, "QUIT\r\n");
    fclose($smtp);

    // Also append copy to user's Sent IMAP folder
    $mbox_sent = get_imap_mbox($target_user, 'Sent');
    if ($mbox_sent) {
      @imap_append($mbox_sent, '{dovecot:993/imap/ssl/novalidate-cert}Sent', $raw_message, "\\Seen");
      imap_close($mbox_sent);
    }

    api_response(true, [], 'Email sent successfully');
    break;

  // ----------------------------------------------------
  // DELETE MESSAGE (MOVE TO TRASH / EXPUNGE)
  // ----------------------------------------------------
  case 'delete':
    $folder_key = $_POST['folder'] ?? 'inbox';
    $uid = intval($_POST['uid'] ?? 0);
    if ($uid <= 0) {
      api_response(false, [], 'Invalid UID', 400);
    }

    $imap_folder = map_folder($folder_key);
    $mbox = get_imap_mbox($target_user, $imap_folder);
    if (!$mbox) {
      api_response(false, [], 'Failed to connect to folder', 500);
    }

    if (strtolower($imap_folder) === 'trash') {
      @imap_delete($mbox, (string)$uid, FT_UID);
      @imap_expunge($mbox);
    } else {
      @imap_mail_move($mbox, (string)$uid, 'Trash', CP_UID);
      @imap_expunge($mbox);
    }
    imap_close($mbox);

    api_response(true, [], 'Message moved to Trash');
    break;

  // ----------------------------------------------------
  // ARCHIVE MESSAGE
  // ----------------------------------------------------
  case 'archive':
    $folder_key = $_POST['folder'] ?? 'inbox';
    $uid = intval($_POST['uid'] ?? 0);
    if ($uid <= 0) {
      api_response(false, [], 'Invalid UID', 400);
    }

    $imap_folder = map_folder($folder_key);
    $mbox = get_imap_mbox($target_user, $imap_folder);
    if (!$mbox) {
      api_response(false, [], 'Failed to connect to folder', 500);
    }

    @imap_mail_move($mbox, (string)$uid, 'Archive', CP_UID);
    @imap_expunge($mbox);
    imap_close($mbox);

    api_response(true, [], 'Message archived');
    break;

  // ----------------------------------------------------
  // MARK AS UNREAD / READ
  // ----------------------------------------------------
  case 'mark_unread':
    $folder_key = $_POST['folder'] ?? 'inbox';
    $uid = intval($_POST['uid'] ?? 0);
    $imap_folder = map_folder($folder_key);
    $mbox = get_imap_mbox($target_user, $imap_folder);
    if ($mbox) {
      @imap_clearflag_full($mbox, (string)$uid, "\\Seen", ST_UID);
      imap_close($mbox);
    }
    api_response(true, [], 'Marked as unread');
    break;

  // ----------------------------------------------------
  // SEND WELCOME / TEST MESSAGE (Convenience for empty inboxes)
  // ----------------------------------------------------
  case 'send_welcome':
    $to = $target_user;
    $date = date('r');
    $msg_id = '<welcome.' . time() . '@cykrome.test>';
    $raw_message = "From: CyKrome Workspaces <noreply@cykrome.test>\r\n" .
                   "To: <{$to}>\r\n" .
                   "Subject: =?UTF-8?B?" . base64_encode("Welcome to your CyKrome Workspace Mailbox") . "?=\r\n" .
                   "Date: {$date}\r\n" .
                   "Message-ID: {$msg_id}\r\n" .
                   "MIME-Version: 1.0\r\n" .
                   "Content-Type: text/html; charset=UTF-8\r\n" .
                   "Content-Transfer-Encoding: 8bit\r\n\r\n" .
                   "<div style='font-family: -apple-system, BlinkMacSystemFont, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px;'>" .
                   "<h2 style='color: #6366f1; margin-top: 0;'>Welcome to your CyKrome Workspace Mailbox</h2>" .
                   "<p>Your email account <strong>{$to}</strong> is fully active and synchronizing live with the Dovecot IMAP and Postfix mail servers.</p>" .
                   "<p>This client is 100% connected to your real mail server:</p>" .
                   "<ul>" .
                   "<li><strong>Real IMAP Folders</strong>: Inbox, Sent, Drafts, Archive, Trash, and Spam.</li>" .
                   "<li><strong>Exact Quota Tracking</strong>: Live storage calculations from MariaDB quota tables.</li>" .
                   "<li><strong>Full Compose & Reply</strong>: Messages dispatched instantly over local SMTP.</li>" .
                   "</ul>" .
                   "<p>Feel free to compose messages, organize folders, or customize your accent appearance.</p>" .
                   "<hr style='border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;' />" .
                   "<p style='font-size: 12px; color: #64748b;'>CyKrome Workspaces · Enterprise Mail Infrastructure</p>" .
                   "</div>";

    $smtp = @fsockopen('postfix', 25, $errno, $errstr, 10);
    if ($smtp) {
      fgets($smtp);
      fputs($smtp, "EHLO cykrome.test\r\n");
      while ($line = fgets($smtp)) {
        if (substr($line, 3, 1) === ' ') break;
      }
      fputs($smtp, "MAIL FROM:<noreply@cykrome.test>\r\n");
      fgets($smtp);
      fputs($smtp, "RCPT TO:<{$to}>\r\n");
      fgets($smtp);
      fputs($smtp, "DATA\r\n");
      fgets($smtp);
      fputs($smtp, $raw_message . "\r\n.\r\n");
      fgets($smtp);
      fputs($smtp, "QUIT\r\n");
      fclose($smtp);
      api_response(true, [], 'Welcome message delivered to inbox');
    } else {
      api_response(false, [], 'Could not connect to SMTP server', 500);
    }
    break;

  default:
    api_response(false, [], 'Unknown action', 400);
}
