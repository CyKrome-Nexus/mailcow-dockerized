/*
 * CyKrome Workspaces — SOGo Webmail Integration (Mailbox.dc.html)
 * Transforms SOGo Webmail into the exact CyKrome Workspaces Nocturn design language.
 */

// CKEditor configuration
if (typeof CKEDITOR !== 'undefined') {
  CKEDITOR.addCss("body { font-size: 14px !important; font-family: 'Manrope', sans-serif !important; background-color: #0a0a0f !important; color: #c3c4cd !important; }");
}

(function () {
  'use strict';

  var ACCENT_COLORS = {
    violet: { hex: '#8b5cf6', soft: '#a78bfa', glow: 'rgba(139,92,246,0.35)', glowStrong: 'rgba(139,92,246,0.55)' },
    cyan:   { hex: '#06b6d4', soft: '#22d3ee', glow: 'rgba(34,211,238,0.32)',  glowStrong: 'rgba(34,211,238,0.5)' },
    amber:  { hex: '#f59e0b', soft: '#fbbf24', glow: 'rgba(245,158,11,0.32)',  glowStrong: 'rgba(245,158,11,0.5)' }
  };

  function getAccentKey() {
    var stored = null;
    try { stored = window.localStorage.getItem('mailcow_accent'); } catch (e) {}
    return (stored === 'cyan' || stored === 'amber') ? stored : 'violet';
  }

  function injectFonts() {
    if (document.getElementById('cykrome-fonts')) return;
    var link = document.createElement('link');
    link.id = 'cykrome-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Manrope:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }

  function injectNocturnStyles() {
    var key = getAccentKey();
    var c = ACCENT_COLORS[key] || ACCENT_COLORS.violet;

    var el = document.getElementById('cykrome-nocturn-style');
    if (!el) {
      el = document.createElement('style');
      el.id = 'cykrome-nocturn-style';
      el.type = 'text/css';
      document.head.appendChild(el);
    }

    var css = [
      ':root {',
      '  --accent: ' + c.hex + ';',
      '  --accent-soft: ' + c.soft + ';',
      '  --accent-glow: ' + c.glow + ';',
      '  --accent-glow-strong: ' + c.glowStrong + ';',
      '}',

      '/* Global typography and base */',
      'body, md-content, .sg-body, input, button, textarea {',
      '  font-family: "Manrope", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;',
      '}',
      'h1, h2, h3, .md-title, .md-subhead, .sg-toolbar-title {',
      '  font-family: "Space Grotesk", sans-serif !important;',
      '}',

      'body, .sg-body, md-content {',
      '  background-color: #0a0a0f !important;',
      '  color: #e7e8ee !important;',
      '}',

      '/* Top toolbar */',
      'md-toolbar, .md-toolbar-tools, #topToolbar, .navigation-toolbar {',
      '  height: 60px !important;',
      '  min-height: 60px !important;',
      '  max-height: 60px !important;',
      '  background-color: #0d0e14 !important;',
      '  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;',
      '  box-shadow: none !important;',
      '  color: #f4f4f7 !important;',
      '}',

      '/* Search wrap */',
      '.search-container, .sg-search-box, md-toolbar input.sg-search-input {',
      '  background-color: rgba(255, 255, 255, 0.03) !important;',
      '  border: 1px solid rgba(255, 255, 255, 0.07) !important;',
      '  border-radius: 10px !important;',
      '  color: #dcdde5 !important;',
      '  font-size: 13px !important;',
      '  padding: 8px 14px !important;',
      '}',
      '.sg-search-box:focus-within {',
      '  border-color: ' + c.soft + ' !important;',
      '  background-color: rgba(255, 255, 255, 0.05) !important;',
      '}',

      '/* Left sidebar / Sidenav */',
      'md-sidenav, .sidebar, #folderList, .sg-sidenav {',
      '  background-color: #0a0a0f !important;',
      '  border-right: 1px solid rgba(255, 255, 255, 0.06) !important;',
      '  color: #a3a5b1 !important;',
      '}',

      '/* Compose Button */',
      '.sg-compose-button, button.sg-compose-btn, md-button.md-fab.md-primary, md-button.sg-fab-button {',
      '  background: linear-gradient(180deg, ' + c.soft + ', ' + c.hex + ') !important;',
      '  color: #0a0a0f !important;',
      '  font-weight: 800 !important;',
      '  font-size: 13.5px !important;',
      '  border-radius: 11px !important;',
      '  box-shadow: 0 10px 24px -10px ' + c.glowStrong + ' !important;',
      '  border: none !important;',
      '  text-transform: none !important;',
      '}',
      '.sg-compose-button md-icon, button.sg-compose-btn md-icon {',
      '  color: #0a0a0f !important;',
      '}',

      '/* Folder list items */',
      '#folderList md-list-item, .sg-folder-item {',
      '  border-radius: 9px !important;',
      '  margin: 2px 8px !important;',
      '  color: #a3a5b1 !important;',
      '  font-weight: 600 !important;',
      '}',
      '#folderList md-list-item:hover, .sg-folder-item:hover {',
      '  background-color: rgba(255, 255, 255, 0.04) !important;',
      '  color: #eceef3 !important;',
      '}',
      '#folderList md-list-item.selected, #folderList md-list-item.active, .sg-folder-item.selected {',
      '  background-color: rgba(255, 255, 255, 0.055) !important;',
      '  color: #f2f2f6 !important;',
      '  box-shadow: inset 2px 0 0 0 ' + c.hex + ' !important;',
      '}',
      '#folderList md-list-item.selected md-icon, .sg-folder-item.selected md-icon {',
      '  color: ' + c.hex + ' !important;',
      '}',

      '/* Message List / Cards */',
      '.mailbox-list, .messageList, md-list.sg-tile-list, .sg-list-view {',
      '  background-color: #0a0a0f !important;',
      '  border-right: 1px solid rgba(255, 255, 255, 0.06) !important;',
      '}',
      'md-list-item.sg-tile, .sg-tile, .listItem, tr.mailboxRow {',
      '  background-color: transparent !important;',
      '  border-bottom: 1px solid rgba(255, 255, 255, 0.03) !important;',
      '  border-left: 2px solid transparent !important;',
      '  padding: 10px 14px !important;',
      '  transition: background-color 0.15s ease !important;',
      '}',
      'md-list-item.sg-tile:hover, .sg-tile:hover {',
      '  background-color: rgba(255, 255, 255, 0.025) !important;',
      '}',
      'md-list-item.sg-tile.selected, .sg-tile.selected, .selected {',
      '  background-color: rgba(255, 255, 255, 0.045) !important;',
      '  border-left: 2px solid ' + c.hex + ' !important;',
      '}',
      '.unseenMessage, tr.unread, .sg-unread {',
      '  color: #f3f3f7 !important;',
      '  font-weight: 800 !important;',
      '}',
      '.sg-unread .sg-tile-subject {',
      '  color: #dcdde5 !important;',
      '  font-weight: 700 !important;',
      '}',
      '.sg-tile-subject {',
      '  color: #9a9ba6 !important;',
      '}',
      '.sg-tile-date {',
      '  font-size: 11px !important;',
      '  color: #62636e !important;',
      '}',
      '.sg-unread .sg-tile-date {',
      '  color: ' + c.soft + ' !important;',
      '  font-weight: 700 !important;',
      '}',

      '/* Reading Pane */',
      '#messageViewer, .sg-detail-view, md-content.sg-detail-view {',
      '  background-color: #0a0a0f !important;',
      '  color: #c3c4cd !important;',
      '}',
      '.sg-detail-header {',
      '  padding: 22px 32px 18px !important;',
      '  border-bottom: 1px solid rgba(255, 255, 255, 0.06) !important;',
      '  background-color: transparent !important;',
      '}',
      '.sg-detail-header h1, .sg-detail-subject {',
      '  font-family: "Space Grotesk", sans-serif !important;',
      '  font-size: 21px !important;',
      '  font-weight: 600 !important;',
      '  color: #f4f4f7 !important;',
      '  letter-spacing: -0.01em !important;',
      '}',
      '.sg-detail-body {',
      '  padding: 26px 32px !important;',
      '  font-size: 14px !important;',
      '  line-height: 1.75 !important;',
      '  color: #c3c4cd !important;',
      '}',

      '/* Dropdowns, Dialogs and Menus */',
      'md-menu-content, md-dialog, .sg-modal {',
      '  background-color: #14151c !important;',
      '  border: 1px solid rgba(255, 255, 255, 0.09) !important;',
      '  border-radius: 14px !important;',
      '  box-shadow: 0 20px 50px -12px rgba(0, 0, 0, 0.6) !important;',
      '  color: #eceef3 !important;',
      '}',
      'md-menu-item md-button {',
      '  color: #cfd0da !important;',
      '}',
      'md-menu-item md-button:hover {',
      '  background-color: rgba(255, 255, 255, 0.05) !important;',
      '  color: #f2f2f6 !important;',
      '}',

      '/* Forms & inputs */',
      'md-input-container input, md-input-container textarea, input, textarea {',
      '  background-color: rgba(255, 255, 255, 0.035) !important;',
      '  color: #eceef3 !important;',
      '  border: 1px solid rgba(255, 255, 255, 0.09) !important;',
      '  border-radius: 10px !important;',
      '  padding: 8px 12px !important;',
      '}',
      'md-input-container input:focus, textarea:focus {',
      '  border-color: ' + c.soft + ' !important;',
      '  box-shadow: 0 0 0 3px ' + c.glow + ' !important;',
      '}',

      '/* Selection & Accents */',
      '::selection { background-color: ' + c.hex + ' !important; color: #0a0a0f !important; }',
      'a { color: ' + c.hex + ' !important; }',
      'a:hover { color: ' + c.soft + ' !important; }',
      '.md-primary, md-icon.md-primary { color: ' + c.hex + ' !important; }',
      'button.md-primary.md-raised, md-button.md-primary.md-raised {',
      '  background-color: ' + c.hex + ' !important;',
      '  color: #0a0a0f !important;',
      '  font-weight: 700 !important;',
      '}'
    ].join('\n');

    el.textContent = css;
  }

  function rebrandTitle() {
    if (document.title && /\bSOGo\b/.test(document.title)) {
      document.title = document.title.replace(/\bSOGo\b/, 'CyKrome Workspaces');
    }
  }

  function setup() {
    injectFonts();
    injectNocturnStyles();
    rebrandTitle();

    // Observe tab title changes in Angular SPA
    var titleEl = document.querySelector('title');
    if (titleEl) {
      new MutationObserver(rebrandTitle).observe(titleEl, { childList: true });
    }

    // Sync accent if changed in another tab / window
    window.addEventListener('storage', function(e) {
      if (e.key === 'mailcow_accent') {
        injectNocturnStyles();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
