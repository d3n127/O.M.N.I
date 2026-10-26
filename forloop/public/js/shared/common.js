/* Shared: theme, dropdowns, shortcuts, tabs, modals, toast */
(function () {
  var $ = function (s, r) {
    return (r || document).querySelector(s);
  };
  var $$ = function (s, r) {
    return Array.prototype.slice.call((r || document).querySelectorAll(s));
  };
  function openModal(m) {
    m.hidden = false;
    var f = $('input:not([type=hidden]), textarea', m);
    if (f)
      setTimeout(function () {
        f.focus();
      }, 50);
  }
  window.FL = { $: $, $$: $$, openModal: openModal }; // Used by student.js and admin.js

  /* Theme */
  var root = document.documentElement;
  function setTheme(t) {
    root.setAttribute('data-theme', t);
    try {
      localStorage.setItem('theme', t);
    } catch (e) {}
    $$('.theme-set').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-theme-set') === t);
    });
  }
  setTheme(root.getAttribute('data-theme') || 'light');
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-theme-toggle]'))
      setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    var s = e.target.closest('.theme-set');
    if (s) setTheme(s.getAttribute('data-theme-set'));
  });

  /* Dropdowns */
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-dd]');
    $$('.dd-menu').forEach(function (m) {
      if (!(btn && m.id === btn.dataset.dd)) m.hidden = true;
    });
    if (btn) {
      var menu = document.getElementById(btn.dataset.dd);
      menu.hidden = !menu.hidden;
      if (btn.dataset.dd === 'notesMenu' && !menu.hidden) {
        var dot = document.getElementById('bellDot');
        if (dot) {
          dot.remove();
          fetch('/notifications/read', { method: 'POST' });
        }
      }
    }
    $$('details.menu[open]').forEach(function (d) {
      if (!d.contains(e.target)) d.removeAttribute('open');
    });
  });

  /* Show the shortcut hint that matches the platform */
  if (/Mac|iPhone|iPad/.test(navigator.platform)) {
    $$('[data-shortcut]').forEach(function (k) {
      k.textContent = '⌘K';
    });
  }

  /* Ctrl/Cmd+K focuses search, Esc closes modals */
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      var s = $('.search input');
      if (s) {
        e.preventDefault();
        s.focus();
      }
    }
    if (e.key === 'Escape')
      $$('.modal').forEach(function (m) {
        m.hidden = true;
      });
  });

  /* Sign-in/sign-up tabs and role picker */
  var card = $('#authCard');
  if (card) {
    var copy = {
      login: ['Welcome back.', 'Sign in to continue your campus journey.'],
      register: ['Create your space.', 'Join the community and start making an impact.'],
    };
    $$('[data-tab]', card).forEach(function (t) {
      t.addEventListener('click', function () {
        var mode = t.dataset.tab;
        $$('[data-tab]', card).forEach(function (x) {
          x.classList.toggle('on', x === t);
        });
        $('#loginForm').hidden = mode !== 'login';
        $('#registerForm').hidden = mode !== 'register';
        $('#authTitle').textContent = copy[mode][0];
        $('#authSub').textContent = copy[mode][1];
        var err = $('.form-error.show', card);
        if (err) err.remove();
      });
    });

    /* Adviser shows the organization field */
    var orgField = $('#orgField');
    var orgInput = $('#r_org');
    var regHint = $('#regHint');
    $$('.role-opt', card).forEach(function (opt) {
      var radio = $('input[type=radio]', opt);
      if (!radio) return;
      function pick() {
        $$('.role-opt', card).forEach(function (o) {
          o.classList.toggle('on', o === opt);
        });
        var adviser = radio.value === 'adviser';
        if (orgField) orgField.hidden = !adviser;
        if (orgInput) orgInput.required = adviser;
        if (regHint)
          regHint.textContent = adviser
            ? 'Your organization is created with your account.'
            : "Right after signing up you'll set up your required student information.";
        var body = document.body;
        body.classList.toggle('t-admin', adviser);
        body.classList.toggle('t-student', !adviser);
      }
      radio.addEventListener('change', pick);
      opt.addEventListener('click', function () {
        radio.checked = true;
        pick();
      });
    });
  }

  /* Modals */
  document.addEventListener('click', function (e) {
    var o = e.target.closest('[data-open]');
    if (o) openModal(document.getElementById(o.dataset.open));
    if (
      e.target.closest('[data-close]') ||
      (e.target.classList && e.target.classList.contains('modal'))
    ) {
      var m = e.target.closest('.modal') || e.target;
      m.hidden = true;
    }
  });
  document.addEventListener('submit', function (e) {
    var msg = e.target.dataset && e.target.dataset.confirm;
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  /* Image uploads: <input type="file" data-upload="/url" data-preview="#target"> */
  document.addEventListener('change', function (e) {
    var input = e.target;
    var url = input.dataset && input.dataset.upload;
    var file = url && input.files && input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return window.alert('That image is larger than 2 MB.');

    fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!data.ok) return window.alert(data.message);
        var target = $(input.dataset.preview);
        if (target) target.innerHTML = '<img src="' + data.url + '" alt="">';
        window.location.reload();
      })
      .catch(function () {
        window.alert('Upload failed. Try again.');
      });
    input.value = '';
  });

  /* Toast */
  var toast = $('#toast');
  if (toast)
    setTimeout(function () {
      toast.remove();
    }, 4200);
})();
