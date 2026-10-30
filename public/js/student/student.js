/* STUDENT portal only: category chips, bookmarks, apply popup */
(function () {
  var $ = FL.$, $$ = FL.$$;

  /* combined filter chips (category + who-can-join eligibility) */
  var KEY = { cat: 'category', elig: 'eligibility' };
  function applyFilters() {
    var sel = [];
    $$('[data-filter]').forEach(function (g) {
      var b = g.querySelector('button.on'); if (!b) return;
      var k = Object.keys(b.dataset)[0];
      if (b.dataset[k] !== 'all') sel.push([KEY[k] || k, b.dataset[k]]);
    });
    $$('.org').forEach(function (o) {
      var hide = sel.some(function (s) { return o.dataset[s[0]] !== s[1]; });
      o.classList.toggle('hide', hide);
    });
  }
  $$('[data-filter]').forEach(function (group) {
    group.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      $$('button', group).forEach(function (x) { x.classList.toggle('on', x === b); });
      applyFilters();
    });
  });

  /* bookmark an organization */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-save]'); if (!b) return;
    fetch('/student/bookmark/' + b.dataset.save, { method: 'POST' })
      .then(function (r) { return r.json(); })
      .then(function (d) { b.classList.toggle('on', d.saved); });
  });

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-reload]')) location.reload();
  });

  /* apply to an organization */
  var applyModal = $('#applyModal');
  if (!applyModal) return;
  var form = $('#applyForm'), err = $('#applyError'), notice = $('#applyNotice');
  function showErr(m) { err.textContent = m; err.hidden = false; }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-apply]'); if (!b) return;
    var d = b.dataset;
    $('#applyStep').hidden = false; $('#applyDone').hidden = true;
    $('#applyTitle').textContent = (d.status === 'rejected' ? 'Revise & apply to ' : 'Join ') + d.name;
    $('#applySub').textContent = d.desc;
    var facts = $('#applyFacts'); facts.innerHTML = '';
    [d.category, d.schedule, d.members + ' members'].forEach(function (t) {
      var s = document.createElement('span'); s.textContent = t; facts.appendChild(s);
    });
    err.hidden = true; form.reset(); $('#applyOrg').value = d.id;
    notice.hidden = true; form.hidden = false;
    if (d.status === 'member') {
      notice.textContent = 'You are already a member of ' + d.name + '. Open My organizations to see its activities.';
      notice.hidden = false; form.hidden = true;
    } else if (d.status === 'pending') {
      notice.textContent = 'Your application is in review. ' + d.name + ' will notify you when there is an update.';
      notice.hidden = false; form.hidden = true;
    } else if (d.status === 'approved') {
      notice.textContent = 'Your application was accepted. Welcome to ' + d.name + '!';
      notice.hidden = false; form.hidden = true;
    } else if (d.status === 'rejected') {
      $('#applySub').textContent = 'Your last application was declined. Update your introduction and try again.';
    }
    FL.openModal(applyModal);
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var intro = $('#applyIntro').value.trim();
    if (!intro) return showErr('Write a short introduction so the team can get to know you.');
    if (!$('#applyAgree').checked) return showErr('Agree to share your student profile to continue.');
    fetch(form.dataset.endpoint || '/student/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: $('#applyOrg').value, intro: intro, agree: true })
    }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) return showErr(res.j.error || 'Something went wrong. Try again.');
        $('#applyDoneText').textContent = res.j.name + ' will review your application. We’ll notify you when there’s an update.';
        $('#applyStep').hidden = true; $('#applyDone').hidden = false;
      }).catch(function () { showErr('Could not reach the server. Check your connection.'); });
  });
})();
