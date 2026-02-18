/**
 * Theme toggle — shared across all admin pages.
 * Default: dark. Preference persisted in localStorage.
 * Anti-FOUC: each page has an inline <script> in <head> that applies the
 * saved theme before render. This file injects the toggle button.
 */
(function () {
  const KEY = 'invofox-theme';

  const SUN = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
    <circle cx="12" cy="12" r="4.5"/>
    <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
    <line x1="4.22" y1="4.22" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.78" y2="19.78"/>
    <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
    <line x1="4.22" y1="19.78" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.78" y2="4.22"/>
  </svg>`;

  const MOON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>`;

  function getTheme() {
    return localStorage.getItem(KEY) || 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(KEY, theme);
    // Propagate to same-origin iframes (e.g. document-generator embedded in index.html)
    document.querySelectorAll('iframe').forEach(function (frame) {
      try {
        frame.contentDocument.documentElement.setAttribute('data-theme', theme);
      } catch (e) { /* cross-origin — ignore */ }
    });
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.innerHTML = theme === 'dark' ? SUN : MOON;
      btn.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Don't inject toggle when running inside an iframe (e.g. document-generator embedded in index.html)
    if (window.self !== window.top) {
      applyTheme(getTheme());
      return;
    }
    const btn = document.createElement('button');
    btn.id = 'theme-toggle';
    btn.addEventListener('click', function () {
      applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
    });
    document.body.appendChild(btn);
    applyTheme(getTheme());
  });
})();
