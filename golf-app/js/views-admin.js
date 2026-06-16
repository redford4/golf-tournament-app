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
      h('div.card.pill-stat', {}, [h('div.v', {}, players.length), h('div.k', {}, 'Players')]),
      h('div.card.pill-stat', {}, [h('div.v', {}, countSubmissions()), h('div.k', {}, 'Scores in')])
    ]));

    app.appendChild(h('div.wrap', { style: { marginBottom: '8px' } }, [
      h('button.btn.btn-primary.btn-sm', { onclick: function () { GT.router.go('setup'); } }, '⚙ Setup'),
      h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.router.go('courses'); } }, '🗺 Courses'),
      h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.router.go('players'); } }, '👥 Players'),
      h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.router.go('scores'); } }, '📝 Scores')
    ]));

    // Completion matrix
    app.appendChild(h('h2.section-title', {}, 'Completion status'));
    if (!players.length) {
      app.appendChild(GT.emptyState('👥', 'No players registered yet'));
    } else {
      var head = [h('th.rowhead', {}, 'Player')];
      rounds.forEach(function (r) { head.push(h('th', {}, 'R' + r.index)); });
      var body = players.map(function (p) {
        var row = [h('td.rowhead', {}, p.fullName)];
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
    var d = db.load();
    return Object.keys(d.scores).filter(function (k) {
      var s = d.scores[k];
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
      playerCode: h('input', { type: 'text', value: t.playerCode, autocapitalize: 'off' }),
      adminCode: h('input', { type: 'text', value: t.adminCode, autocapitalize: 'off' }),
      estimate: h('input', { type: 'checkbox' }),
      sessionHours: h('input', { type: 'number', min: '1', value: t.sessionHours })
    };
    f.estimate.checked = !!t.estimateNetForSummary;

    function save() {
      var name = f.name.value.trim();
      var nr = parseInt(f.numRounds.value, 10);
      var pc = f.playerCode.value.trim();
      var ac = f.adminCode.value.trim();
      if (!name) { GT.toast('Tournament name is required.', 'error'); return; }
      if (!nr || nr < 1) { GT.toast('Number of rounds must be at least 1.', 'error'); return; }
      if (!pc || !ac) { GT.toast('Both access codes are required.', 'error'); return; }
      if (pc === ac) { GT.toast('Admin code must be different from the player code.', 'error'); return; }
      db.updateTournament({ name: name, numRounds: nr, playerCode: pc, adminCode: ac,
        estimateNetForSummary: f.estimate.checked, sessionHours: parseInt(f.sessionHours.value, 10) || 4 });
      db.logAdmin('Updated tournament settings');
      GT.toast('Settings saved', 'success');
      GT.router.go('admin');
    }

    app.appendChild(h('div.card.stack', {}, [
      h('div.field', {}, [h('label', {}, 'Tournament Name'), f.name]),
      h('div.field', {}, [h('label', {}, 'Number of Rounds'), f.numRounds,
        h('div.hint', {}, 'Default 4. Adding rounds creates new empty round slots.')]),
      h('div.grid2', {}, [
        h('div.field', {}, [h('label', {}, 'Player Access Code'), f.playerCode]),
        h('div.field', {}, [h('label', {}, 'Admin Access Code'), f.adminCode])
      ]),
      h('div.field', {}, [
        h('label', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, [f.estimate,
          h('span', {}, 'Estimate Net for summary scores (gross − course handicap)')]),
        h('div.hint', {}, 'PRD 7.3.2 — if off, Net shows N/A for summary-entry rounds.')
      ]),
      h('div.field', {}, [h('label', {}, 'Session timeout (hours)'), f.sessionHours]),
      h('button.btn.btn-primary.btn-block', { onclick: save }, 'Save Settings')
    ]));

    // Data tools
    app.appendChild(h('h2.section-title', {}, 'Data'));
    app.appendChild(h('div.card.stack', {}, [
      h('div.btn-row', {}, [
        h('button.btn.btn-outline', { onclick: exportCsv }, '⬇ Export CSV'),
        h('button.btn.btn-outline', { onclick: exportBackup }, '⬇ Backup (JSON)')
      ]),
      h('button.btn.btn-outline.btn-block', { onclick: importBackup }, '⬆ Restore from backup'),
      h('hr.divider'),
      h('button.btn.btn-danger.btn-block', { onclick: resetAll }, '⚠ Reset Tournament')
    ]));
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
      slopeRating: h('input', { type: 'number', value: round.slopeRating != null ? round.slopeRating : '', placeholder: 'e.g. 131' })
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
        numHoles: holesN, courseRating: cr, slopeRating: sl, par: par, strokeIndex: si, yardage: yd,
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
      ])
    ]));
    app.appendChild(h('div.card', {}, [
      h('div.spread', { style: { marginBottom: '8px' } }, [
        h('div', { style: { fontWeight: 600 } }, 'Par, Stroke Index & Yardage'),
        h('button.btn.btn-ghost.btn-sm', { onclick: fillStandardPar }, 'Fill standard par 72')
      ]),
      holesWrap,
      h('div.hint', { style: { marginTop: '8px' } }, 'Stroke Index must be a complete 1–' + n + ' set with no duplicates. Yardage is optional.')
    ]));

    function fillStandardPar() {
      var std = [4,4,4,3,4,5,4,3,5, 4,4,3,4,5,4,4,3,5]; // a common par-72 layout
      var holesN = parseInt(meta.numHoles.value, 10);
      for (var i = 0; i < holesN; i++) {
        if (!parInputs[i].value) parInputs[i].value = std[i] || 4;
        if (!siInputs[i].value) siInputs[i].value = i + 1;
      }
      GT.toast('Filled defaults — adjust as needed.', '');
    }

    app.appendChild(h('button.btn.btn-primary.btn-block', { onclick: save }, 'Save Course'));
  });

  // ===== Player management ==============================================
  GT.router.register('players', function (app) {
    if (!requireAdmin(app)) return;
    app.appendChild(h('h1.page-title', {}, 'Player Management'));
    var players = db.getPlayers();
    if (!players.length) app.appendChild(GT.emptyState('👥', 'No players yet', 'Players self-register, or add them here.'));

    var list = h('div.stack');
    players.forEach(function (p) {
      var dup = db.findDuplicateCdh(p.cdhId, p.id);
      list.appendChild(h('div.card.card-row', {}, [
        h('div.grow', {}, [h('h3', {}, p.fullName),
          h('div.muted', {}, 'HI ' + GT.fmtHi(p.handicapIndex) + (p.cdhId ? ' · CDH ' + p.cdhId : '')),
          h('div.muted', {}, p.username ? ('@' + p.username) : '⚠ no login set'),
          dup ? h('span.badge.badge-amber', { style: { marginTop: '4px' } }, '⚠ Duplicate CDH') : null]),
        h('div.wrap', {}, [
          h('button.btn.btn-outline.btn-sm', { onclick: function () { editPlayer(p); } }, 'Edit'),
          h('button.btn.btn-ghost.btn-sm', { onclick: function () { removePlayer(p); } }, '🗑')
        ])
      ]));
    });
    app.appendChild(list);
    app.appendChild(h('button.btn.btn-primary.btn-block', { onclick: function () { editPlayer(null); } }, '+ Add player'));

    function editPlayer(p) {
      var holder = h('div');
      GT.registrationForm(holder, { player: p, isAdmin: true, onSaved: function () { close(); GT.router.render(); } });
      var close = GT.modal({ title: p ? 'Edit player' : 'Add player', body: holder, actions: [{ label: 'Cancel', kind: 'ghost' }] });
    }
    function removePlayer(p) {
      GT.confirm('Remove ' + p.fullName + ' and all their scores? This cannot be undone.', function () {
        db.removePlayer(p.id); db.logAdmin('Removed player ' + p.fullName); GT.toast('Player removed', 'success'); GT.router.render();
      }, { danger: true, yesLabel: 'Remove' });
    }
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
        h('div.grow', {}, [h('h3', {}, p.fullName),
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

    app.appendChild(h('h1.page-title', {}, 'Edit: ' + player.fullName));
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
    var rows = [['Round', 'Course', 'Player', 'Handicap Index', 'Course Handicap', 'Mode', 'Gross', 'Net', 'Stableford', 'Holes Played', 'Complete', 'Locked']];
    rounds.forEach(function (r) {
      if (!r.configured) return;
      players.forEach(function (p) {
        var res = util.result(r, p);
        if (!res.hasScore) return;
        rows.push([r.index, r.courseName, p.fullName, GT.fmtHi(p.handicapIndex), res.courseHcp,
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

  function importBackup() {
    var input = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    input.addEventListener('change', function () {
      var file = input.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try { db.importJSON(reader.result); GT.toast('Backup restored', 'success'); GT.router.go('admin'); }
        catch (e) { GT.toast('Invalid backup file.', 'error'); }
      };
      reader.readAsText(file);
    });
    document.body.appendChild(input); input.click(); input.remove();
  }

  function resetAll() {
    GT.confirm('Reset the ENTIRE tournament? All players, courses and scores will be permanently deleted. Consider downloading a backup first.',
      function () {
        db.resetTournament(); GT.state.logout(); GT.toast('Tournament reset', 'success');
      }, { danger: true, yesLabel: 'Reset everything' });
  }

  GT.adminExportCsv = exportCsv;
})(window.GT = window.GT || {});
