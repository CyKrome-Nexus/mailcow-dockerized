<?php
/**
 * CyKrome Workspaces — Mailbox View Controller
 * Integrates directly with MariaDB quota tables and Dovecot IMAP.
 */

require_once $_SERVER['DOCUMENT_ROOT'] . '/inc/prerequisites.inc.php';
require_once $_SERVER['DOCUMENT_ROOT'] . '/inc/triggers.user.inc.php';

// Allow any authenticated role to access mailbox
protect_route(['user', 'admin', 'domainadmin']);

require_once $_SERVER['DOCUMENT_ROOT'] . '/inc/header.inc.php';
$_SESSION['return_to'] = $_SERVER['REQUEST_URI'];

$role = $_SESSION['mailcow_cc_role'] ?? 'user';
$session_username = $_SESSION['mailcow_cc_username'] ?? 'user@cykrome.com';
$is_admin = ($role === 'admin' || $role === 'domainadmin');

$all_mailboxes = [];
$target_mailbox = null;

if ($is_admin) {
  // Retrieve mailboxes accessible by this administrator
  global $pdo;
  if ($role === 'admin') {
    $stmt = $pdo->query("
      SELECT username, name, domain, quota
      FROM mailbox
      WHERE (kind = '' OR kind IS NULL) AND active = '1'
      ORDER BY username ASC
    ");
    $all_mailboxes = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
  } else {
    $stmt = $pdo->prepare("
      SELECT username, name, domain, quota
      FROM mailbox
      WHERE (kind = '' OR kind IS NULL)
        AND active = '1'
        AND domain IN (SELECT domain FROM domain_admins WHERE active = '1' AND username = :admin)
      ORDER BY username ASC
    ");
    $stmt->execute([':admin' => $session_username]);
    $all_mailboxes = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
  }

  // Determine which mailbox the admin is viewing
  $requested_user = $_GET['user'] ?? $_SESSION['mailbox_target_user'] ?? null;
  if (!empty($requested_user)) {
    foreach ($all_mailboxes as $mb) {
      if ($mb['username'] === $requested_user) {
        $target_mailbox = $requested_user;
        break;
      }
    }
  }

  if (empty($target_mailbox) && !empty($all_mailboxes)) {
    $target_mailbox = $all_mailboxes[0]['username'];
  }
  if (!empty($target_mailbox)) {
    $_SESSION['mailbox_target_user'] = $target_mailbox;
  }
} else {
  // Regular mailbox user
  $target_mailbox = $session_username;
}

// ----------------------------------------------------
// Real Quota & Storage Calculation from MariaDB
// ----------------------------------------------------
$display_name = 'User';
$percent_used = 0;
$storage_text = '0 MB of Unlimited used';
$messages_count = 0;

if (!empty($target_mailbox)) {
  global $pdo;
  $stmt = $pdo->prepare("
    SELECT m.username, m.name, m.quota, q.bytes, q.messages
    FROM mailbox m
    LEFT JOIN quota2 q ON m.username = q.username
    WHERE m.username = :user
    LIMIT 1
  ");
  $stmt->execute([':user' => $target_mailbox]);
  $mb_row = $stmt->fetch(PDO::FETCH_ASSOC);

  if ($mb_row) {
    if (!empty($mb_row['name'])) {
      $display_name = $mb_row['name'];
    } else {
      $parts = explode('@', $target_mailbox);
      $display_name = ucfirst($parts[0]);
    }

    $quota = intval($mb_row['quota'] ?? 0);
    $bytes = intval($mb_row['bytes'] ?? 0);
    $messages_count = intval($mb_row['messages'] ?? 0);

    // Format helper
    $format_size = function($b) {
      if ($b < 1048576) {
        return round($b / 1024, 1) . ' KB';
      } elseif ($b < 1073741824) {
        return round($b / 1048576, 1) . ' MB';
      } else {
        return round($b / 1073741824, 2) . ' GB';
      }
    };

    if ($quota > 0) {
      $percent_used = min(100, max(0, round(($bytes / $quota) * 100)));
      $used_str = $format_size($bytes);
      $quota_str = $format_size($quota);
      $storage_text = "{$used_str} of {$quota_str} used";
    } else {
      // 0 represents Unlimited in mailcow
      $percent_used = ($bytes > 0) ? min(100, max(1, round(($bytes / (50 * 1024 * 1024 * 1024)) * 100))) : 0;
      if ($bytes === 0) {
        $storage_text = '0 MB of Unlimited used';
      } else {
        $used_str = $format_size($bytes);
        $storage_text = "{$used_str} of Unlimited used";
      }
    }
  } else {
    $display_name = ucfirst(explode('@', $target_mailbox)[0]);
  }
} else {
  $display_name = ucfirst($session_username);
  $storage_text = 'No mailbox configured';
}

// Compute initials
$words = explode(' ', trim($display_name));
$initials = '';
foreach ($words as $w) {
  if (!empty($w)) {
    $initials .= strtoupper(mb_substr($w, 0, 1));
  }
}
if (empty($initials)) {
  $initials = strtoupper(substr($target_mailbox ?: $session_username, 0, 2));
}

// Avatar URL if configured and uploaded
$avatar_url = null;
global $avatar_r2_public_domain;
if (!empty($avatar_r2_public_domain) && !empty($target_mailbox) && !empty($mb_row['attributes'])) {
  $attrs = is_array($mb_row['attributes']) ? $mb_row['attributes'] : json_decode($mb_row['attributes'], true);
  if (!empty($attrs['avatar_updated_at'])) {
    $hash = md5(strtolower(trim($target_mailbox)));
    $avatar_url = "https://{$avatar_r2_public_domain}/avatars/{$hash}.webp?v=" . $attrs['avatar_updated_at'];
  }
}

$template = 'mailbox_app.twig';
$template_data = [
  'username' => $target_mailbox ?: $session_username,
  'session_username' => $session_username,
  'role' => $role,
  'is_admin' => $is_admin,
  'all_mailboxes' => $all_mailboxes,
  'display_name' => $display_name,
  'initials' => substr($initials, 0, 2),
  'avatar_url' => $avatar_url,
  'percent_used' => $percent_used,
  'storage_text' => $storage_text,
  'messages_count' => $messages_count,
  'csrf_token' => $_SESSION['CSRF']['TOKEN'] ?? '',
];

require_once $_SERVER['DOCUMENT_ROOT'] . '/inc/footer.inc.php';
