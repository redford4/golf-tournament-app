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

    if (GT.tournamentComplete()) {
      app.appendChild(h('button.btn.btn-primary.btn-block.final-cta', { style: { marginBottom: '14px' },
        onclick: function () { GT.router.go('results'); } }, '🏆 Tournament complete — see the winner!'));
    }

    if (view === 'round') renderRound(app, rounds, roundId);
    else renderOverall(app, rounds);
  });

  // ---- Final standings with tie-breaks --------------------------------
  // Has every member submitted every configured round? (a picked-up/NR hole
  // still counts as submitted; a blank hole does not).
  function roundDone(round, player) {
    var rec = db.getScore(round.id, player.id);
    if (!rec) return false;
    if (rec.mode === 'B') return rec.summaryGross != null;
    var n = round.numHoles || 18;
    for (var i = 0; i < n; i++) { if (rec.holes[i] == null) return false; }
    return true;
  }

  GT.tournamentComplete = function () {
    var t = db.getActiveTournament();
    if (!t) return false;
    var rounds = db.getRoundsFor(t.id).filter(function (r) { return r.configured; });
    var members = db.getPlayers();
    if (!rounds.length || !members.length) return false;
    return members.every(function (p) {
      return rounds.every(function (r) { return roundDone(r, p); });
    });
  };

  // Given an array of round entries (each either null/no-score, or an object
  // carrying a numeric `key` field), flag the lowest-scoring ones beyond
  // `bestOf` as `.dropped = true` in place, so the UI can show which rounds
  // didn't count toward the total. No-op when `bestOf` is off or there
  // aren't more scored rounds than `bestOf` to begin with.
  function markDropped(entries, bestOf, key) {
    key = key || 'points';
    var scored = [];
    entries.forEach(function (e, i) { if (e && e[key] != null) scored.push({ i: i, v: e[key] }); });
    if (!bestOf || scored.length <= bestOf) return;
    var kept = {};
    scored.slice().sort(function (a, b) { return b.v - a.v; }).slice(0, bestOf)
      .forEach(function (s) { kept[s.i] = true; });
    scored.forEach(function (s) { entries[s.i].dropped = !kept[s.i]; });
  }

  // Final standings, sorted best-first with the tie-break chain:
  // total Stableford → last round Stableford → last round back-9 Stableford.
  GT.finalStandings = function () {
    var t = db.getActiveTournament();
    var rounds = db.getRoundsFor(t.id).filter(function (r) { return r.configured; });
    var members = db.getPlayers();
    var lastRound = rounds[rounds.length - 1];
    var bestOf = t.bestOfRounds || 0;

    var rows = members.map(function (p) {
      var gross = 0, net = 0, anyNet = false;
      var perRound = rounds.map(function (r) {
        var res = util.result(r, p);
        if (res.gross != null) gross += res.gross;
        if (res.net != null) { net += res.net; anyNet = true; }
        return { round: r, points: res.points, gross: res.gross, net: res.net, mode: res.mode, complete: res.complete, courseHcp: res.courseHcp };
      });
      markDropped(perRound, bestOf);
      var total = GT.golf.bestOfTotal(perRound.map(function (pr) { return pr.points; }), bestOf);
      var lr = util.result(lastRound, p);
      var lrBack9 = null;
      if (lr.mode === 'A' && lr.record) {
        var comp = GT.golf.computeRound(lastRound, util.courseHcp(lastRound, p) || 0, lr.record.holes);
        lrBack9 = comp.totals.backPoints;
      }
      return { player: p, total: total, gross: gross, net: anyNet ? net : null,
        perRound: perRound, lrPoints: lr.points || 0, lrBack9: lrBack9 };
    });

    rows.sort(function (a, b) {
      if (b.total !== a.total) return b.total - a.total;
      if (b.lrPoints !== a.lrPoints) return b.lrPoints - a.lrPoints;
      if (a.lrBack9 != null && b.lrBack9 != null && b.lrBack9 !== a.lrBack9) return b.lrBack9 - a.lrBack9;
      return GT.displayName(a.player).localeCompare(GT.displayName(b.player));
    });

    // Positions: share a place only when every tie-break key is equal.
    function key(r) { return r.total + '|' + r.lrPoints + '|' + (r.lrBack9 == null ? 'x' : r.lrBack9); }
    var lastKey = null, lastPos = 0;
    rows.forEach(function (r, i) {
      if (i > 0 && key(r) === lastKey) { r.pos = lastPos; r.tie = true; rows[i - 1].tie = true; }
      else { r.pos = i + 1; lastPos = r.pos; r.tie = false; }
      lastKey = key(r);
    });
    return { rows: rows, rounds: rounds, lastRound: lastRound, bestOf: bestOf };
  };

  // Derive a round's groups from the CURRENT standings in reverse order (worst
  // players out first), for an auto reverse-leaderboard last day. Recomputed on
  // every read, so it tracks the leaderboard as scores come in.
  function toMin(s) { var m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; }
  function toTime(n) { n = ((n % 1440) + 1440) % 1440; var hh = Math.floor(n / 60), mm = n % 60; return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm; }
  GT.reverseLeaderboardGroups = function (round) {
    var t = db.getActiveTournament(); if (!t) return [];
    var others = db.getRoundsFor(t.id).filter(function (r) { return r.configured && r.id !== round.id; });
    var standing = db.getPlayers().map(function (p) {
      var pts = 0;
      others.forEach(function (r) { var res = util.result(r, p); if (res.hasScore && res.points != null) pts += res.points; });
      return { id: p.id, pts: pts, name: GT.displayName(p) };
    });
    standing.sort(function (a, b) { return a.pts - b.pts || a.name.localeCompare(b.name); }); // worst first
    var ids = standing.map(function (s) { return s.id; });
    var sizes = GT.golf.groupSizes(ids.length, round.groupSize || 4);
    var base = toMin(round.firstTee || '08:00'); if (base == null) base = 480;
    var step = round.interval || 10;
    var groups = [], k = 0;
    sizes.forEach(function (s, i) { groups.push({ id: 'auto_' + round.id + '_' + i, players: ids.slice(k, k + s), teeTime: toTime(base + i * step) }); k += s; });
    return groups;
  };

  function medal(pos) { return pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : String(pos); }

  // Count GROSS birdies (1 under par) and eagles-or-better (2+ under par) from a
  // player's hole-by-hole record. Summary (mode B) rounds have no per-hole data.
  function grossBE(round, rec) {
    var out = { birdies: 0, eagles: 0 };
    if (!rec || rec.mode === 'B' || !rec.holes) return out;
    var n = round.numHoles || 18;
    for (var i = 0; i < n; i++) {
      var g = rec.holes[i];
      if (g == null || g === 'NR' || g === 0) continue; // blank or no-return
      var par = Number(round.par[i]); if (!par) continue;
      var diff = par - Number(g);
      if (diff === 1) out.birdies++;
      else if (diff >= 2) out.eagles++;
    }
    return out;
  }

  function confetti() {
    var wrap = h('div.confetti', { 'aria-hidden': 'true' });
    var colors = ['#ffd23f', '#0b6e4f', '#1b6ca8', '#e0533d', '#8e44ad', '#ff8fab'];
    for (var i = 0; i < 60; i++) {
      wrap.appendChild(h('span.confetti-bit', { style: {
        left: Math.random() * 100 + '%',
        background: colors[i % colors.length],
        animationDelay: (Math.random() * 3).toFixed(2) + 's',
        animationDuration: (2.6 + Math.random() * 2.4).toFixed(2) + 's',
        transform: 'rotate(' + Math.floor(Math.random() * 360) + 'deg)'
      } }));
    }
    return wrap;
  }

  // ---- Results / winner page (celebratory) ----------------------------
  GT.router.register('results', function (app) {
    var t = db.getActiveTournament();
    if (!t) { GT.router.go('login'); return; }
    var canOrg = GT.state.canOrganise();
    var back = h('button.btn.btn-outline.btn-block', { style: { marginTop: '14px' },
      onclick: function () {
        if (canOrg) GT.router.go('admin');
        else GT.router.go('leaderboard', [], { view: 'overall' });
      } }, canOrg ? '← Back to dashboard' : '← Back to leaderboard');

    var complete = GT.tournamentComplete();
    var isAdmin = canOrg;

    // Not finished: players see a "come back later" note; the organiser gets a
    // provisional preview of how the podium looks so far.
    if (!complete && !isAdmin) {
      app.appendChild(h('h1.page-title', {}, 'Final Results'));
      app.appendChild(GT.emptyState('⛳', 'Not finished yet', 'The winner is revealed once every player has completed every round.'));
      app.appendChild(back);
      return;
    }
    var preview = !complete;

    var data = GT.finalStandings();
    var rows = data.rows, winner = rows[0];
    if (!winner) {
      app.appendChild(h('h1.page-title', {}, 'Final Results'));
      app.appendChild(GT.emptyState('👥', 'No players yet'));
      app.appendChild(back);
      return;
    }
    var wonOnCountback = rows.length > 1 && rows[1].total === winner.total;

    if (preview) {
      var members = db.getPlayers();
      var remaining = members.filter(function (p) { return !data.rounds.every(function (r) { return roundDone(r, p); }); }).length;
      app.appendChild(h('div.note.note-amber', { style: { marginBottom: '12px' } },
        '👀 Preview — provisional standings. ' + remaining + ' player' + (remaining === 1 ? '' : 's') + ' still to finish. The winner may change.'));
    }

    app.appendChild(confetti());

    // Hero
    app.appendChild(h('div.results-hero', {}, [
      h('div.rh-trophy', {}, '🏆'),
      h('div.rh-label', {}, preview ? 'CURRENT LEADER' : 'CHAMPION'),
      h('div.rh-name', {}, GT.displayName(winner.player)),
      h('div.rh-points', {}, [h('span.rh-num', {}, String(winner.total)), h('span.rh-unit', {}, ' pts')]),
      h('div.rh-sub', {}, winner.total + ' Stableford points — ' + (data.bestOf
        ? 'best ' + data.bestOf + ' of ' + data.rounds.length + ' rounds'
        : 'across ' + data.rounds.length + ' round' + (data.rounds.length === 1 ? '' : 's'))),
      wonOnCountback ? h('div.rh-countback', {}, '✦ Won on countback (better final round)') : null,
      h('div.rh-tourn', {}, t.name)
    ]));

    // Podium (2nd, 1st, 3rd)
    var podium = h('div.podium');
    [1, 0, 2].forEach(function (idx) {
      var r = rows[idx];
      if (!r) { podium.appendChild(h('div.podium-col.empty')); return; }
      var place = idx + 1;
      podium.appendChild(h('div.podium-col.p' + place, {}, [
        h('div.podium-medal', {}, medal(place)),
        h('div.podium-name', {}, GT.displayName(r.player)),
        h('div.podium-pts', {}, r.total + ' pts'),
        h('div.podium-block', {}, h('span', {}, place === 1 ? '1st' : place === 2 ? '2nd' : '3rd'))
      ]));
    });
    app.appendChild(podium);

    // Winner's round-by-round breakdown
    var breakdown = h('div.card', {}, [h('div.muted', { style: { fontWeight: 600, marginBottom: '8px' } }, '🏅 ' + GT.displayName(winner.player) + ' — winning card')]);
    var rowsEls = winner.perRound.map(function (pr) {
      return h('div.kv' + (pr.dropped ? '.dropped-round' : ''), {}, [
        h('span.k', {}, 'R' + pr.round.index + ' · ' + (pr.round.courseName || 'Course')),
        h('span.v', {}, (pr.points != null ? pr.points + ' pts' : '—') + (pr.gross != null ? ' · ' + pr.gross + ' gross' : '') + (pr.dropped ? ' · dropped' : ''))
      ]);
    });
    breakdown.appendChild(h('div', {}, rowsEls));
    if (data.bestOf) {
      breakdown.appendChild(h('div.muted', { style: { fontSize: '.78rem', marginTop: '4px' } },
        'Best ' + data.bestOf + ' of ' + data.rounds.length + ' rounds count — dropped rounds shown above.'));
    }
    breakdown.appendChild(h('div.kv', { style: { borderTop: '2px solid var(--green)', marginTop: '4px' } }, [
      h('span.k', { style: { fontWeight: 700 } }, 'Total'),
      h('span.v', { style: { fontWeight: 800, color: 'var(--green-dark)' } }, winner.total + ' pts · ' + winner.gross + ' gross' + (winner.net != null ? ' · ' + winner.net + ' net' : ''))
    ]));
    app.appendChild(breakdown);

    // Full final standings
    app.appendChild(h('h2.section-title', {}, 'Final standings'));
    var list = h('div.stack');
    rows.forEach(function (r) {
      list.appendChild(h('div.card.card-row' + (r.pos === 1 ? '.winner-row' : ''), {}, [
        h('div.fs-pos', {}, (r.tie ? '=' : '') + (r.pos <= 3 ? medal(r.pos) : r.pos)),
        h('div.grow', {}, [h('h3', {}, GT.displayName(r.player)),
          h('div.muted', {}, r.gross + ' gross' + (r.net != null ? ' · ' + r.net + ' net' : ''))]),
        h('div.fs-pts', {}, [h('div.v', {}, r.total), h('div.k', {}, 'pts')])
      ]));
    });
    app.appendChild(list);

    app.appendChild(h('div.muted', { style: { fontSize: '.78rem', marginTop: '8px' } },
      'Ties broken by better final round, then better back 9 of the final round — all on Stableford points.'));
    app.appendChild(back);
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
      var be = grossBE(round, res.record);
      return {
        id: p.id, name: GT.displayName(p), you: me && me.id === p.id,
        hi: p.handicapIndex, ch: res.courseHcp,
        gross: res.hasScore ? res.gross : null,
        net: res.net,
        points: res.hasScore ? res.points : null,
        birdies: be.birdies, eagles: be.eagles,
        incomplete: res.hasScore && !res.complete,
        modeB: res.mode === 'B',
        hasScore: res.hasScore
      };
    }).filter(function (r) { return r.hasScore; });
    var showEagles = rows.some(function (r) { return r.eagles > 0; });

    if (!rows.length) {
      app.appendChild(GT.emptyState('⛳', 'No scores yet for this round'));
      var rb0 = GT.bonus && GT.bonus.board([round], { title: 'Bonuses — Round ' + round.index });
      if (rb0) app.appendChild(rb0);
      return;
    }

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
      header('Points', 'points', st, onSort),
      header('Birdies', 'birdies', st, onSort),
      showEagles ? header('Eagles', 'eagles', st, onSort) : null
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
        h('td.hi', {}, r.points == null ? '—' : r.points),
        h('td', {}, r.modeB ? '–' : r.birdies),
        showEagles ? h('td', {}, r.modeB ? '–' : r.eagles) : null
      ]);
    });
    app.appendChild(h('div.card', { style: { overflowX: 'auto' } }, h('table.lb', {}, [h('thead', {}, [head]), h('tbody', {}, body)])));
    var rb = GT.bonus && GT.bonus.board([round], { title: 'Bonuses — Round ' + round.index });
    if (rb) app.appendChild(rb);
    legend(app, 'round');
  }

  // ---- Overall leaderboard ----------------------------------------------
  function renderOverall(app, rounds) {
    var me = GT.state.currentPlayer();
    var bestOf = (db.getTournament().bestOfRounds) || 0;
    var rows = db.getPlayers().map(function (p) {
      var played = 0, anyScore = false, allComplete = true, anyB = false, birdies = 0, eagles = 0;
      var roundPts = rounds.map(function (round) {
        var res = util.result(round, p);
        if (!res.hasScore) { allComplete = false; return null; }
        anyScore = true; played++;
        if (!res.complete) allComplete = false;
        if (res.mode === 'B') anyB = true;
        var be = grossBE(round, res.record); birdies += be.birdies; eagles += be.eagles;
        return { pts: res.points, incomplete: !res.complete, modeB: res.mode === 'B' };
      });
      markDropped(roundPts, bestOf, 'pts');
      var points = GT.golf.bestOfTotal(roundPts.map(function (rp) { return rp && rp.pts; }), bestOf);
      return {
        id: p.id, name: GT.displayName(p), you: me && me.id === p.id,
        points: anyScore ? points : null, roundPts: roundPts,
        birdies: birdies, eagles: eagles,
        rounds: played, incomplete: anyScore && (played < rounds.length || !allComplete),
        modeB: anyB, hasScore: anyScore
      };
    }).filter(function (r) { return r.hasScore; });
    var showEagles = rows.some(function (r) { return r.eagles > 0; });

    if (!rows.length) {
      app.appendChild(GT.emptyState('🏆', 'No scores in yet'));
      var ob0 = GT.bonus && GT.bonus.board(rounds, { title: 'Bonuses', showRound: true });
      if (ob0) app.appendChild(ob0);
      return;
    }

    var st = sortState.overall;
    function onSort(key) { st.dir = (st.key === key) ? (st.dir === 'asc' ? 'desc' : 'asc') : defaultDir(key); st.key = key; GT.router.render(); }

    sortRows(rows, st.key, st.dir);
    withPositions(rows, function (r) { return r[st.key]; });

    var head = h('tr', {}, [
      h('th.pos', {}, '#'),
      header('Player', 'name', st, onSort, '.name')
    ].concat(rounds.map(function (round) {
      return h('th.rcol', { title: round.courseName || ('Round ' + round.index) }, 'R' + round.index);
    })).concat([
      header('Total', 'points', st, onSort, '.total'),
      header('Birdies', 'birdies', st, onSort),
      showEagles ? header('Eagles', 'eagles', st, onSort) : null
    ]));

    var body = rows.map(function (r) {
      var cells = [h('td.pos', {}, (r._tie ? '=' : '') + r._pos), nameCell(r)];
      r.roundPts.forEach(function (rp) {
        cells.push(h('td.rcol' + (rp && rp.dropped ? '.dropped' : ''), { title: rp && rp.dropped ? 'Dropped — not counted toward Total' : '' },
          !rp ? '–' : (rp.pts == null ? '–' : (rp.pts + (rp.incomplete ? '*' : '')))));
      });
      cells.push(h('td.hi.total', {}, r.points == null ? '—' : r.points));
      cells.push(h('td', {}, r.birdies));
      if (showEagles) cells.push(h('td', {}, r.eagles));
      return h('tr.lb-row' + (r.you ? '.you-row' : ''), {
        onclick: function () { GT.router.go('viewplayer', [r.id]); }
      }, cells);
    });
    app.appendChild(h('div.card', { style: { overflowX: 'auto' } }, h('table.lb', {}, [h('thead', {}, [head]), h('tbody', {}, body)])));
    var ob = GT.bonus && GT.bonus.board(rounds, { title: 'Bonuses', showRound: true });
    if (ob) app.appendChild(ob);
    legend(app, 'overall', bestOf);
  }

  function defaultDir(key) {
    // Lower is better for stroke columns; higher is better for points/birdies/eagles.
    if (key === 'points' || key === 'birdies' || key === 'eagles') return 'desc';
    if (key === 'name') return 'asc';
    if (key === 'hi') return 'asc';
    return 'asc'; // gross/net/ch ascending
  }

  function legend(app, which, bestOf) {
    app.appendChild(h('div.note.note-blue', { style: { marginTop: '10px', fontSize: '.82rem' } },
      which === 'round' ? '👆 Tap any player to view their scorecard for this round.'
                        : '👆 Tap any player to view their rounds and scorecards.'));
    var overallNote = which === 'overall'
      ? (bestOf ? 'R1–Rn = Stableford points per round · Total counts each player’s best ' + bestOf + ' round' + (bestOf === 1 ? '' : 's') + ' (dimmed = dropped) · '
                : 'R1–Rn = Stableford points per round · Total is the sum · ')
      : '';
    app.appendChild(h('div.muted', { style: { fontSize: '.78rem', marginTop: '8px' } },
      overallNote +
      '* incomplete round · S = summary entry · =n tied position · tap Player or Total to sort'));
  }
})(window.GT = window.GT || {});
