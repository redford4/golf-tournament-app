/*
 * views-leaderboard.js — Round and Overall leaderboards (PRD 9), with
 * sortable columns, tie handling (=1, =3), and incomplete-round markers.
 */
(function (GT) {
  'use strict';
  var h = GT.h, db = GT.db, util = GT.util;

  // Session-persisted sort preference.
  var sortState = { round: { key: 'net', dir: 'asc' }, overall: { key: 'points', dir: 'desc' } };

  GT.router.register('leaderboard', function (app, params, query) {
    var rounds = db.getRounds().filter(function (r) { return r.configured; });
    var view = (query && query.view) || 'overall';
    var roundId = (query && query.round) || (rounds[0] && rounds[0].id);

    app.appendChild(h('h1.page-title', {}, 'Leaderboards'));

    app.appendChild(h('div.tabs', {}, [
      h('button' + (view === 'overall' ? '.active' : ''), { onclick: function () { GT.router.go('leaderboard', [], { view: 'overall' }); } }, 'Overall'),
      h('button' + (view === 'round' ? '.active' : ''), { onclick: function () { GT.router.go('leaderboard', [], { view: 'round', round: roundId }); } }, 'By Round')
    ]));

    if (!db.getPlayers().length) { app.appendChild(GT.emptyState('🏆', 'No players yet', 'Leaderboards appear once golfers register and score.')); return; }
    if (!rounds.length) { app.appendChild(GT.emptyState('🗺', 'No courses configured', 'The admin needs to set up at least one round.')); return; }

    if (view === 'round') renderRound(app, rounds, roundId);
    else renderOverall(app, rounds);
  });

  function header(label, key, st, onSort, cls) {
    var sorted = st.key === key;
    return h('th' + (cls ? cls : '') + '.sortable' + (sorted ? '.sorted' : '') + (sorted && st.dir === 'asc' ? '.asc' : ''),
      { onclick: function () { onSort(key); } }, label);
  }

  // Assign positions with ties (=) given an already-sorted array + comparator key.
  function withPositions(rows, valueOf) {
    var pos = 0, lastVal = null, lastPos = 0;
    rows.forEach(function (row, idx) {
      var v = valueOf(row);
      pos = idx + 1;
      if (idx > 0 && v === lastVal) { row._pos = lastPos; row._tie = true; }
      else { row._pos = pos; lastPos = pos; row._tie = false; }
      lastVal = v;
    });
    // mark ties symmetrically
    rows.forEach(function (row, idx) {
      var sameAbove = idx > 0 && valueOf(rows[idx - 1]) === valueOf(row);
      var sameBelow = idx < rows.length - 1 && valueOf(rows[idx + 1]) === valueOf(row);
      row._tie = sameAbove || sameBelow;
    });
    return rows;
  }

  function sortRows(rows, key, dir) {
    var mult = dir === 'asc' ? 1 : -1;
    if (key === 'name') {
      rows.sort(function (a, b) { return (a.name || '').localeCompare(b.name || '') * mult; });
      return rows;
    }
    rows.sort(function (a, b) {
      var av = a[key], bv = b[key];
      var an = av == null || isNaN(av), bn = bv == null || isNaN(bv);
      if (an && bn) return 0;
      if (an) return 1;        // nulls always last, regardless of direction
      if (bn) return -1;
      if (av === bv) return (a.name || '').localeCompare(b.name || '');
      return (av - bv) * mult;
    });
    return rows;
  }

  function nameCell(row, you) {
    return h('td.name' + (row.you ? '' : ''), {}, [
      row.name + (row.incomplete ? ' *' : ''),
      row.modeB ? h('span.badge.badge-grey', { style: { marginLeft: '6px' } }, 'S') : null
    ]);
  }

  // ---- Round leaderboard ------------------------------------------------
  function renderRound(app, rounds, roundId) {
    var round = db.getRound(roundId) || rounds[0];
    var selector = h('select', { onchange: function () { GT.router.go('leaderboard', [], { view: 'round', round: selector.value }); } },
      rounds.map(function (r) { return h('option', { value: r.id }, 'Round ' + r.index + (r.courseName ? ' — ' + r.courseName : '')); }));
    selector.value = round.id;
    app.appendChild(h('div.field', {}, selector));

    var me = GT.state.currentPlayer();
    var rows = db.getPlayers().map(function (p) {
      var res = util.result(round, p);
      return {
        id: p.id, name: GT.displayName(p), you: me && me.id === p.id,
        hi: p.handicapIndex, ch: res.courseHcp,
        gross: res.hasScore ? res.gross : null,
        net: res.net,
        points: res.hasScore ? res.points : null,
        incomplete: res.hasScore && !res.complete,
        modeB: res.mode === 'B',
        hasScore: res.hasScore
      };
    }).filter(function (r) { return r.hasScore; });

    if (!rows.length) { app.appendChild(GT.emptyState('⛳', 'No scores yet for this round')); return; }

    var st = sortState.round;
    function onSort(key) { st.dir = (st.key === key) ? (st.dir === 'asc' ? 'desc' : 'asc') : defaultDir(key); st.key = key; GT.router.render(); }

    sortRows(rows, st.key, st.dir);
    withPositions(rows, function (r) { return r[st.key]; });

    var head = h('tr', {}, [
      h('th.pos', {}, '#'),
      header('Player', 'name', st, onSort, '.name'),
      header('HI', 'hi', st, onSort),
      header('CH', 'ch', st, onSort),
      header('Gross', 'gross', st, onSort),
      header('Net', 'net', st, onSort),
      header('Points', 'points', st, onSort)
    ]);
    var body = rows.map(function (r) {
      return h('tr.lb-row' + (r.you ? '.you-row' : ''), {
        onclick: function () { GT.router.go('viewcard', [round.id, r.id]); }
      }, [
        h('td.pos', {}, (r._tie ? '=' : '') + r._pos),
        nameCell(r),
        h('td', {}, GT.fmtHi(r.hi)),
        h('td', {}, r.ch == null ? '—' : r.ch),
        h('td', {}, r.gross == null ? '—' : r.gross),
        h('td', {}, r.net == null ? 'N/A' : r.net),
        h('td.hi', {}, r.points == null ? '—' : r.points)
      ]);
    });
    app.appendChild(h('div.card', { style: { overflowX: 'auto' } }, h('table.lb', {}, [h('thead', {}, [head]), h('tbody', {}, body)])));
    legend(app, 'round');
  }

  // ---- Overall leaderboard ----------------------------------------------
  function renderOverall(app, rounds) {
    var me = GT.state.currentPlayer();
    var rows = db.getPlayers().map(function (p) {
      var gross = 0, net = 0, points = 0, played = 0, anyNet = false, anyScore = false, allComplete = true, anyB = false;
      rounds.forEach(function (round) {
        var res = util.result(round, p);
        if (!res.hasScore) { allComplete = false; return; }
        anyScore = true; played++;
        if (res.gross != null) gross += res.gross;
        if (res.points != null) points += res.points;
        if (res.net != null) { net += res.net; anyNet = true; }
        if (!res.complete) allComplete = false;
        if (res.mode === 'B') anyB = true;
      });
      return {
        id: p.id, name: GT.displayName(p), you: me && me.id === p.id, hi: p.handicapIndex,
        gross: anyScore ? gross : null, net: anyNet ? net : null, points: anyScore ? points : null,
        rounds: played, incomplete: anyScore && (played < rounds.length || !allComplete),
        modeB: anyB, hasScore: anyScore
      };
    }).filter(function (r) { return r.hasScore; });

    if (!rows.length) { app.appendChild(GT.emptyState('🏆', 'No scores in yet')); return; }

    var st = sortState.overall;
    function onSort(key) { st.dir = (st.key === key) ? (st.dir === 'asc' ? 'desc' : 'asc') : defaultDir(key); st.key = key; GT.router.render(); }

    sortRows(rows, st.key, st.dir);
    withPositions(rows, function (r) { return r[st.key]; });

    var head = h('tr', {}, [
      h('th.pos', {}, '#'),
      header('Player', 'name', st, onSort, '.name'),
      header('HI', 'hi', st, onSort),
      header('Gross', 'gross', st, onSort),
      header('Net', 'net', st, onSort),
      header('Points', 'points', st, onSort),
      h('th', {}, 'Rds')
    ]);
    var body = rows.map(function (r) {
      return h('tr.lb-row' + (r.you ? '.you-row' : ''), {
        onclick: function () { GT.router.go('viewplayer', [r.id]); }
      }, [
        h('td.pos', {}, (r._tie ? '=' : '') + r._pos),
        nameCell(r),
        h('td', {}, GT.fmtHi(r.hi)),
        h('td', {}, r.gross == null ? '—' : r.gross),
        h('td', {}, r.net == null ? 'N/A' : r.net),
        h('td.hi', {}, r.points == null ? '—' : r.points),
        h('td', {}, r.rounds + '/' + rounds.length)
      ]);
    });
    app.appendChild(h('div.card', { style: { overflowX: 'auto' } }, h('table.lb', {}, [h('thead', {}, [head]), h('tbody', {}, body)])));
    legend(app, 'overall');
  }

  function defaultDir(key) {
    // Lower is better for stroke columns; higher is better for points.
    if (key === 'points') return 'desc';
    if (key === 'name') return 'asc';
    if (key === 'hi') return 'asc';
    return 'asc'; // gross/net/ch ascending
  }

  function legend(app, which) {
    app.appendChild(h('div.note.note-blue', { style: { marginTop: '10px', fontSize: '.82rem' } },
      which === 'round' ? '👆 Tap any player to view their scorecard for this round.'
                        : '👆 Tap any player to view their rounds and scorecards.'));
    app.appendChild(h('div.muted', { style: { fontSize: '.78rem', marginTop: '8px' } },
      '* incomplete round · S = summary entry · =n tied position · tap a column header to sort'));
  }
})(window.GT = window.GT || {});
