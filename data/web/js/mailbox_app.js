/**
 * CyKrome Workspaces — Mailbox Client Logic
 * Real-time asynchronous synchronization with Dovecot IMAP and Postfix SMTP.
 */

(function () {
  'use strict';

  var ACCENTS = {
    violet: { hex: '#8b5cf6', soft: '#a78bfa', glow: 'rgba(139,92,246,0.35)', glowStrong: 'rgba(139,92,246,0.55)' },
    cyan:   { hex: '#06b6d4', soft: '#22d3ee', glow: 'rgba(34,211,238,0.32)',  glowStrong: 'rgba(34,211,238,0.5)' },
    amber:  { hex: '#f59e0b', soft: '#fbbf24', glow: 'rgba(245,158,11,0.32)',  glowStrong: 'rgba(245,158,11,0.5)' }
  };

  // Read context config
  var configEl = document.getElementById('mailbox-config');
  var targetUser = configEl ? configEl.getAttribute('data-user') : '';
  var csrfToken = configEl ? configEl.getAttribute('data-csrf') : '';

  var savedReadNotifs = [];
  try {
    savedReadNotifs = JSON.parse(localStorage.getItem('mailcow_read_notifs') || '[]');
  } catch (e) {
    savedReadNotifs = [];
  }

  var state = {
    emails: [],
    activeFolder: 'inbox',
    searchQuery: '',
    filterLabel: null,
    selectedId: null,
    selectedDetail: null,
    menuOpen: false,
    notificationsOpen: false,
    readNotificationIds: savedReadNotifs,
    storageInfo: null,
    counts: null,
    accent: 'violet',
    loading: false
  };

  // DOM Elements
  var emailListEl = document.getElementById('mailbox-email-list');
  var readingPaneEl = document.getElementById('mailbox-reading-pane');
  var searchInput = document.getElementById('mailbox-search');
  var folderTitleEl = document.getElementById('mailbox-folder-title');
  var accountMenuEl = document.getElementById('mailbox-account-menu');
  var accountBtn = document.getElementById('mailbox-avatar-btn');
  var notifBtn = document.getElementById('mailbox-notifications-btn');
  var notifBadge = document.getElementById('mailbox-notifications-badge');
  var notifMenuEl = document.getElementById('mailbox-notifications-menu');
  var notifListEl = document.getElementById('mailbox-notifications-list');
  var notifMarkAllBtn = document.getElementById('mailbox-notifications-mark-all');
  var composeOverlay = document.getElementById('mailbox-compose-overlay');
  var composeBtn = document.getElementById('mailbox-compose-btn');
  var composeCloseBtn = document.getElementById('mailbox-compose-close');
  var composeDiscardBtn = document.getElementById('mailbox-compose-discard');
  var composeSendBtn = document.getElementById('mailbox-compose-send');
  var refreshBtn = document.getElementById('mailbox-refresh-btn');
  var listRefreshBtn = document.getElementById('mailbox-list-refresh');
  var toastEl = document.getElementById('mailbox-toast');

  // Storage DOM
  var storageBarFill = document.getElementById('mailbox-storage-bar-fill');
  var storageText = document.getElementById('mailbox-storage-text');

  // Count DOM
  var countInboxEl = document.getElementById('count-inbox');
  var countDraftsEl = document.getElementById('count-drafts');
  var countSpamEl = document.getElementById('count-spam');

  // --------------------------------------------------
  // Notification Toast
  // --------------------------------------------------
  var toastTimer = null;
  function showToast(message, type) {
    if (!toastEl) return;
    type = type || 'success';
    toastEl.className = 'mailbox-toast ' + type + ' show';
    toastEl.textContent = message;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 3200);
  }

  // --------------------------------------------------
  // Accent System
  // --------------------------------------------------
  function applyAccent(key) {
    state.accent = key;
    var data = ACCENTS[key] || ACCENTS.violet;
    if (key === 'violet') {
      document.documentElement.removeAttribute('data-accent');
    } else {
      document.documentElement.setAttribute('data-accent', key);
    }
    document.documentElement.style.setProperty('--accent', data.hex);
    document.documentElement.style.setProperty('--accent-soft', data.soft);
    document.documentElement.style.setProperty('--accent-glow', data.glow);
    document.documentElement.style.setProperty('--accent-glow-strong', data.glowStrong);

    try { localStorage.setItem('mailcow_accent', key); } catch (e) {}

    document.querySelectorAll('.mailbox-swatch-btn').forEach(function (btn) {
      if (btn.getAttribute('data-accent-val') === key) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // --------------------------------------------------
  // Helper: Escape HTML
  // --------------------------------------------------
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --------------------------------------------------
  // Fetch Real Emails from Dovecot IMAP
  // --------------------------------------------------
  function loadFolder(folder, keepSelected) {
    state.activeFolder = folder;
    state.filterLabel = null;
    state.loading = true;

    if (!keepSelected) {
      state.selectedId = null;
      state.selectedDetail = null;
    }

    emailListEl.innerHTML =
      '<div class="mailbox-loading-state">' +
        '<div class="mailbox-spinner"></div>' +
        '<span>Synchronizing with Dovecot IMAP…</span>' +
      '</div>';

    var url = '/inc/ajax/mailbox.php?action=list&folder=' + encodeURIComponent(folder) +
              '&user=' + encodeURIComponent(targetUser);

    fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        state.loading = false;
        if (!data.success) {
          emailListEl.innerHTML =
            '<div class="mailbox-empty-state">' +
              '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' +
              '<p style="color: #ef4444;">' + escapeHtml(data.msg || 'Unable to connect to mailbox') + '</p>' +
            '</div>';
          return;
        }

        if (data.csrf_token) {
          csrfToken = data.csrf_token;
        }

        state.emails = data.emails || [];

        // Update counts
        if (data.counts) {
          if (countInboxEl) countInboxEl.textContent = data.counts.inbox > 0 ? data.counts.inbox : '';
          if (countDraftsEl) countDraftsEl.textContent = data.counts.drafts > 0 ? data.counts.drafts : '';
          if (countSpamEl) countSpamEl.textContent = data.counts.spam > 0 ? data.counts.spam : '';
        }

        // Update live storage
        if (data.storage) {
          state.storageInfo = data.storage;
          if (storageBarFill) storageBarFill.style.width = data.storage.percent + '%';
          if (storageText) storageText.textContent = data.storage.text;
        }

        renderList();
        renderNotifications();

        // Automatically select first email if exists
        if (state.emails.length > 0) {
          var targetId = keepSelected && state.selectedId ? state.selectedId : state.emails[0].id;
          selectEmail(targetId);
        } else {
          renderReadingPane(null);
        }
      })
      .catch(function (err) {
        state.loading = false;
        emailListEl.innerHTML =
          '<div class="mailbox-empty-state">' +
            '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.6"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' +
            '<p style="color: #ef4444;">Network connection error</p>' +
          '</div>';
      });
  }

  // --------------------------------------------------
  // Fetch Single Message Detail from IMAP
  // --------------------------------------------------
  function selectEmail(uid, loadImages) {
    state.selectedId = uid;

    // Highlight row in list
    document.querySelectorAll('.mailbox-email-row').forEach(function (row) {
      if (parseInt(row.getAttribute('data-id'), 10) === uid) {
        row.classList.add('selected');
        // Visually mark as read
        row.classList.remove('unread');
        var dot = row.querySelector('.mailbox-unread-dot');
        if (dot) {
          dot.className = 'mailbox-star-spacer';
        }
      } else {
        row.classList.remove('selected');
      }
    });

    // Update local email state
    var localMsg = state.emails.find(function (e) { return e.id === uid; });
    if (localMsg && localMsg.unread) {
      localMsg.unread = false;
      var notifKey = 'email_' + uid;
      if (state.readNotificationIds.indexOf(notifKey) === -1) {
        state.readNotificationIds.push(notifKey);
        try { localStorage.setItem('mailcow_read_notifs', JSON.stringify(state.readNotificationIds)); } catch (e) {}
      }
      if (state.activeFolder === 'inbox' && countInboxEl) {
        var cur = parseInt(countInboxEl.textContent, 10) || 0;
        if (cur > 1) countInboxEl.textContent = cur - 1;
        else countInboxEl.textContent = '';
      }
      renderNotifications();
    }

    readingPaneEl.innerHTML =
      '<div class="mailbox-loading-state">' +
        '<div class="mailbox-spinner"></div>' +
        '<span>Retrieving message…</span>' +
      '</div>';

    var url = '/inc/ajax/mailbox.php?action=read&folder=' + encodeURIComponent(state.activeFolder) +
              '&uid=' + encodeURIComponent(uid) +
              '&user=' + encodeURIComponent(targetUser) +
              (loadImages ? '&load_images=1' : '');

    fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.success || !data.email) {
          readingPaneEl.innerHTML =
            '<div class="mailbox-empty-state">' +
              '<p>Could not load email content.</p>' +
            '</div>';
          return;
        }
        if (data.csrf_token) csrfToken = data.csrf_token;
        state.selectedDetail = data.email;
        renderReadingPane(data.email);
      })
      .catch(function () {
        readingPaneEl.innerHTML =
          '<div class="mailbox-empty-state">' +
            '<p>Error loading email content.</p>' +
          '</div>';
      });
  }

  // --------------------------------------------------
  // Filter Emails
  // --------------------------------------------------
  function getFilteredEmails() {
    return state.emails.filter(function (e) {
      if (!state.searchQuery) return true;
      var q = state.searchQuery.toLowerCase();
      return (e.sender && e.sender.toLowerCase().indexOf(q) !== -1) ||
             (e.subject && e.subject.toLowerCase().indexOf(q) !== -1) ||
             (e.snippet && e.snippet.toLowerCase().indexOf(q) !== -1) ||
             (e.emailAddr && e.emailAddr.toLowerCase().indexOf(q) !== -1);
    });
  }

  // --------------------------------------------------
  // Render Email List
  // --------------------------------------------------
  function renderList() {
    var list = getFilteredEmails();
    emailListEl.innerHTML = '';

    if (list.length === 0) {
      var isInbox = (state.activeFolder === 'inbox');
      var emptyMsg = isInbox ? 'Your inbox is empty' : 'No messages in ' + state.activeFolder;

      var emptyHtml =
        '<div class="mailbox-empty-state">' +
          '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" rx="2"></rect><path d="M3 9h18"></path></svg>' +
          '<p>' + escapeHtml(emptyMsg) + '</p>';

      if (isInbox) {
        emptyHtml +=
          '<div class="mailbox-empty-actions">' +
            '<button class="mailbox-btn-secondary" id="mailbox-seed-welcome-btn">' +
              '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px; vertical-align: -2px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>' +
              'Send Welcome / Test Email' +
            '</button>' +
          '</div>';
      }

      emptyHtml += '</div>';
      emailListEl.innerHTML = emptyHtml;

      var seedBtn = document.getElementById('mailbox-seed-welcome-btn');
      if (seedBtn) {
        seedBtn.addEventListener('click', sendWelcomeEmail);
      }
      return;
    }

    list.forEach(function (e) {
      var row = document.createElement('div');
      row.className = 'mailbox-email-row' + (e.id === state.selectedId ? ' selected' : '') + (e.unread ? ' unread' : '');
      row.setAttribute('data-id', e.id);

      var indicatorHtml = e.unread ? '<div class="mailbox-unread-dot"></div>' : '<div class="mailbox-star-spacer"></div>';
      row.innerHTML =
        indicatorHtml +
        '<div class="mailbox-avatar-bubble" style="background:' + e.color + '">' + escapeHtml(e.initial) + '</div>' +
        '<div class="mailbox-email-main">' +
          '<div class="mailbox-email-top-row">' +
            '<div class="mailbox-email-sender">' + escapeHtml(e.sender) + '</div>' +
            '<div class="mailbox-email-time">' + escapeHtml(e.time) + '</div>' +
          '</div>' +
          '<div class="mailbox-email-subject">' + escapeHtml(e.subject) + '</div>' +
          '<div class="mailbox-email-snippet">' + escapeHtml(e.snippet) + '</div>' +
        '</div>';

      row.addEventListener('click', function () {
        selectEmail(e.id);
      });

      emailListEl.appendChild(row);
    });
  }

  // --------------------------------------------------
  // Notification Center Flyout
  // --------------------------------------------------
  function renderNotifications() {
    if (!notifListEl) return;

    var unreadEmails = state.emails.filter(function (e) {
      return e.unread && state.readNotificationIds.indexOf('email_' + e.id) === -1;
    });

    var hasStorageWarning = state.storageInfo && state.storageInfo.percent >= 85 && state.readNotificationIds.indexOf('sys_storage') === -1;
    var hasUnread = (unreadEmails.length > 0) || hasStorageWarning;

    if (notifBadge) {
      if (hasUnread) {
        notifBadge.classList.remove('hidden');
      } else {
        notifBadge.classList.add('hidden');
      }
    }

    var html = '';

    // 1. Email notifications
    var emailItems = state.emails.filter(function (e) { return e.unread; });
    // If no unread, show up to 3 recent inbox emails as read notifications
    if (emailItems.length === 0 && state.emails.length > 0) {
      emailItems = state.emails.slice(0, 3);
    }

    emailItems.forEach(function (e) {
      var notifKey = 'email_' + e.id;
      var isUnread = e.unread && state.readNotificationIds.indexOf(notifKey) === -1;
      html +=
        '<div class="mailbox-notification-item' + (isUnread ? ' unread' : '') + '" data-email-id="' + e.id + '">' +
          '<div class="mailbox-notification-icon">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>' +
          '</div>' +
          '<div class="mailbox-notification-content">' +
            '<div class="mailbox-notification-top">' +
              '<div class="mailbox-notification-subject">' + escapeHtml(e.subject || '(No subject)') + '</div>' +
              '<div class="mailbox-notification-time">' + escapeHtml(e.time || '') + '</div>' +
            '</div>' +
            '<div class="mailbox-notification-desc">' + escapeHtml(e.sender ? (e.sender + ' — ' + (e.snippet || '')) : (e.snippet || 'New message received')) + '</div>' +
          '</div>' +
        '</div>';
    });

    // 2. Storage Quota notification
    if (state.storageInfo) {
      var storKey = 'sys_storage';
      var storPercent = state.storageInfo.percent || 0;
      var storText = state.storageInfo.text || (storPercent + '% used');
      var isStorAlert = storPercent >= 85 && state.readNotificationIds.indexOf(storKey) === -1;
      html +=
        '<div class="mailbox-notification-item' + (isStorAlert ? ' unread' : '') + '" data-sys-id="' + storKey + '">' +
          '<div class="mailbox-notification-icon storage">' +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>' +
          '</div>' +
          '<div class="mailbox-notification-content">' +
            '<div class="mailbox-notification-top">' +
              '<div class="mailbox-notification-subject">Storage Quota (' + storPercent + '%)</div>' +
              '<div class="mailbox-notification-time">' + (storPercent >= 85 ? 'Warning' : 'Healthy') + '</div>' +
            '</div>' +
            '<div class="mailbox-notification-desc">' + escapeHtml(storText) + '</div>' +
          '</div>' +
        '</div>';
    }

    // 3. TLS Transport Security notification
    var secKey = 'sys_security';
    html +=
      '<div class="mailbox-notification-item" data-sys-id="' + secKey + '">' +
        '<div class="mailbox-notification-icon security">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="m9 12 2 2 4-4"></path></svg>' +
        '</div>' +
        '<div class="mailbox-notification-content">' +
          '<div class="mailbox-notification-top">' +
            '<div class="mailbox-notification-subject">TLS 1.3 Transport Security</div>' +
            '<div class="mailbox-notification-time">Active</div>' +
          '</div>' +
          '<div class="mailbox-notification-desc">Encrypted Dovecot IMAP &amp; Postfix SMTP channel active.</div>' +
        '</div>' +
      '</div>';

    notifListEl.innerHTML = html;

    // Attach click listeners to email notifications
    notifListEl.querySelectorAll('.mailbox-notification-item[data-email-id]').forEach(function (item) {
      item.addEventListener('click', function () {
        var id = parseInt(item.getAttribute('data-email-id'), 10);
        var key = 'email_' + id;
        if (state.readNotificationIds.indexOf(key) === -1) {
          state.readNotificationIds.push(key);
          try { localStorage.setItem('mailcow_read_notifs', JSON.stringify(state.readNotificationIds)); } catch (e) {}
        }
        if (notifMenuEl) {
          notifMenuEl.style.display = 'none';
          notifMenuEl.classList.remove('open');
          state.notificationsOpen = false;
        }
        if (state.activeFolder !== 'inbox') {
          document.querySelectorAll('.mailbox-nav-item[data-folder]').forEach(function (n) {
            if (n.getAttribute('data-folder') === 'inbox') {
              document.querySelectorAll('.mailbox-nav-item').forEach(function (i) { i.classList.remove('active'); });
              n.classList.add('active');
              if (folderTitleEl) folderTitleEl.textContent = 'Inbox';
            }
          });
          state.selectedId = id;
          loadFolder('inbox', true);
        } else {
          selectEmail(id);
        }
        renderNotifications();
      });
    });

    // Attach click listeners to sys notifications
    notifListEl.querySelectorAll('.mailbox-notification-item[data-sys-id]').forEach(function (item) {
      item.addEventListener('click', function () {
        var key = item.getAttribute('data-sys-id');
        if (state.readNotificationIds.indexOf(key) === -1) {
          state.readNotificationIds.push(key);
          try { localStorage.setItem('mailcow_read_notifs', JSON.stringify(state.readNotificationIds)); } catch (e) {}
        }
        item.classList.remove('unread');
        renderNotifications();
      });
    });
  }

  // --------------------------------------------------
  // Outlook-style "you're about to open an external link" prompt. Shows
  // the *real* href (not the clickable text, which senders can spoof) and
  // requires an explicit click before anything opens.
  // --------------------------------------------------
  function confirmExternalLink(url, onConfirm) {
    var overlay = document.createElement('div');
    overlay.className = 'mailbox-link-warning-overlay';
    overlay.innerHTML =
      '<div class="mailbox-link-warning-box">' +
        '<h3>This link leads outside the message</h3>' +
        '<p>Only continue if you trust the destination.</p>' +
        '<div class="mailbox-link-warning-url"></div>' +
        '<div class="mailbox-link-warning-actions">' +
          '<button type="button" class="mailbox-btn-secondary" data-act="cancel">Cancel</button>' +
          '<button type="button" class="mailbox-btn-primary" data-act="continue">Continue</button>' +
        '</div>' +
      '</div>';
    overlay.querySelector('.mailbox-link-warning-url').textContent = url;

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) close();
    });
    overlay.querySelector('[data-act="cancel"]').addEventListener('click', close);
    overlay.querySelector('[data-act="continue"]').addEventListener('click', function () {
      close();
      onConfirm();
    });

    document.body.appendChild(overlay);
  }

  // --------------------------------------------------
  // Render remote email HTML inside a script-less sandboxed iframe.
  // The server strips obvious script vectors, but that filter can be
  // bypassed by adversarial senders — the iframe sandbox (no
  // allow-scripts, ever) is the actual security boundary that keeps
  // untrusted email markup from executing script or touching the
  // mailcow session/cookies. allow-same-origin is safe to combine with a
  // script-less sandbox (there is no script that could abuse it) and is
  // needed so the parent can read the frame's height and attach a
  // click-through warning to links.
  // --------------------------------------------------
  function renderSandboxedEmailBody(html) {
    var container = document.getElementById('mailbox-email-html-body');
    if (!container) return;

    var iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    iframe.className = 'mailbox-email-html-frame';
    iframe.style.width = '100%';
    iframe.style.border = '0';
    iframe.style.display = 'block';

    iframe.addEventListener('load', function () {
      var doc = null;
      try { doc = iframe.contentDocument; } catch (e) { /* ignore */ }
      if (!doc) {
        iframe.style.height = '600px';
        return;
      }

      var height = doc.documentElement ? doc.documentElement.scrollHeight : 0;
      iframe.style.height = Math.max(height, 40) + 'px';

      // Intercept link clicks: no script from the message itself ever
      // runs (allow-scripts is never set), but the parent can safely wire
      // up a real-URL confirmation prompt before letting anything open.
      doc.querySelectorAll('a[href]').forEach(function (a) {
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          var href = a.getAttribute('href') || '';
          if (/^https?:\/\//i.test(href)) {
            confirmExternalLink(href, function () {
              window.open(href, '_blank', 'noopener,noreferrer');
            });
          }
          // Non-http(s) schemes (mailto:, tel:, javascript:, etc.) are
          // simply ignored — never navigated to automatically.
        });
      });
    });

    container.appendChild(iframe);
    // Assigned as a DOM property (not string-concatenated markup), so the
    // email body can never break out of an attribute/tag context.
    iframe.srcdoc = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<style>body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;word-wrap:break-word;overflow-wrap:break-word;}img{max-width:100%;height:auto;}a{cursor:pointer;}</style>' +
      '</head><body>' + html + '</body></html>';
  }

  // --------------------------------------------------
  // Render Reading Pane
  // --------------------------------------------------
  function renderReadingPane(email) {
    if (!email) {
      readingPaneEl.innerHTML =
        '<div class="mailbox-empty-state">' +
          '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>' +
          '<p>Select an email to view details</p>' +
        '</div>';
      return;
    }

    var hasHtmlBody = !!(email.html && email.html.trim().length > 0);
    var bodyHtml = hasHtmlBody
      ? '<div class="mailbox-email-html-body" id="mailbox-email-html-body"></div>'
      : '<div class="mailbox-email-plain-body">' + escapeHtml(email.plain || '(No body content)') + '</div>';

    var noticesHtml = '';
    if (email.authFailed) {
      var auth = email.auth || {};
      noticesHtml +=
        '<div class="mailbox-auth-fail-banner">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path></svg>' +
          '<span>Sender authentication failed (SPF: ' + escapeHtml(auth.spf || 'unknown') +
            ', DKIM: ' + escapeHtml(auth.dkim || 'unknown') +
            ', DMARC: ' + escapeHtml(auth.dmarc || 'unknown') +
            '). This message may be spoofed — treat links and attachments as untrusted.</span>' +
        '</div>';
    }
    if (email.external) {
      noticesHtml +=
        '<div class="mailbox-external-banner">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v5"></path><circle cx="12" cy="16.5" r="0.5" fill="currentColor"></circle></svg>' +
          '<span>You don\'t often get email from <strong>' + escapeHtml(email.emailAddr) + '</strong>. This message is from an external sender — be careful clicking links or opening attachments.</span>' +
        '</div>';
    }
    if (email.imagesBlocked > 0) {
      noticesHtml +=
        '<div class="mailbox-images-blocked-banner">' +
          '<span>' + email.imagesBlocked + (email.imagesBlocked === 1 ? ' image was' : ' images were') + ' blocked to protect your privacy.</span>' +
          '<button type="button" class="mailbox-link-btn" id="mailbox-show-images-btn">Show images</button>' +
        '</div>';
    }

    readingPaneEl.innerHTML =
      '<div class="mailbox-reading-header">' +
        '<h1>' + escapeHtml(email.subject) + '</h1>' +
        '<div class="mailbox-reading-from">' +
          '<div class="mailbox-reading-from-left">' +
            '<div class="mailbox-reading-avatar" style="background:' + email.color + '">' + escapeHtml(email.initial) + '</div>' +
            '<div>' +
              '<div class="mailbox-reading-name">' + escapeHtml(email.sender) + '</div>' +
              '<div class="mailbox-reading-email">' + escapeHtml(email.emailAddr) + ' · ' + escapeHtml(email.time) + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="mailbox-reading-actions">' +
            '<button class="mailbox-icon-btn action-reply" title="Reply"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 17 4 12l5-5"></path><path d="M4 12h11a5 5 0 0 1 5 5v1"></path></svg></button>' +
            '<button class="mailbox-icon-btn action-archive" title="Archive"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="4.5" width="17" height="4" rx="1"></rect><path d="M5 8.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V8.5"></path></svg></button>' +
            '<button class="mailbox-icon-btn action-delete" title="Delete"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16"></path><path d="M6.5 7 7 19a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l.5-12"></path></svg></button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      noticesHtml +
      '<div class="mailbox-reading-body">' +
        bodyHtml +
      '</div>' +
      '<div class="mailbox-reply-bar">' +
        '<span id="mailbox-reply-trigger">Reply to ' + escapeHtml(email.sender) + '…</span>' +
        '<button class="mailbox-reply-send" id="mailbox-reply-send">Reply</button>' +
      '</div>';

    if (hasHtmlBody) {
      renderSandboxedEmailBody(email.html);
    }

    var showImagesBtn = readingPaneEl.querySelector('#mailbox-show-images-btn');
    if (showImagesBtn) {
      showImagesBtn.addEventListener('click', function () {
        selectEmail(email.id, true);
      });
    }

    // Hook reading pane actions
    var replyBtn = readingPaneEl.querySelector('.action-reply');
    if (replyBtn) {
      replyBtn.addEventListener('click', function () {
        openCompose(email.emailAddr, 'Re: ' + email.subject);
      });
    }

    var archiveBtn = readingPaneEl.querySelector('.action-archive');
    if (archiveBtn) {
      archiveBtn.addEventListener('click', function () {
        archiveEmail(email.id);
      });
    }

    var deleteBtn = readingPaneEl.querySelector('.action-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        deleteEmail(email.id);
      });
    }

    var barReplySend = readingPaneEl.querySelector('#mailbox-reply-send');
    if (barReplySend) {
      barReplySend.addEventListener('click', function () {
        openCompose(email.emailAddr, 'Re: ' + email.subject);
      });
    }

    var barReplyTrigger = readingPaneEl.querySelector('#mailbox-reply-trigger');
    if (barReplyTrigger) {
      barReplyTrigger.addEventListener('click', function () {
        openCompose(email.emailAddr, 'Re: ' + email.subject);
      });
    }
  }

  // --------------------------------------------------
  // Delete / Trash Email
  // --------------------------------------------------
  function deleteEmail(uid) {
    var formData = new FormData();
    formData.append('action', 'delete');
    formData.append('folder', state.activeFolder);
    formData.append('uid', uid);
    formData.append('user', targetUser);
    formData.append('csrf_token', csrfToken);

    fetch('/inc/ajax/mailbox.php', {
      method: 'POST',
      body: formData
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.csrf_token) csrfToken = data.csrf_token;
        if (data.success) {
          showToast('Message moved to Trash');
          loadFolder(state.activeFolder, false);
        } else {
          showToast(data.msg || 'Could not delete message', 'error');
        }
      })
      .catch(function () {
        showToast('Error deleting message', 'error');
      });
  }

  // --------------------------------------------------
  // Archive Email
  // --------------------------------------------------
  function archiveEmail(uid) {
    var formData = new FormData();
    formData.append('action', 'archive');
    formData.append('folder', state.activeFolder);
    formData.append('uid', uid);
    formData.append('user', targetUser);
    formData.append('csrf_token', csrfToken);

    fetch('/inc/ajax/mailbox.php', {
      method: 'POST',
      body: formData
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.csrf_token) csrfToken = data.csrf_token;
        if (data.success) {
          showToast('Message moved to Archive');
          loadFolder(state.activeFolder, false);
        } else {
          showToast(data.msg || 'Could not archive message', 'error');
        }
      })
      .catch(function () {
        showToast('Error archiving message', 'error');
      });
  }

  // --------------------------------------------------
  // Send Welcome / Test Message
  // --------------------------------------------------
  function sendWelcomeEmail() {
    var formData = new FormData();
    formData.append('action', 'send_welcome');
    formData.append('user', targetUser);
    formData.append('csrf_token', csrfToken);

    showToast('Sending test message…');

    fetch('/inc/ajax/mailbox.php', {
      method: 'POST',
      body: formData
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.csrf_token) csrfToken = data.csrf_token;
        if (data.success) {
          showToast('Test email delivered to inbox!');
          setTimeout(function () {
            loadFolder('inbox', false);
          }, 800);
        } else {
          showToast(data.msg || 'Failed to send test email', 'error');
        }
      })
      .catch(function () {
        showToast('Network error delivering test message', 'error');
      });
  }

  // --------------------------------------------------
  // Compose Modal Handlers
  // --------------------------------------------------
  function openCompose(to, subject) {
    document.getElementById('compose-to').value = to || '';
    document.getElementById('compose-subject').value = subject || '';
    document.getElementById('compose-body').value = '';
    composeOverlay.classList.add('open');
    if (to) {
      document.getElementById('compose-body').focus();
    } else {
      document.getElementById('compose-to').focus();
    }
  }

  function closeCompose() {
    composeOverlay.classList.remove('open');
  }

  if (composeBtn) composeBtn.addEventListener('click', function () { openCompose(); });
  if (composeCloseBtn) composeCloseBtn.addEventListener('click', closeCompose);
  if (composeDiscardBtn) composeDiscardBtn.addEventListener('click', closeCompose);

  // Send message via real Postfix SMTP
  if (composeSendBtn) {
    composeSendBtn.addEventListener('click', function () {
      var to = document.getElementById('compose-to').value.trim();
      var subject = document.getElementById('compose-subject').value.trim();
      var body = document.getElementById('compose-body').value.trim();

      if (!to) {
        showToast('Please enter a recipient email address', 'error');
        return;
      }

      composeSendBtn.disabled = true;
      composeSendBtn.textContent = 'Sending…';

      var formData = new FormData();
      formData.append('action', 'send');
      formData.append('to', to);
      formData.append('subject', subject);
      formData.append('body', body);
      formData.append('user', targetUser);
      formData.append('csrf_token', csrfToken);

      fetch('/inc/ajax/mailbox.php', {
        method: 'POST',
        body: formData
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          composeSendBtn.disabled = false;
          composeSendBtn.textContent = 'Send Message';
          if (data.csrf_token) csrfToken = data.csrf_token;

          if (data.success) {
            closeCompose();
            showToast('Email sent successfully!');
            // Refresh folder
            if (state.activeFolder === 'sent') {
              loadFolder('sent', false);
            }
          } else {
            showToast(data.msg || 'Failed to send email', 'error');
          }
        })
        .catch(function () {
          composeSendBtn.disabled = false;
          composeSendBtn.textContent = 'Send Message';
          showToast('Network error while sending email', 'error');
        });
    });
  }

  // --------------------------------------------------
  // Navigation: Folder switching
  // --------------------------------------------------
  document.querySelectorAll('.mailbox-nav-item[data-folder]').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.mailbox-nav-item').forEach(function (i) { i.classList.remove('active'); });
      item.classList.add('active');

      var folder = item.getAttribute('data-folder');
      if (folderTitleEl) {
        folderTitleEl.textContent = item.innerText.split('\n')[0].trim();
      }
      loadFolder(folder, false);
    });
  });

  // Navigation: Label filtering
  document.querySelectorAll('.mailbox-nav-item[data-filter]').forEach(function (item) {
    item.addEventListener('click', function () {
      document.querySelectorAll('.mailbox-nav-item').forEach(function (i) { i.classList.remove('active'); });
      item.classList.add('active');

      var label = item.getAttribute('data-filter');
      state.filterLabel = label;
      if (folderTitleEl) {
        folderTitleEl.textContent = item.innerText.trim();
      }
      state.searchQuery = label;
      renderList();
    });
  });

  // Search input
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      state.searchQuery = this.value.trim();
      renderList();
    });
  }

  // Refresh buttons
  if (refreshBtn) {
    refreshBtn.addEventListener('click', function () {
      loadFolder(state.activeFolder, true);
      showToast('Checked for new messages');
    });
  }
  if (listRefreshBtn) {
    listRefreshBtn.addEventListener('click', function () {
      loadFolder(state.activeFolder, true);
      showToast('Checked for new messages');
    });
  }

  // --------------------------------------------------
  // Account dropdown menu
  // --------------------------------------------------
  if (accountBtn && accountMenuEl) {
    accountBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.menuOpen = !state.menuOpen;
      if (state.menuOpen) {
        if (notifMenuEl) {
          notifMenuEl.style.display = 'none';
          notifMenuEl.classList.remove('open');
          state.notificationsOpen = false;
        }
        accountMenuEl.style.display = 'block';
        accountMenuEl.classList.add('open');
      } else {
        accountMenuEl.style.display = 'none';
        accountMenuEl.classList.remove('open');
      }
    });
  }

  // --------------------------------------------------
  // Notifications flyout menu
  // --------------------------------------------------
  if (notifBtn && notifMenuEl) {
    notifBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.notificationsOpen = !state.notificationsOpen;
      if (state.notificationsOpen) {
        if (accountMenuEl) {
          accountMenuEl.style.display = 'none';
          accountMenuEl.classList.remove('open');
          state.menuOpen = false;
        }
        notifMenuEl.style.display = 'block';
        notifMenuEl.classList.add('open');
      } else {
        notifMenuEl.style.display = 'none';
        notifMenuEl.classList.remove('open');
      }
    });
  }

  // Mark all notifications as read
  if (notifMarkAllBtn) {
    notifMarkAllBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      state.emails.forEach(function (msg) {
        var key = 'email_' + msg.id;
        if (state.readNotificationIds.indexOf(key) === -1) {
          state.readNotificationIds.push(key);
        }
      });
      if (state.readNotificationIds.indexOf('sys_security') === -1) state.readNotificationIds.push('sys_security');
      if (state.readNotificationIds.indexOf('sys_storage') === -1) state.readNotificationIds.push('sys_storage');
      try { localStorage.setItem('mailcow_read_notifs', JSON.stringify(state.readNotificationIds)); } catch (e) {}

      renderNotifications();
      showToast('All notifications marked as read');
    });
  }

  // Close menus on outside click
  document.addEventListener('click', function (e) {
    if (state.menuOpen && accountMenuEl && !accountMenuEl.contains(e.target) && !accountBtn.contains(e.target)) {
      state.menuOpen = false;
      accountMenuEl.style.display = 'none';
      accountMenuEl.classList.remove('open');
    }
    if (state.notificationsOpen && notifMenuEl && !notifMenuEl.contains(e.target) && !notifBtn.contains(e.target)) {
      state.notificationsOpen = false;
      notifMenuEl.style.display = 'none';
      notifMenuEl.classList.remove('open');
    }
  });

  // Appearance color swatches
  document.querySelectorAll('.mailbox-swatch-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var key = this.getAttribute('data-accent-val');
      applyAccent(key);
    });
  });

  // --------------------------------------------------
  // Initial Boot
  // --------------------------------------------------
  var savedAccent = 'violet';
  try { savedAccent = localStorage.getItem('mailcow_accent') || 'violet'; } catch (e) {}
  applyAccent(savedAccent);

  renderNotifications();

  // Load active folder (Inbox)
  loadFolder('inbox', false);

})();
