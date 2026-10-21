/* SHARED (loaded on every page): dropdowns, shortcuts, login tabs, modals, toast */
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function openModal(m) {
    m.hidden = false;
    var f = $('input:not([type=hidden]), textarea', m);
    if (f) setTimeout(function () { f.focus(); }, 50);
  }
  window.FL = { $: $, $$: $$, openModal: openModal }; // used by student.js / admin.js

  /* dark / light theme (toggle in topbar, segmented control on the profile page) */
  var root = document.documentElement;
  function setTheme(t) {
    root.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) {}
    $$('.theme-set').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-theme-set') === t); });
  }
  setTheme(root.getAttribute('data-theme') || 'light');
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-theme-toggle]')) setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    var s = e.target.closest('.theme-set');
    if (s) setTheme(s.getAttribute('data-theme-set'));
  });

  /* dropdowns (bell + avatar) */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-dd]');
    $$('.dd-menu').forEach(function (m) { if (!(btn && m.id === btn.dataset.dd)) m.hidden = true; });
    if (btn) {
      var menu = document.getElementById(btn.dataset.dd);
      menu.hidden = !menu.hidden;
      if (btn.dataset.dd === 'notesMenu' && !menu.hidden) {
        var dot = document.getElementById('bellDot');
        if (dot) { dot.remove(); fetch('/notifications/read', { method: 'POST' }); }
      }
    }
    $$('details.menu[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });

  /* Ctrl/Cmd + K focuses search, Esc closes modals */
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      var s = $('.search input');
      if (s) { e.preventDefault(); s.focus(); }
    }
    if (e.key === 'Escape') $$('.modal').forEach(function (m) { m.hidden = true; });
  });

  /* sign in / create account tabs */
  var card = $('#authCard');
  if (card) {
    var copy = {
      login: ['Welcome back.', 'Sign in to continue your campus journey.'],
      register: ['Create your space.', 'Join the community and start making an impact.']
    };
    $$('[data-tab]', card).forEach(function (t) {
      t.addEventListener('click', function () {
        var mode = t.dataset.tab;
        $$('[data-tab]', card).forEach(function (x) { x.classList.toggle('on', x === t); });
        $('#loginForm').hidden = mode !== 'login';
        $('#registerForm').hidden = mode !== 'register';
        $('#authTitle').textContent = copy[mode][0];
        $('#authSub').textContent = copy[mode][1];
        var err = $('.form-error.show', card); if (err) err.remove();
      });
    });
  }

  /* open / close modals, confirm dialogs */
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]');
    if (o) openModal(document.getElementById(o.dataset.open));
    if (e.target.closest('[data-close]') || (e.target.classList && e.target.classList.contains('modal'))) {
      var m = e.target.closest('.modal') || e.target; m.hidden = true;
    }
  });
  document.addEventListener('submit', function (e) {
    var msg = e.target.dataset && e.target.dataset.confirm;
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  /* flash toast */
  var toast = $('#toast');
  if (toast) setTimeout(function () { toast.remove(); }, 4200);
})();
