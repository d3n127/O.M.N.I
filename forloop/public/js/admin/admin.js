/* Admin portal: event popup, organization preview */
(function () {
  var $ = FL.$,
    $$ = FL.$$;

  var evModal = $('#eventModal');
  if (evModal) {
    var f = $('#eventForm'),
      del = $('#eventDelete');
    var fill = function (d) {
      $('#ev_title').value = d.title || '';
      $('#ev_date').value = d.date || '';
      $('#ev_time').value = d.time || '09:00';
      $('#ev_loc').value = d.location || '';
      $('#ev_desc').value = d.desc || '';
      $('#ev_program').value = d.program || '';
      $('#ev_status').value = d.status || 'published';
    };
    var openNew = function () {
      fill({});
      f.action = '/admin/events';
      del.hidden = true;
      $('#evEyebrow').textContent = 'New event';
      $('#evHeading').textContent = 'Create event';
      FL.openModal(evModal);
    };
    $$('[data-event-new]').forEach(function (b) {
      b.addEventListener('click', openNew);
    });
    $$('[data-event-edit]').forEach(function (b) {
      b.addEventListener('click', function () {
        fill(b.dataset);
        f.action = '/admin/events/' + b.dataset.id;
        del.action = '/admin/events/' + b.dataset.id + '/delete';
        del.hidden = false;
        $('#evEyebrow').textContent = 'Manage event';
        $('#evHeading').textContent = b.dataset.title;
        FL.openModal(evModal);
      });
    });
    if (new URLSearchParams(location.search).get('new')) openNew();
  }

  /* Live preview */
  $$('[data-bind]').forEach(function (inp) {
    inp.addEventListener('input', function () {
      var t = $(inp.dataset.bind);
      if (t && !t.querySelector('img')) t.textContent = inp.value;
    });
  });

  /* Mobile sidebar drawer */
  var toggle = document.querySelector('.menu-toggle');
  var shell = document.querySelector('.shell');
  if (toggle && shell) {
    toggle.addEventListener('click', function () {
      var open = shell.classList.toggle('nav-open');
      toggle.setAttribute('aria-expanded', open);
    });
    /* Close drawer on nav click */
    shell.querySelectorAll('.side a').forEach(function (a) {
      a.addEventListener('click', function () {
        shell.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }
})();
