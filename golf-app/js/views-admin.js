/*
 * views-admin.js — Admin screens (PRD 3.2, 5, 5A, 7.6, 10.2):
 * Dashboard, Tournament Setup, Course Configuration, Player Management,
 * Score Management, CSV export, reset.
 */
(function (GT) {
  'use strict';
  var h = GT.h, db = GT.db, golf = GT.golf, util = GT.util;

  function requireAdmin(app) {
    if (!GT.state.isAdmin()) { GT.router.go('home'); return false; }
    return true;
  }

  // ===== Admin Dashboard =================================================
  GT.router.register('admin', function (app) {
    if (!requireAdmin(app)) return;
    var t = db.getTournament();
    var rounds = db.getRounds();
    var players = db.getPlayers();

    app.appendChild(h('h1.page-title', {}, 'Admin Dashboard'));
    app.appendChild(h('div.grid3', {}, [
      h('div.card.pill-stat', {}, [h('div.v', {}, rounds.filter(function (r) { return r.configured; }).length + '/' + rounds.length), h('div.k', {}, 'Rounds set up')]),
      h('div.card.pill-stat', {}, [h('div.v', {}, players.length), h('div.k', {}, 'Members')]),
      h('div.card.pill-stat', {}, [h('div.v', {}, countSubmissions()), h('div.k', {}, 'Scores in')])
    ]));

    app.appendChild(h('div.wrap', { style: { marginBottom: '8px' } }, [
      h('button.btn.btn-primary.btn-sm', { onclick: function () { GT.router.go('setup'); } }, '⚙ Setup'),
      h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.router.go('courses'); } }, '🗺 Courses'),
      h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.router.go('members'); } }, '👥 Members'),
      h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.router.go('scores'); } }, '📝 Scores'),
      h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.router.go('results'); } },
        (GT.tournamentComplete && GT.tournamentComplete()) ? '🏆 Results' : '🏆 Preview results')
    ]));

    app.appendChild(h('div.note.note-green', {}, [
      'Players join “' + t.name + '” by picking it from their tournament list after they sign in — no code needed. You can block or remove anyone from ',
      h('b', {}, 'Members'), '.'
    ]));

    // Completion matrix
    app.appendChild(h('h2.section-title', {}, 'Completion status'));
    if (!players.length) {
      app.appendChild(GT.emptyState('👥', 'No players registered yet'));
    } else {
      var head = [h('th.rowhead', {}, 'Player')];
      rounds.forEach(function (r) { head.push(h('th', {}, 'R' + r.index)); });
      var body = players.map(function (p) {
        var row = [h('td.rowhead', {}, GT.displayName(p))];
        rounds.forEach(function (r) {
          var res = r.configured ? util.result(r, p) : { hasScore: false };
          var cell, cls = '';
          if (!r.configured) { cell = '–'; }
          else if (!res.hasScore) { cell = '·'; }
          else {
            cell = (res.mode || '') + (res.locked ? '🔒' : '') + (res.complete ? '' : '*');
            cls = res.complete ? '.pts-3' : '.pts-1';
          }
          row.push(h('td' + cls, {}, cell));
        });
        return h('tr', {}, row);
      });
      app.appendChild(h('div.sc-wrap', {}, h('table.sc', {}, [
        h('thead', {}, [h('tr', {}, head)]),
        h('tbody', {}, body)
      ])));
      app.appendChild(h('div.muted', { style: { fontSize: '.78rem', marginTop: '6px' } },
        'A/B = entry mode · 🔒 locked · * incomplete · · not started · – round not set up'));
    }

    // Audit log
    var log = db.getAuditLog();
    if (log.length) {
      app.appendChild(h('h2.section-title', {}, 'Recent admin activity'));
      var logCard = h('div.card');
      log.slice(0, 8).forEach(function (e) {
        logCard.appendChild(h('div.kv', {}, [h('span.k', {}, new Date(e.ts).toLocaleString()), h('span.v', { style: { textAlign: 'right' } }, e.message)]));
      });
      app.appendChild(logCard);
    }
  });

  function countSubmissions() {
    // Only scores for THIS tournament (scores are keyed globally across all).
    var tid = db.getActiveTournamentId();
    var d = db.load();
    return Object.keys(d.scores).filter(function (k) {
      var s = d.scores[k];
      if (s.tournamentId !== tid) return false;
      return s.mode === 'A' ? s.holes.some(function (x) { return x != null; }) : s.summaryGross != null;
    }).length;
  }

  // ===== Tournament Setup ================================================
  GT.router.register('setup', function (app) {
    if (!requireAdmin(app)) return;
    var t = db.getTournament();
    app.appendChild(h('h1.page-title', {}, 'Tournament Setup'));

    var f = {
      name: h('input', { type: 'text', value: t.name, placeholder: 'e.g. Marbella Golf Week 2026' }),
      numRounds: h('input', { type: 'number', min: '1', value: t.numRounds }),
      adminCode: h('input', { type: 'text', value: t.adminCode, autocapitalize: 'off', spellcheck: 'false' }),
      estimate: h('input', { type: 'checkbox' }),
      sessionHours: h('input', { type: 'number', min: '1', value: t.sessionHours })
    };
    f.estimate.checked = !!t.estimateNetForSummary;

    // Colour theme picker (live preview).
    var chosenTheme = t.theme || 'green';
    var themeRow = h('div.theme-row');
    function renderThemes() {
      GT.clear(themeRow);
      GT.THEMES.forEach(function (th) {
        themeRow.appendChild(h('button.theme-swatch' + (th.id === chosenTheme ? '.sel' : ''), {
          type: 'button', title: th.name, style: { background: th.swatch },
          onclick: function () { chosenTheme = th.id; GT.applyTheme(chosenTheme); renderThemes(); }
        }, th.id === chosenTheme ? '✓' : ''));
      });
    }
    renderThemes();

    function save() {
      var name = f.name.value.trim();
      var nr = parseInt(f.numRounds.value, 10);
      var ac = f.adminCode.value.trim();
      if (!name) { GT.toast('Tournament name is required.', 'error'); return; }
      if (!nr || nr < 1) { GT.toast('Number of rounds must be at least 1.', 'error'); return; }
      if (!ac) { GT.toast('An admin code is required.', 'error'); return; }
      db.updateTournament({ name: name, numRounds: nr, adminCode: ac,
        estimateNetForSummary: f.estimate.checked, sessionHours: parseInt(f.sessionHours.value, 10) || 4,
        theme: chosenTheme });
      db.logAdmin('Updated tournament settings');
      GT.toast('Settings saved', 'success');
      GT.router.go('admin');
    }

    app.appendChild(h('div.card.stack', {}, [
      h('div.field', {}, [h('label', {}, 'Tournament Name'), f.name]),
      h('div.field', {}, [h('label', {}, 'Number of Rounds'), f.numRounds,
        h('div.hint', {}, 'Adding rounds creates new empty round slots.')]),
      h('div.field', {}, [h('label', {}, 'Admin Code (you)'), f.adminCode,
        h('div.hint', {}, 'Used to manage this tournament. Players don’t need a code — they join from their list.')]),
      h('div.field', {}, [
        h('label', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [f.estimate,
          h('span', {}, 'Estimate Net for summary scores (gross − course handicap)')]),
        h('div.hint', {}, 'If off, Net shows N/A for summary-entry rounds.')
      ]),
      h('div.field', {}, [h('label', {}, 'Session timeout (hours)'), f.sessionHours]),
      h('div.field', {}, [h('label', {}, 'Colour theme'), themeRow,
        h('div.hint', {}, 'Tap a colour to preview; Save to apply for everyone in this tournament.')]),
      h('div.field', {}, [h('label', {}, 'Tournament photo'),
        GT.imageUploader({ url: t.photoUrl, pathPrefix: 'tournaments/' + t.id, maxDim: 1280, label: 'photo',
          onChange: function (url) { db.updateTournament({ photoUrl: url }); } }),
        h('div.hint', {}, 'Shown to players on the tournament home screen. Saved instantly.')]),
      h('button.btn.btn-primary.btn-block', { onclick: save }, 'Save Settings')
    ]));

    // Data tools
    app.appendChild(h('h2.section-title', {}, 'Data'));
    app.appendChild(h('div.card.stack', {}, [
      h('div.btn-row', {}, [
        h('button.btn.btn-outline', { onclick: exportCsv }, '⬇ Export CSV'),
        h('button.btn.btn-outline', { onclick: exportBackup }, '⬇ Backup (JSON)')
      ]),
      h('hr.divider'),
      h('button.btn.btn-outline.btn-block', { onclick: clearScoresPrompt }, '🧹 Clear all scores'),
      h('button.btn.btn-danger.btn-block', { onclick: deleteTournamentPrompt }, '⚠ Delete this tournament')
    ]));

    function clearScoresPrompt() {
      GT.confirm('Clear ALL scores for “' + t.name + '”? Courses and members are kept. This cannot be undone.', function () {
        db.clearScores(t.id); db.logAdmin('Cleared all scores'); GT.toast('Scores cleared', 'success'); GT.router.go('admin');
      }, { danger: true, yesLabel: 'Clear scores' });
    }
    function deleteTournamentPrompt() {
      GT.confirm('Permanently delete “' + t.name + '” — its courses, scores and member list? Player accounts are not deleted. Consider a backup first.', function () {
        var id = t.id; db.deleteTournament(id); GT.toast('Tournament deleted', 'success'); GT.state.logout();
      }, { danger: true, yesLabel: 'Delete tournament' });
    }
  });

  // ===== Course list =====================================================
  GT.router.register('courses', function (app) {
    if (!requireAdmin(app)) return;
    app.appendChild(h('h1.page-title', {}, 'Course Configuration'));
    app.appendChild(h('p.page-sub', {}, 'Set up the course for each round. Upload-and-scan is coming soon — enter details manually for now.'));
    var list = h('div.stack');
    db.getRounds().forEach(function (r) {
      list.appendChild(h('div.card.tap.card-row', { onclick: function () { GT.router.go('course', [r.id]); } }, [
        h('div.grow', {}, [h('h3', {}, 'Round ' + r.index),
          h('div.muted', {}, r.configured ? (r.courseName || 'Course') + (r.date ? ' · ' + GT.formatDate(r.date) : '') : 'Not configured')]),
        r.configured ? h('span.badge.badge-green', {}, 'Configured') : h('span.badge.badge-grey', {}, 'Set up')
      ]));
    });
    app.appendChild(list);
  });

  // ===== Course configuration (per round) ================================
  GT.router.register('course', function (app, params) {
    if (!requireAdmin(app)) return;
    var round = db.getRound(params[0]);
    if (!round) { app.appendChild(GT.emptyState('❓', 'Round not found')); return; }
    app.appendChild(h('h1.page-title', {}, 'Round ' + round.index + ' — Course'));

    // AI scan stub (PRD 5A) — disabled for now.
    app.appendChild(h('div.card.stack', {}, [
      h('div.spread', {}, [
        h('div', {}, [h('h3', {}, '📷 Scan scorecard'), h('div.muted', {}, 'AI extraction from a photo — coming soon.')]),
        h('span.badge.badge-amber', {}, 'Soon')
      ]),
      h('button.btn.btn-outline.btn-block', {
        onclick: function () { GT.toast('AI scan isn’t enabled yet — enter the card manually below.', ''); }
      }, 'Upload & scan (disabled)')
    ]));

    var n = round.numHoles || 18;
    var meta = {
      courseName: h('input', { type: 'text', value: round.courseName, placeholder: 'e.g. Real Club de Golf Las Brisas' }),
      date: h('input', { type: 'date', value: round.date }),
      teeColour: h('input', { type: 'text', value: round.teeColour, placeholder: 'e.g. Yellow' }),
      numHoles: h('select', {}, [h('option', { value: '18' }, '18 holes'), h('option', { value: '9' }, '9 holes')]),
      courseRating: h('input', { type: 'number', step: '0.1', value: round.courseRating != null ? round.courseRating : '', placeholder: 'e.g. 72.1' }),
      slopeRating: h('input', { type: 'number', value: round.slopeRating != null ? round.slopeRating : '', placeholder: 'e.g. 131' }),
      details: h('textarea', { rows: '3', placeholder: 'Notes about the course — directions, dress code, local rules, things to know…' }, round.details || '')
    };
    meta.numHoles.value = String(n);

    // Per-hole inputs (par / SI / yardage)
    var parInputs = [], siInputs = [], ydInputs = [];
    function holeTable(holesN) {
      parInputs = []; siInputs = []; ydInputs = [];
      var rows = [];
      var headerRow = h('tr', {}, [h('th.rowhead', {}, 'Hole'), h('th', {}, 'Par'), h('th', {}, 'SI'), h('th', {}, 'Yards')]);
      for (var i = 0; i < holesN; i++) {
        var p = h('input.inline-num', { type: 'number', min: '3', max: '6', inputmode: 'numeric', value: round.par[i] != null ? round.par[i] : '' });
        var s = h('input.inline-num', { type: 'number', min: '1', max: String(holesN), inputmode: 'numeric', value: round.strokeIndex[i] != null ? round.strokeIndex[i] : '' });
        var y = h('input.inline-num', { type: 'number', min: '0', inputmode: 'numeric', value: round.yardage[i] != null ? round.yardage[i] : '' });
        parInputs.push(p); siInputs.push(s); ydInputs.push(y);
        rows.push(h('tr', {}, [h('td.rowhead', {}, String(i + 1)), h('td', {}, p), h('td', {}, s), h('td', {}, y)]));
      }
      return h('table.sc', {}, [h('thead', {}, [headerRow]), h('tbody', {}, rows)]);
    }

    var holesWrap = h('div.sc-wrap', {}, holeTable(n));
    meta.numHoles.addEventListener('change', function () {
      n = parseInt(meta.numHoles.value, 10);
      GT.clear(holesWrap).appendChild(holeTable(n));
      renderHolePhotos();
    });

    function readArray(inputs, len) {
      var out = new Array(18).fill(null);
      for (var i = 0; i < len; i++) {
        var v = inputs[i].value.trim();
        out[i] = v === '' ? null : Number(v);
      }
      return out;
    }

    function save() {
      var holesN = parseInt(meta.numHoles.value, 10);
      var par = readArray(parInputs, holesN);
      var si = readArray(siInputs, holesN);
      var yd = readArray(ydInputs, holesN);
      var name = meta.courseName.value.trim();
      var cr = meta.courseRating.value === '' ? null : parseFloat(meta.courseRating.value);
      var sl = meta.slopeRating.value === '' ? null : parseInt(meta.slopeRating.value, 10);

      if (!name) { GT.toast('Course name is required.', 'error'); return; }
      var pv = golf.validatePar(par, holesN);
      if (!pv.ok) { GT.toast(pv.message, 'error'); return; }
      var sv = golf.validateStrokeIndex(si, holesN);
      if (!sv.ok) { GT.toast(sv.message, 'error'); return; }
      if (cr == null || isNaN(cr)) { GT.toast('Enter the Course Rating.', 'error'); return; }
      if (sl == null || isNaN(sl) || sl < 55 || sl > 155) { GT.toast('Slope Rating must be between 55 and 155.', 'error'); return; }

      db.updateRound(round.id, {
        courseName: name, date: meta.date.value, teeColour: meta.teeColour.value.trim(),
        numHoles: holesN, courseRating: cr, slopeRating: sl, details: meta.details.value.trim(),
        par: par, strokeIndex: si, yardage: yd,
        configured: true
      });
      db.logAdmin('Configured Round ' + round.index + ' (' + name + ')');
      GT.toast('Course saved', 'success');
      GT.router.go('courses');
    }

    app.appendChild(h('div.card.stack', {}, [
      h('div.field', {}, [h('label', {}, 'Course Name'), meta.courseName]),
      h('div.grid2', {}, [
        h('div.field', {}, [h('label', {}, 'Date of Round'), meta.date]),
        h('div.field', {}, [h('label', {}, 'Tee Colour / Name'), meta.teeColour])
      ]),
      h('div.grid3', {}, [
        h('div.field', {}, [h('label', {}, 'Holes'), meta.numHoles]),
        h('div.field', {}, [h('label', {}, 'Course Rating'), meta.courseRating]),
        h('div.field', {}, [h('label', {}, 'Slope Rating'), meta.slopeRating])
      ]),
      h('div.field', {}, [h('label', {}, 'Course details / notes'), meta.details,
        h('div.hint', {}, 'Shown to players on the round screen.')]),
      h('div.field', {}, [h('label', {}, 'Course layout map'),
        GT.imageUploader({ url: round.mapUrl, pathPrefix: 'rounds/' + round.id, maxDim: 1600, label: 'map',
          onChange: function (url) { db.updateRound(round.id, { mapUrl: url }); } }),
        h('div.hint', {}, 'A photo of the course layout/planner, shown on the round screen. Saved instantly.')])
    ]));

    // Per-hole photos (saved instantly, independent of the Save button).
    var holeImgs = (round.holeImages || new Array(18).fill(null)).slice();
    var holePhotoWrap = h('div.card');

    // Pull the first number 1..maxHole out of a file name (e.g. "hole-7.jpg" -> 7).
    function holeNumFromName(name, maxHole) {
      var base = String(name).replace(/\.[^.]+$/, '');
      var groups = base.match(/\d+/g);
      if (!groups) return null;
      for (var i = 0; i < groups.length; i++) {
        var v = parseInt(groups[i], 10);
        if (v >= 1 && v <= maxHole) return v;
      }
      return null;
    }

    function bulkUpload(files, statusEl, btn) {
      var hn = parseInt(meta.numHoles.value, 10) || 18;
      var jobs = [], skipped = [];
      Array.prototype.slice.call(files).forEach(function (f) {
        var num = holeNumFromName(f.name, hn);
        if (num) jobs.push({ file: f, hole: num }); else skipped.push(f.name);
      });
      if (!jobs.length) { GT.toast('No files named 1–' + hn + ' were found (e.g. 1.jpg, 2.jpg).', 'error'); return; }
      // last file wins if two map to the same hole
      jobs.sort(function (a, b) { return a.hole - b.hole; });
      var i = 0, done = 0, assigned = 0;
      btn.disabled = true;
      function setStatus() { statusEl.textContent = 'Uploading ' + Math.min(done + 1, jobs.length) + ' / ' + jobs.length + '…'; }
      setStatus();
      function next() {
        if (i >= jobs.length) {
          db.updateRound(round.id, { holeImages: holeImgs.slice() });
          btn.disabled = false; statusEl.textContent = '';
          renderHolePhotos();
          GT.toast(assigned + ' photo' + (assigned === 1 ? '' : 's') + ' assigned' + (skipped.length ? (' · ' + skipped.length + ' skipped') : ''), 'success');
          return;
        }
        var job = jobs[i++];
        GT.compressImage(job.file, 1280).then(function (blob) {
          return GT.cloud.uploadImage(blob, 'rounds/' + round.id + '/holes/h' + job.hole + '-' + Date.now() + '.jpg');
        }).then(function (url) {
          holeImgs[job.hole - 1] = url; assigned++;
        }).catch(function () {
          skipped.push(job.file.name);
        }).then(function () { done++; setStatus(); next(); });
      }
      next();
    }

    function renderHolePhotos() {
      GT.clear(holePhotoWrap);
      var hn = parseInt(meta.numHoles.value, 10) || 18;
      holePhotoWrap.appendChild(h('div.muted', { style: { marginBottom: '8px', fontWeight: '600' } }, 'Hole photos'));
      holePhotoWrap.appendChild(h('div.hint', { style: { marginBottom: '10px' } }, 'Optional overview photo for each hole — shown to players while they enter that hole’s score.'));

      // --- Bulk upload ---
      var bulkInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
      var bulkStatus = h('span.muted', { style: { fontSize: '.85rem' } });
      var bulkBtn = h('button.btn.btn-primary.btn-sm', { type: 'button',
        onclick: function () { bulkInput.value = ''; bulkInput.click(); } }, '⬆ Bulk upload 1–' + hn);
      bulkInput.addEventListener('change', function () { if (bulkInput.files && bulkInput.files.length) bulkUpload(bulkInput.files, bulkStatus, bulkBtn); });
      holePhotoWrap.appendChild(h('div.note.note-blue', { style: { marginBottom: '12px' } }, [
        h('div', { style: { fontWeight: 600, marginBottom: '4px' } }, 'Bulk upload'),
        h('div', { style: { marginBottom: '8px' } }, 'Select photos named by hole number (1.jpg, 2.jpg … ' + hn + '.jpg). Each is placed on its hole automatically. Re-uploading a number replaces that hole.'),
        h('div.card-row', {}, [bulkInput, bulkBtn, bulkStatus])
      ]));

      // --- Per-hole manual uploads ---
      for (var i = 0; i < hn; i++) {
        (function (i) {
          holePhotoWrap.appendChild(h('div.hole-photo-row', {}, [
            h('div.hp-num', {}, 'Hole ' + (i + 1)),
            GT.imageUploader({ url: holeImgs[i], pathPrefix: 'rounds/' + round.id + '/holes', maxDim: 1280, label: 'photo',
              onChange: function (url) { holeImgs[i] = url || null; db.updateRound(round.id, { holeImages: holeImgs.slice() }); } })
          ]));
        })(i);
      }
    }
    renderHolePhotos();
    app.appendChild(h('div.card', {}, [
      h('div.spread', { style: { marginBottom: '8px' } }, [
        h('div', { style: { fontWeight: 600 } }, 'Par, Stroke Index & Yardage'),
        h('button.btn.btn-ghost.btn-sm', { onclick: fillStandardPar }, 'Fill standard par 72')
      ]),
      holesWrap,
      h('div.hint', { style: { marginTop: '8px' } }, 'Stroke Index must be a complete 1–' + n + ' set with no duplicates. Yardage is optional.')
    ]));

    // --- Bonus prizes (longest drive, nearest the pin, …) — saved instantly ---
    var bonusWrap = h('div.card');
    function renderBonuses() {
      GT.clear(bonusWrap);
      var hn = parseInt(meta.numHoles.value, 10) || 18;
      bonusWrap.appendChild(h('div.spread', { style: { marginBottom: '4px' } }, [
        h('div', { style: { fontWeight: 600 } }, '🏅 Bonus prizes'),
        h('span.badge.badge-amber', {}, 'Saved instantly')
      ]));
      bonusWrap.appendChild(h('div.hint', { style: { marginBottom: '10px' } },
        'Pick the hole and prize (e.g. Longest Drive, Nearest the Pin). Players see a marker on that hole and record the winner as they play.'));

      var list = GT.bonus.forRound(round);
      if (list.length) {
        var listWrap = h('div.stack', { style: { marginBottom: '12px' } });
        list.forEach(function (b) {
          listWrap.appendChild(h('div.card-row', { style: { alignItems: 'center' } }, [
            h('div.grow', {}, [
              h('div', { style: { fontWeight: 600 } }, GT.bonus.iconFor(b) + ' ' + b.type),
              h('div.muted', { style: { fontSize: '.82rem' } }, 'Hole ' + b.hole + ' · ' + (b.dir === 'low' ? 'closest wins' : 'longest wins'))
            ]),
            h('button.btn.btn-ghost.btn-sm', { onclick: function () {
              db.removeBonus(round.id, b.id); renderBonuses();
            } }, 'Remove')
          ]));
        });
        bonusWrap.appendChild(listWrap);
      } else {
        bonusWrap.appendChild(h('div.muted', { style: { marginBottom: '12px', fontSize: '.85rem' } }, 'No bonus prizes yet.'));
      }

      // Add form
      var holeSel = h('select', {}, (function () {
        var opts = [];
        for (var i = 1; i <= hn; i++) opts.push(h('option', { value: String(i) }, 'Hole ' + i));
        return opts;
      })());
      var typeSel = h('select', {}, GT.bonus.PRESETS.map(function (p) {
        return h('option', { value: p.type }, p.icon + ' ' + p.type);
      }).concat([h('option', { value: '__custom' }, '✏️ Custom…')]));
      var customName = h('input', { type: 'text', placeholder: 'Prize name, e.g. Longest Putt' });
      var dirSel = h('select', {}, [
        h('option', { value: 'high' }, 'Longest / biggest wins'),
        h('option', { value: 'low' }, 'Closest / smallest wins')
      ]);
      var customRow = h('div.grid2', { style: { display: 'none', marginTop: '8px' } }, [
        h('div.field', {}, [h('label', {}, 'Custom prize name'), customName]),
        h('div.field', {}, [h('label', {}, 'How it’s won'), dirSel])
      ]);
      typeSel.addEventListener('change', function () {
        customRow.style.display = typeSel.value === '__custom' ? '' : 'none';
      });

      var addBtn = h('button.btn.btn-primary.btn-sm', { onclick: function () {
        var hole = parseInt(holeSel.value, 10);
        var data;
        if (typeSel.value === '__custom') {
          var nm = customName.value.trim();
          if (!nm) { GT.toast('Enter a name for the custom prize.', 'error'); return; }
          data = { hole: hole, type: nm, icon: '🏅', dir: dirSel.value, unit: '' };
        } else {
          var preset = GT.bonus.presetFor(typeSel.value);
          data = { hole: hole, type: preset.type, icon: preset.icon, dir: preset.dir, unit: preset.unit };
        }
        db.addBonus(round.id, data);
        customName.value = ''; typeSel.value = GT.bonus.PRESETS[0].type; customRow.style.display = 'none';
        renderBonuses();
        GT.toast('Bonus added', 'success');
      } }, '+ Add bonus');

      bonusWrap.appendChild(h('div.note.note-blue', {}, [
        h('div.grid2', {}, [
          h('div.field', {}, [h('label', {}, 'Hole'), holeSel]),
          h('div.field', {}, [h('label', {}, 'Prize'), typeSel])
        ]),
        customRow,
        h('div', { style: { marginTop: '8px' } }, addBtn)
      ]));
    }
    renderBonuses();
    app.appendChild(bonusWrap);

    function fillStandardPar() {
      var std = [4,4,4,3,4,5,4,3,5, 4,4,3,4,5,4,4,3,5]; // a common par-72 layout
      var holesN = parseInt(meta.numHoles.value, 10);
      for (var i = 0; i < holesN; i++) {
        if (!parInputs[i].value) parInputs[i].value = std[i] || 4;
        if (!siInputs[i].value) siInputs[i].value = i + 1;
      }
      GT.toast('Filled defaults — adjust as needed.', '');
    }

    app.appendChild(holePhotoWrap);
    app.appendChild(h('button.btn.btn-primary.btn-block', { onclick: save }, 'Save Course'));
  });

  // ===== Member management ==============================================
  GT.router.register('members', function (app) {
    if (!requireAdmin(app)) return;
    var t = db.getTournament();
    app.appendChild(h('h1.page-title', {}, 'Member Management'));
    app.appendChild(h('div.note.note-green', {}, ['Players join this tournament from their own list after signing in — no code needed. You can remove or block anyone here, or add an existing account below.']));

    var members = db.getMembers(t.id).sort(function (a, b) { return a.player.fullName.localeCompare(b.player.fullName); });
    if (!members.length) {
      app.appendChild(GT.emptyState('👥', 'No members yet', 'Players can join from their list, or add an existing account below.'));
    }

    var list = h('div.stack');
    members.forEach(function (m) {
      var p = m.player;
      var blocked = m.status === 'blocked';
      list.appendChild(h('div.card.card-row', {}, [
        h('div.grow', {}, [h('h3', {}, GT.formalName(p)),
          h('div.muted', {}, 'HI ' + GT.fmtHi(p.handicapIndex) + (p.username ? ' · @' + p.username : '')),
          blocked ? h('span.badge.badge-red', { style: { marginTop: '4px' } }, 'Blocked') : null]),
        h('div.wrap', {}, [
          h('button.btn.btn-outline.btn-sm', { onclick: function () { editPlayer(p); } }, 'Edit'),
          blocked
            ? h('button.btn.btn-outline.btn-sm', { onclick: function () { setStatus(p, 'member', 'unblocked'); } }, 'Unblock')
            : h('button.btn.btn-ghost.btn-sm', { onclick: function () { confirmBlock(p); } }, 'Block'),
          h('button.btn.btn-ghost.btn-sm', { onclick: function () { confirmRemove(p); } }, 'Remove')
        ])
      ]));
    });
    app.appendChild(list);

    app.appendChild(h('div.btn-row', { style: { marginTop: '6px' } }, [
      h('button.btn.btn-primary', { onclick: function () { addExisting(); } }, '+ Add existing player'),
      h('button.btn.btn-outline', { onclick: function () { editPlayer(null); } }, '+ New player')
    ]));

    function setStatus(p, status, verb) {
      db.setMemberStatus(t.id, p.id, status);
      db.logAdmin((verb || status) + ' ' + p.fullName);
      GT.toast(p.fullName + ' ' + (verb || status), 'success'); GT.router.render();
    }
    function confirmBlock(p) {
      GT.confirm('Block ' + p.fullName + '? They keep their account and scores but can’t rejoin with the code until unblocked.', function () { setStatus(p, 'blocked', 'blocked'); }, { danger: true, yesLabel: 'Block' });
    }
    function confirmRemove(p) {
      GT.confirm('Remove ' + p.fullName + ' from this tournament? Their scores here are deleted. Their account stays.', function () {
        // delete their scores in this tournament, then drop membership
        db.getRoundsFor(t.id).forEach(function (r) { if (db.getScore(r.id, p.id)) db.deleteScore(r.id, p.id); });
        db.removeMember(t.id, p.id);
        db.logAdmin('Removed ' + p.fullName + ' from tournament');
        GT.toast(p.fullName + ' removed', 'success'); GT.router.render();
      }, { danger: true, yesLabel: 'Remove' });
    }
    function editPlayer(p) {
      var holder = h('div');
      GT.registrationForm(holder, { player: p, isAdmin: true, onSaved: function (saved) {
        if (!p && saved) db.addMember(t.id, saved.id); // new account joins this tournament
        close(); GT.router.render();
      } });
      var close = GT.modal({ title: p ? 'Edit player' : 'New player', body: holder, actions: [{ label: 'Cancel', kind: 'ghost' }] });
    }
    function addExisting() {
      var nonMembers = db.getAllPlayers().filter(function (p) { return !db.getMembership(t.id, p.id); });
      if (!nonMembers.length) { GT.toast('No other player accounts to add.', ''); return; }
      var holder = h('div.stack');
      nonMembers.sort(function (a, b) { return a.fullName.localeCompare(b.fullName); }).forEach(function (p) {
        holder.appendChild(h('div.card.tap.card-row', { onclick: function () { db.addMember(t.id, p.id); db.logAdmin('Added ' + p.fullName); close(); GT.toast('Added ' + p.fullName, 'success'); GT.router.render(); } }, [
          h('div.grow', {}, [h('h3', {}, GT.formalName(p)), h('div.muted', {}, 'HI ' + GT.fmtHi(p.handicapIndex) + (p.username ? ' · @' + p.username : ''))]),
          h('span', {}, '+')
        ]));
      });
      var close = GT.modal({ title: 'Add existing player', body: holder, actions: [{ label: 'Close', kind: 'ghost' }] });
    }
  });

  // ===== Groups & Tee Times =============================================
  function timeToMin(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function minToTime(n) { n = ((n % 1440) + 1440) % 1440; var hh = Math.floor(n / 60), mm = n % 60; return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }

  function segRow(values, current, onset) {
    var row = h('div.seg-row');
    values.map(function (v) {
      return h('button.seg' + (v.val === current() ? '.active' : ''), { type: 'button',
        onclick: function () { onset(v.val); Array.prototype.forEach.call(row.children, function (c, i) { c.classList.toggle('active', values[i].val === current()); }); } }, v.label);
    }).forEach(function (b) { row.appendChild(b); });
    return row;
  }
  function describeSizes(sizes) {
    if (!sizes.length) return '';
    var counts = {};
    sizes.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    return Object.keys(counts).sort().map(function (s) { return counts[s] + ' × ' + s + '-ball'; }).join(', ');
  }

  GT.router.register('groups', function (app, params) {
    if (!requireAdmin(app)) return;
    var t = db.getActiveTournament();
    var rounds = db.getRounds();
    var members = db.getPlayers();
    var roundId = (params && params[0]) || (rounds[0] && rounds[0].id);
    var round = db.getRound(roundId);

    app.appendChild(h('h1.page-title', {}, 'Groups & Tee Times'));
    if (!members.length) { app.appendChild(GT.emptyState('👥', 'No members yet', 'Players need to join before you can make groups.')); return; }

    // ================= Tournament draw =================
    var plan = t.groupPlan || {};
    var drawSize = plan.size || 4;
    var drawLast = plan.lastDay || 'random';
    var drawFirst = h('input', { type: 'time', value: plan.firstTee || '08:00' });
    var drawInterval = h('input', { type: 'number', min: '1', value: String(plan.interval || 10), style: { width: '90px' } });

    function generateDraw() {
      var ids = members.map(function (p) { return p.id; });
      if (ids.length < 2) { GT.toast('Need at least 2 members.', 'error'); return; }
      var size = drawSize;
      var reverse = drawLast === 'reverse' && rounds.length > 1;
      var firstTee = drawFirst.value || '08:00';
      var step = parseInt(drawInterval.value, 10) || 10;
      var base = timeToMin(firstTee); if (base == null) base = 480;
      var randomRounds = reverse ? rounds.slice(0, -1) : rounds.slice();
      var lastRound = reverse ? rounds[rounds.length - 1] : null;

      // Optimise all random days together so the same players avoid each other
      // across days as much as possible.
      var schedule = GT.golf.makeSchedule(ids, size, randomRounds.length);
      randomRounds.forEach(function (r, di) {
        var arrays = schedule[di] || [];
        var gobjs = arrays.map(function (g, i) { return { id: db.uid('grp'), players: g, teeTime: minToTime(base + i * step) }; });
        db.updateRound(r.id, { groups: gobjs, autoReverse: false });
      });
      if (lastRound) {
        db.updateRound(lastRound.id, { groups: [], autoReverse: true, groupSize: size, firstTee: firstTee, interval: step });
      }
      db.updateTournament({ groupPlan: { size: size, lastDay: reverse ? 'reverse' : 'random', firstTee: firstTee, interval: step } });
      db.logAdmin('Generated tournament draw (' + (reverse ? 'reverse last day' : 'all random') + ')');
      GT.toast('Draw generated for all rounds', 'success');
      GT.router.render();
    }

    app.appendChild(h('div.card.stack', {}, [
      h('div', { style: { fontWeight: 700 } }, '🎲 Tournament draw'),
      h('div.field', {}, [h('label', {}, 'Group size'),
        segRow([{ val: 4, label: '4-ball' }, { val: 3, label: '3-ball' }, { val: 2, label: '2-ball' }], function () { return drawSize; }, function (v) { drawSize = v; })]),
      rounds.length > 1 ? h('div.field', {}, [h('label', {}, 'Last day'),
        segRow([{ val: 'random', label: 'Also random' }, { val: 'reverse', label: 'Reverse leaderboard' }], function () { return drawLast; }, function (v) { drawLast = v; })]) : null,
      h('div.grid2', {}, [
        h('div.field', {}, [h('label', {}, 'First tee time'), drawFirst]),
        h('div.field', {}, [h('label', {}, 'Interval (mins)'), drawInterval])
      ]),
      h('button.btn.btn-primary.btn-block', { onclick: function () {
        if (rounds.some(function (r) { return db.getGroups(r.id).length; }))
          GT.confirm('Generate a fresh draw for all rounds? This replaces any existing groups.', generateDraw, { yesLabel: 'Generate' });
        else generateDraw();
      } }, '🎲 Generate draw (all rounds)'),
      h('div.hint', {}, members.length + ' members · ' + describeSizes(GT.golf.groupSizes(members.length, drawSize)) + ' each day' +
        (rounds.length > 1 && drawLast === 'reverse' ? ' · last day auto-set by reverse leaderboard order (updates live)' : '') +
        ' · players avoid repeat partners across days where possible.')
    ]));

    // ================= Per-round tabs =================
    var tabs = h('div.tabs');
    rounds.forEach(function (r) {
      tabs.appendChild(h('button' + (r.id === roundId ? '.active' : ''), {
        onclick: function () { GT.router.go('groups', [r.id]); }
      }, 'R' + r.index + (r.autoReverse ? ' ⟲' : '')));
    });
    app.appendChild(tabs);
    if (!round) { app.appendChild(GT.emptyState('❓', 'No round')); return; }

    var isLast = rounds.length > 1 && round.id === rounds[rounds.length - 1].id;

    // ----- Auto reverse-leaderboard day (derived, read-only) -----
    if (round.autoReverse) {
      app.appendChild(h('div.note.note-blue', {}, [
        h('div', { style: { fontWeight: 600, marginBottom: '2px' } }, '⟲ Auto — reverse leaderboard order'),
        h('div', {}, 'Groups are set from the current standings (players with the worst scores tee off first) and update automatically as results come in. First tee ' + (round.firstTee || '08:00') + ', every ' + (round.interval || 10) + ' min.')
      ]));
      app.appendChild(groupsView(db.getGroups(round.id), members, null, null));
      app.appendChild(h('button.btn.btn-outline.btn-block', { style: { marginTop: '10px' }, onclick: function () {
        var frozen = db.getGroups(round.id).map(function (g) { return { id: db.uid('grp'), players: g.players.slice(), teeTime: g.teeTime }; });
        db.updateRound(round.id, { autoReverse: false, groups: frozen });
        GT.toast('Switched to manual — you can now edit this day.', 'success'); GT.router.render();
      } }, 'Switch to manual editing'));
      return;
    }

    // ----- Manual / stored day (editable) -----
    var seedG = db.getGroups(round.id);
    var seedFirst = (seedG[0] && seedG[0].teeTime) || (round.firstTee || '08:00');
    var seedInterval = round.interval || 10;
    if (seedG.length >= 2 && seedG[0].teeTime && seedG[1].teeTime) {
      var dd = timeToMin(seedG[1].teeTime) - timeToMin(seedG[0].teeTime); if (dd > 0) seedInterval = dd;
    }
    var rFirst = h('input', { type: 'time', value: seedFirst, onchange: function () { applyTeeTimes(true); } });
    var rInterval = h('input', { type: 'number', min: '1', value: String(seedInterval), style: { width: '90px' }, onchange: function () { applyTeeTimes(true); } });
    function applyTeeTimes(announce) {
      var gs = db.getGroups(round.id);
      if (!gs.length) return;
      var base = timeToMin(rFirst.value); if (base == null) base = 480;
      var step = parseInt(rInterval.value, 10) || 10;
      db.saveGroups(round.id, gs.map(function (g, i) { return { id: g.id, players: g.players.slice(), teeTime: minToTime(base + i * step) }; }));
      if (announce) GT.toast('Tee times updated', 'success');
      GT.router.render();
    }
    function redrawThisDay() {
      var ids = members.map(function (p) { return p.id; });
      var arrays = GT.golf.makeGroups(ids, (t.groupPlan && t.groupPlan.size) || 4, { mode: 'random', pairCounts: db.pairCounts(t.id, round.id) });
      var base = timeToMin(rFirst.value) || 480, step = parseInt(rInterval.value, 10) || 10;
      db.saveGroups(round.id, arrays.map(function (g, i) { return { id: db.uid('grp'), players: g, teeTime: minToTime(base + i * step) }; }));
      GT.toast('Round ' + round.index + ' redrawn', 'success'); GT.router.render();
    }
    function clearGroups() {
      if (!db.getGroups(round.id).length) return;
      GT.confirm('Clear all groups for Round ' + round.index + '?', function () { db.saveGroups(round.id, []); GT.toast('Groups cleared', 'success'); GT.router.render(); });
    }
    function move(pid, fromIdx, toVal) {
      var gs = db.getGroups(round.id).map(function (g) { return { id: g.id, players: g.players.slice(), teeTime: g.teeTime }; });
      if (fromIdx != null) gs[fromIdx].players = gs[fromIdx].players.filter(function (x) { return x !== pid; });
      if (toVal !== 'x') gs[+toVal].players.push(pid);
      db.saveGroups(round.id, gs.filter(function (g) { return g.players.length; })); GT.router.render();
    }
    function setTee(idx, val) {
      var gs = db.getGroups(round.id).map(function (g) { return { id: g.id, players: g.players.slice(), teeTime: g.teeTime }; });
      gs[idx].teeTime = val; db.saveGroups(round.id, gs); GT.toast('Group ' + (idx + 1) + ' tee time saved', 'success');
    }
    // Exchange two players between (or within) groups, keeping group sizes.
    function swap(a, b) {
      if (!a || !b || a === b) { GT.toast('Pick two different players.', 'error'); return; }
      var gs = db.getGroups(round.id).map(function (g) { return { id: g.id, players: g.players.slice(), teeTime: g.teeTime }; });
      var la = null, lb = null;
      gs.forEach(function (g, gi) { g.players.forEach(function (pid, pi) { if (pid === a) la = { gi: gi, pi: pi }; if (pid === b) lb = { gi: gi, pi: pi }; }); });
      if (!la || !lb) return;
      gs[la.gi].players[la.pi] = b; gs[lb.gi].players[lb.pi] = a;
      db.saveGroups(round.id, gs);
      GT.toast('Players swapped', 'success'); GT.router.render();
    }

    app.appendChild(h('div.card.stack', {}, [
      h('div.grid2', {}, [
        h('div.field', {}, [h('label', {}, 'First tee time'), rFirst]),
        h('div.field', {}, [h('label', {}, 'Interval (mins)'), rInterval])
      ]),
      h('div.hint', { style: { marginTop: '-4px' } }, 'Editing the first tee time or interval re-spaces this day’s tee times automatically.'),
      h('div.btn-row', {}, [
        h('button.btn.btn-outline', { onclick: redrawThisDay }, '🎲 Redraw this day'),
        h('button.btn.btn-ghost', { onclick: clearGroups }, 'Clear'),
        isLast ? h('button.btn.btn-ghost', { onclick: function () {
          db.updateRound(round.id, { autoReverse: true, groupSize: (t.groupPlan && t.groupPlan.size) || 4, firstTee: rFirst.value || '08:00', interval: parseInt(rInterval.value, 10) || 10 });
          GT.toast('Last day set to auto reverse-leaderboard', 'success'); GT.router.render();
        } }, '⟲ Auto reverse') : null
      ])
    ]));

    var groups = db.getGroups(round.id);
    if (!groups.length) { app.appendChild(GT.emptyState('⛳', 'No groups for this day', 'Use the tournament draw above, or Redraw this day.')); }
    else {
      app.appendChild(groupsView(groups, members, move, setTee));

      // Swap two players (keeps group sizes) — the usual manual tweak.
      var assignedOpts = [];
      groups.forEach(function (g, gi) {
        (g.players || []).forEach(function (pid) {
          var p = db.getPlayer(pid); if (p) assignedOpts.push({ id: pid, label: 'G' + (gi + 1) + ' · ' + GT.displayName(p) });
        });
      });
      var selA = h('select', {}, [h('option', { value: '' }, 'Player…')].concat(assignedOpts.map(function (x) { return h('option', { value: x.id }, x.label); })));
      var selB = h('select', {}, [h('option', { value: '' }, 'Player…')].concat(assignedOpts.map(function (x) { return h('option', { value: x.id }, x.label); })));
      app.appendChild(h('div.card.stack', {}, [
        h('div', { style: { fontWeight: 600 } }, '⇄ Swap two players'),
        h('div.hint', { style: { marginTop: '-4px' } }, 'Exchange two players between groups, keeping group sizes. (To move a single player or drop them out, use the dropdown on each player above.)'),
        h('div.grid2', {}, [
          h('div.field', {}, [h('label', {}, 'Player A'), selA]),
          h('div.field', {}, [h('label', {}, 'Player B'), selB])
        ]),
        h('button.btn.btn-outline.btn-block', { onclick: function () { swap(selA.value, selB.value); } }, '⇄ Swap')
      ]));
    }

    var assigned = {};
    groups.forEach(function (g) { (g.players || []).forEach(function (pid) { assigned[pid] = true; }); });
    var unassigned = members.filter(function (p) { return !assigned[p.id]; });
    if (unassigned.length && groups.length) {
      var u = h('div.stack');
      unassigned.forEach(function (p) {
        var sel = h('select', { onchange: function () { if (sel.value !== '') move(p.id, null, sel.value); } },
          [h('option', { value: '' }, 'Add to…')].concat(groups.map(function (_, j) { return h('option', { value: String(j) }, 'Group ' + (j + 1)); })));
        u.appendChild(h('div.card.grp-player', {}, [
          h('div.grow', {}, [h('span', {}, GT.displayName(p)), h('span.muted', { style: { marginLeft: '6px' } }, 'HI ' + GT.fmtHi(p.handicapIndex))]), sel
        ]));
      });
      app.appendChild(h('h2.section-title', {}, 'Unassigned (' + unassigned.length + ')'));
      app.appendChild(u);
    }
  });

  // Render a set of groups. If move/setTee are provided, rows are editable;
  // otherwise it's read-only (used for the auto reverse-leaderboard day).
  function groupsView(groups, members, move, setTee) {
    function memberById(id) { return members.filter(function (p) { return p.id === id; })[0]; }
    var list = h('div.stack');
    groups.forEach(function (g, gi) {
      var teeNode = setTee
        ? h('input', { type: 'time', value: g.teeTime || '', style: { width: '120px' }, onchange: function () { setTee(gi, teeNode.value); } })
        : h('span', { style: { fontWeight: 700 } }, g.teeTime || '—');
      var players = (g.players || []).map(function (pid) {
        var p = memberById(pid); if (!p) return null;
        var right = move
          ? (function () {
              var sel = h('select', { onchange: function () { move(pid, gi, sel.value); } },
                groups.map(function (_, j) { return h('option', { value: String(j) }, 'Group ' + (j + 1)); }).concat([h('option', { value: 'x' }, 'Remove')]));
              sel.value = String(gi); return sel;
            })()
          : null;
        return h('div.grp-player', {}, [
          h('div.grow', {}, [h('span', {}, GT.displayName(p)), h('span.muted', { style: { marginLeft: '6px' } }, 'HI ' + GT.fmtHi(p.handicapIndex))]),
          right
        ]);
      }).filter(Boolean);
      list.appendChild(h('div.card', {}, [
        h('div.spread', { style: { marginBottom: '8px' } }, [
          h('h3', {}, 'Group ' + (gi + 1) + (gi === 0 ? ' (off first)' : '')),
          h('div.card-row', {}, [h('span.muted', {}, '🕐'), teeNode])
        ]),
        h('div.stack', {}, players)
      ]));
    });
    return list;
  }

  // ===== Dinner Plans ===================================================
  GT.router.register('dinners', function (app) {
    if (!requireAdmin(app)) return;
    var t = db.getActiveTournament();
    app.appendChild(h('h1.page-title', {}, 'Dinner Plans'));
    app.appendChild(h('p.page-sub', {}, 'Add meals per day — restaurant, time and an optional website. Add several on the same day (e.g. lunch and evening). Players see these on the tournament home screen.'));

    var entries = (t.dinners || []).map(function (d) {
      return { id: d.id || db.uid('dinner'), date: d.date || '', time: d.time || '', restaurant: d.restaurant || '', url: d.url || '' };
    });

    var listWrap = h('div.stack');
    function renderList() {
      GT.clear(listWrap);
      if (!entries.length) { listWrap.appendChild(GT.emptyState('🍽', 'No dinner plans yet', 'Tap “Add a meal” below.')); }
      entries.forEach(function (e, idx) {
        var date = h('input', { type: 'date', value: e.date });
        var time = h('input', { type: 'time', value: e.time });
        var rest = h('input', { type: 'text', value: e.restaurant, placeholder: 'e.g. The Ship Inn' });
        var url = h('input', { type: 'url', inputmode: 'url', value: e.url, placeholder: 'https://…  (optional)', autocapitalize: 'off', spellcheck: 'false' });
        date.addEventListener('change', function () { e.date = date.value; });
        time.addEventListener('change', function () { e.time = time.value; });
        rest.addEventListener('input', function () { e.restaurant = rest.value; });
        url.addEventListener('input', function () { e.url = url.value; });
        listWrap.appendChild(h('div.card.stack', {}, [
          h('div.spread', {}, [
            h('div', { style: { fontWeight: 600 } }, 'Meal ' + (idx + 1)),
            h('button.btn.btn-ghost.btn-sm', { onclick: function () { entries.splice(idx, 1); renderList(); } }, '🗑 Remove')
          ]),
          h('div.grid2', {}, [
            h('div.field', {}, [h('label', {}, 'Day'), date]),
            h('div.field', {}, [h('label', {}, 'Time'), time])
          ]),
          h('div.field', {}, [h('label', {}, 'Restaurant'), rest]),
          h('div.field', {}, [h('label', {}, 'Website (optional)'), url,
            h('div.hint', {}, 'Leave blank if there’s no link. Players see it as a tappable link.')])
        ]));
      });
    }
    renderList();
    app.appendChild(listWrap);

    app.appendChild(h('button.btn.btn-outline.btn-block', {
      onclick: function () { entries.push({ id: db.uid('dinner'), date: '', time: '', restaurant: '', url: '' }); renderList(); }
    }, '+ Add a meal'));

    function normUrl(u) { u = (u || '').trim(); if (!u) return ''; if (!/^https?:\/\//i.test(u)) u = 'https://' + u; return u; }
    function save() {
      var clean = entries.filter(function (e) { return (e.restaurant || '').trim(); }).map(function (e) {
        return { id: e.id, date: e.date, time: e.time, restaurant: e.restaurant.trim(), url: normUrl(e.url) };
      });
      clean.sort(function (a, b) { return (a.date + 'T' + a.time).localeCompare(b.date + 'T' + b.time); });
      db.updateTournament({ dinners: clean });
      db.logAdmin('Updated dinner plans (' + clean.length + ' meal' + (clean.length === 1 ? '' : 's') + ')');
      GT.toast('Dinner plans saved', 'success');
      GT.router.go('admin');
    }
    app.appendChild(h('button.btn.btn-primary.btn-block', { style: { marginTop: '10px' }, onclick: save }, 'Save Dinner Plans'));
  });

  // ===== Score management ===============================================
  GT.router.register('scores', function (app, params) {
    if (!requireAdmin(app)) return;
    var rounds = db.getRounds();
    var players = db.getPlayers();
    var roundId = (params && params[0]) || (rounds[0] && rounds[0].id);
    var round = db.getRound(roundId);

    app.appendChild(h('h1.page-title', {}, 'Score Management'));

    // Round selector tabs
    var tabs = h('div.tabs');
    rounds.forEach(function (r) {
      tabs.appendChild(h('button' + (r.id === roundId ? '.active' : ''), {
        onclick: function () { GT.router.go('scores', [r.id]); }
      }, 'R' + r.index));
    });
    app.appendChild(tabs);

    if (!round) { app.appendChild(GT.emptyState('❓', 'No round')); return; }
    if (!round.configured) { app.appendChild(h('div.note.note-amber', {}, 'Configure this round before managing scores.')); return; }
    if (!players.length) { app.appendChild(GT.emptyState('👥', 'No players registered')); return; }

    var list = h('div.stack');
    players.forEach(function (p) {
      var res = util.result(round, p);
      list.appendChild(h('div.card.card-row', {}, [
        h('div.grow', {}, [h('h3', {}, GT.formalName(p)),
          h('div.muted', {}, res.hasScore
            ? ('Mode ' + res.mode + ' · ' + (res.points != null ? res.points + ' pts' : '—') + (res.complete ? '' : ' · incomplete'))
            : 'No score yet')]),
        h('div.wrap', {}, [
          res.locked ? h('span.badge.badge-blue', {}, '🔒') : null,
          h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.router.go('editscore', [round.id, p.id]); } }, 'Edit'),
          h('button.btn.btn-ghost.btn-sm', { onclick: function () { toggleLock(round, p); } }, res.locked ? 'Unlock' : 'Lock')
        ])
      ]));
    });
    app.appendChild(list);

    function toggleLock(round, p) {
      var rec = db.getScore(round.id, p.id) || db.blankScore(round.id, p.id, 'A');
      rec.locked = !rec.locked;
      db.saveScore(rec);
      db.logAdmin((rec.locked ? 'Locked' : 'Unlocked') + ' Round ' + round.index + ' for ' + p.fullName);
      GT.toast(rec.locked ? 'Round locked' : 'Round unlocked', 'success');
      GT.router.render();
    }
  });

  // ===== Admin score editor =============================================
  GT.router.register('editscore', function (app, params) {
    if (!requireAdmin(app)) return;
    var round = db.getRound(params[0]);
    var player = db.getPlayer(params[1]);
    if (!round || !player) { app.appendChild(GT.emptyState('❓', 'Not found')); return; }
    var rec = db.getScore(round.id, player.id) || db.blankScore(round.id, player.id, 'A');
    var ch = util.courseHcp(round, player) || 0;

    app.appendChild(h('h1.page-title', {}, 'Edit: ' + GT.formalName(player)));
    app.appendChild(h('p.page-sub', {}, 'Round ' + round.index + ' · ' + round.courseName + ' · Course Hcp ' + ch));

    // Mode + lock controls
    var modeTabs = h('div.tabs', {}, [
      h('button' + (rec.mode === 'A' ? '.active' : ''), { onclick: function () { setMode('A'); } }, 'Hole-by-hole'),
      h('button' + (rec.mode === 'B' ? '.active' : ''), { onclick: function () { setMode('B'); } }, 'Summary')
    ]);
    app.appendChild(modeTabs);
    function setMode(m) {
      if (m === rec.mode) return;
      GT.confirm('Switch this player to mode ' + m + '? Existing entries for this round will be cleared.', function () {
        var fresh = db.blankScore(round.id, player.id, m); fresh.locked = rec.locked;
        db.saveScore(fresh); db.logAdmin('Switched ' + player.fullName + ' to mode ' + m + ' (R' + round.index + ')');
        GT.router.render();
      });
    }

    var body = h('div');
    app.appendChild(body);
    if (rec.mode === 'A') renderHoleEditor(body, round, player, rec, ch);
    else renderSummaryEditor(body, round, player, rec);

    app.appendChild(h('div.card', {}, [
      h('div.spread', {}, [
        h('div', {}, [h('div', { style: { fontWeight: 600 } }, rec.locked ? 'Round locked' : 'Round open'),
          h('div.muted', {}, 'Locked rounds can’t be edited by the player.')]),
        h('button.btn.btn-outline.btn-sm', { onclick: function () {
          rec.locked = !rec.locked; db.saveScore(rec);
          db.logAdmin((rec.locked ? 'Locked' : 'Unlocked') + ' R' + round.index + ' for ' + player.fullName);
          GT.router.render();
        } }, rec.locked ? 'Unlock' : 'Lock')
      ])
    ]));
    app.appendChild(h('button.btn.btn-primary.btn-block', { onclick: function () { GT.router.go('scores', [round.id]); } }, 'Done'));
  });

  function renderHoleEditor(body, round, player, rec, ch) {
    var n = round.numHoles || 18;
    var grid = h('div.sc-wrap');
    var head = [h('th.rowhead', {}, 'Hole'), h('th', {}, 'Par'), h('th', {}, 'SI'), h('th', {}, 'Shots'), h('th', {}, 'Gross'), h('th', {}, 'Pts')];
    var rows = [];
    for (var i = 0; i < n; i++) {
      (function (i) {
        var par = Number(round.par[i]), si = Number(round.strokeIndex[i]);
        var shots = golf.shotsReceived(ch, si);
        var ptsCell = h('td', {});
        var input = h('input.inline-num', { type: 'number', min: '1', max: '20', inputmode: 'numeric',
          value: (rec.holes[i] != null && rec.holes[i] !== 'NR') ? rec.holes[i] : '' });
        function update() {
          var v = input.value.trim();
          rec.holes[i] = v === '' ? null : Math.min(20, Math.max(1, parseInt(v, 10) || 0)) || null;
          db.saveScore(rec);
          var net = rec.holes[i] == null ? null : rec.holes[i] - shots;
          var pts = golf.stablefordPoints(par, net);
          ptsCell.textContent = rec.holes[i] == null ? '0' : String(pts);
        }
        input.addEventListener('change', update);
        var net0 = rec.holes[i] == null ? null : rec.holes[i] - shots;
        ptsCell.textContent = String(golf.stablefordPoints(par, net0));
        rows.push(h('tr', {}, [h('td.rowhead', {}, String(i + 1)), h('td', {}, String(par)), h('td', {}, String(si)),
          h('td', {}, shots ? String(shots) : '–'), h('td', {}, input), ptsCell]));
      })(i);
    }
    grid.appendChild(h('table.sc', {}, [h('thead', {}, [h('tr', {}, head)]), h('tbody', {}, rows)]));
    body.appendChild(h('div.card', {}, [h('div.muted', { style: { marginBottom: '8px' } }, 'Override any hole — changes save instantly and are logged.'), grid]));
    db.logAdmin('Opened score editor for ' + player.fullName + ' (R' + round.index + ')');
  }

  function renderSummaryEditor(body, round, player, rec) {
    var gross = h('input', { type: 'number', min: '1', value: rec.summaryGross != null ? rec.summaryGross : '' });
    var stab = h('input', { type: 'number', min: '0', value: rec.summaryStableford != null ? rec.summaryStableford : '' });
    body.appendChild(h('div.card.stack', {}, [
      h('div.field', {}, [h('label', {}, 'Total Gross'), gross]),
      h('div.field', {}, [h('label', {}, 'Total Stableford'), stab]),
      h('button.btn.btn-outline', { onclick: function () {
        rec.summaryGross = gross.value === '' ? null : parseInt(gross.value, 10);
        rec.summaryStableford = stab.value === '' ? null : parseInt(stab.value, 10);
        db.saveScore(rec); db.logAdmin('Edited summary for ' + player.fullName + ' (R' + round.index + ')');
        GT.toast('Saved', 'success');
      } }, 'Save summary')
    ]));
  }

  // ===== Export / backup / reset ========================================
  function downloadFile(name, content, type) {
    var blob = new Blob([content], { type: type || 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportCsv() {
    var rounds = db.getRounds(), players = db.getPlayers();
    var rows = [['Round', 'Course', 'Player', 'Nickname', 'Handicap Index', 'Course Handicap', 'Mode', 'Gross', 'Net', 'Stableford', 'Holes Played', 'Complete', 'Locked']];
    rounds.forEach(function (r) {
      if (!r.configured) return;
      players.forEach(function (p) {
        var res = util.result(r, p);
        if (!res.hasScore) return;
        rows.push([r.index, r.courseName, p.fullName, p.nickname || '', GT.fmtHi(p.handicapIndex), res.courseHcp,
          res.mode, res.gross != null ? res.gross : '', res.net != null ? res.net : '',
          res.points != null ? res.points : '', res.played, res.complete ? 'Y' : 'N', res.locked ? 'Y' : 'N']);
      });
    });
    var csv = rows.map(function (r) { return r.map(function (c) {
      var s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(','); }).join('\n');
    downloadFile((db.getTournament().name || 'tournament').replace(/\s+/g, '_') + '_scores.csv', csv, 'text/csv');
    GT.toast('CSV exported', 'success');
  }

  function exportBackup() {
    downloadFile((db.getTournament().name || 'tournament').replace(/\s+/g, '_') + '_backup.json', db.exportJSON(), 'application/json');
    GT.toast('Backup downloaded', 'success');
  }

  GT.adminExportCsv = exportCsv;
})(window.GT = window.GT || {});
