/*
 * views-player.js — Player-facing screens: Tournament Home, My Handicaps,
 * Course/Round Detail, My Scorecard. Also defines GT.util, the shared bridge
 * between stored data and the scoring engine (used by score/admin/leaderboard).
 */
(function (GT) {
  'use strict';
  var h = GT.h, db = GT.db, golf = GT.golf;

  // ---- Shared computation helpers --------------------------------------
  var util = {
    parTotal: function (round) {
      if (!round || !round.par) return null;
      var n = round.numHoles || 18;
      return golf.parTotal(round.par.slice(0, n));
    },
    courseHcp: function (round, player) {
      if (!round || !player || !round.configured) return null;
      var pt = util.parTotal(round);
      if (pt == null || round.slopeRating == null || round.courseRating == null) return null;
      return golf.courseHandicap(player.handicapIndex, round.slopeRating, round.courseRating, pt);
    },
    // Resolve a player's result for a round into uniform totals for display.
    result: function (round, player) {
      var rec = db.getScore(round.id, player.id);
      var ch = util.courseHcp(round, player);
      var out = { hasScore: false, mode: null, locked: false, complete: false,
        gross: null, net: null, points: null, played: 0, courseHcp: ch, record: rec };
      if (!rec) return out;
      out.hasScore = true; out.mode = rec.mode; out.locked = !!rec.locked;
      if (rec.mode === 'A') {
        var comp = golf.computeRound(round, ch || 0, rec.holes);
        out.gross = comp.totals.gross;
        out.net = comp.totals.net;
        out.points = comp.totals.points;
        out.played = comp.totals.played;
        out.complete = comp.totals.complete;
        out.hasScore = comp.totals.played > 0;
        out.detail = comp;
      } else {
        out.gross = rec.summaryGross;
        out.points = rec.summaryStableford;
        out.complete = rec.summaryGross != null;
        var est = db.getTournament().estimateNetForSummary;
        out.net = (est && rec.summaryGross != null && ch != null) ? rec.summaryGross - ch : null;
        out.played = out.complete ? (round.numHoles || 18) : 0;
        out.hasScore = rec.summaryGross != null || rec.summaryStableford != null;
      }
      return out;
    },
    statusBadge: function (round, player) {
      if (!round.configured) return h('span.badge.badge-grey', {}, 'Not set up');
      var r = util.result(round, player);
      if (!r.hasScore) return h('span.badge.badge-grey', {}, 'Not started');
      if (r.locked) return h('span.badge.badge-blue', {}, 'Locked');
      if (r.complete) return h('span.badge.badge-green', {}, r.points + ' pts');
      return h('span.badge.badge-amber', {}, 'In progress' + (r.mode === 'A' ? ' · ' + r.played + '/' + (round.numHoles || 18) : ''));
    }
  };
  GT.util = util;

  function emptyState(icon, title, sub) {
    return h('div.empty', {}, [h('span.ic', {}, icon), h('div', { style: { fontWeight: 600 } }, title),
      sub ? h('div.muted', {}, sub) : null]);
  }

  // ---- Tournament Home -------------------------------------------------
  GT.router.register('home', function (app) {
    var player = GT.state.currentPlayer();

    // Need a tournament selected to show a home.
    if (!db.getActiveTournamentId() || !db.getActiveTournament()) {
      GT.router.go(GT.state.isAdmin() ? 'admin' : 'tournaments'); return;
    }
    var t = db.getTournament();

    if (!player && !GT.state.isAdmin()) { GT.router.go('tournaments'); return; }

    if (player) {
      app.appendChild(h('div.card', {}, [
        h('div.spread', {}, [
          h('div', {}, [h('h3', {}, 'Hi, ' + GT.displayName(player).split(' ')[0] + ' 👋'),
            h('div.muted', {}, 'Handicap Index ' + GT.fmtHi(player.handicapIndex) +
              (player.cdhId ? ' · CDH ' + player.cdhId : ''))]),
          h('button.btn.btn-ghost.btn-sm', { onclick: function () { GT.router.go('profile'); } }, 'Edit')
        ])
      ]));
    }

    app.appendChild(h('h2.section-title', {}, 'Rounds'));
    var rounds = db.getRounds();
    var list = h('div.stack');
    rounds.forEach(function (round) {
      var sub = round.configured
        ? (round.courseName || 'Course ' + round.index) +
            (round.date ? ' · ' + GT.formatDate(round.date) : '')
        : 'Awaiting setup by admin';
      list.appendChild(h('div.card.tap', {
        onclick: function () { GT.router.go('round', [round.id]); }
      }, [
        h('div.card-row', {}, [
          h('div.grow', {}, [
            h('h3', {}, 'Round ' + round.index + (round.numHoles === 9 ? ' (9 holes)' : '')),
            h('div.muted', {}, sub)
          ]),
          player ? util.statusBadge(round, player) : h('span.badge.badge-grey', {}, round.configured ? 'Ready' : 'Not set up')
        ])
      ]));
    });
    app.appendChild(list);

    app.appendChild(h('div.btn-row', { style: { marginTop: '14px' } }, [
      h('button.btn.btn-primary', { onclick: function () { GT.router.go('leaderboard'); } }, '🏆 Leaderboards'),
      h('button.btn.btn-outline', { onclick: function () { GT.router.go('handicaps'); } }, '🎯 My Handicaps')
    ]));
  });

  // ---- My Handicaps ----------------------------------------------------
  GT.router.register('handicaps', function (app) {
    var player = GT.state.currentPlayer();
    app.appendChild(h('h1.page-title', {}, 'My Handicaps'));
    if (!player) { app.appendChild(emptyState('👤', 'No profile yet', 'Register to see your handicaps.')); return; }

    app.appendChild(h('div.card', {}, [
      h('div.spread', {}, [
        h('div', {}, [h('div.muted', {}, 'Handicap Index'),
          h('div', { style: { fontSize: '2rem', fontWeight: 800, color: 'var(--green-dark)' } }, GT.fmtHi(player.handicapIndex))]),
        h('div', { style: { textAlign: 'right' } }, [h('div.muted', {}, 'CDH ID'),
          h('div', { style: { fontWeight: 600 } }, player.cdhId || '—')])
      ])
    ]));

    app.appendChild(h('p.page-sub', {}, 'Course Handicap is calculated per round from each course’s slope, rating and par.'));
    var rounds = db.getRounds();
    var list = h('div.stack');
    rounds.forEach(function (round) {
      var ch = util.courseHcp(round, player);
      list.appendChild(h('div.card.card-row', {}, [
        h('div.grow', {}, [h('h3', {}, 'Round ' + round.index),
          h('div.muted', {}, round.configured ? (round.courseName || 'Course') : 'Not configured')]),
        h('div.pill-stat', {}, [
          h('div.v', {}, ch == null ? '—' : ch),
          h('div.k', {}, 'Course Hcp')
        ])
      ]));
    });
    app.appendChild(list);
  });

  // ---- Course / Round Detail -------------------------------------------
  GT.router.register('round', function (app, params) {
    var round = db.getRound(params[0]);
    var player = GT.state.currentPlayer();
    if (!round) { app.appendChild(emptyState('❓', 'Round not found')); return; }

    app.appendChild(h('h1.page-title', {}, 'Round ' + round.index));

    if (!round.configured) {
      app.appendChild(h('div.note.note-amber', {}, 'This round has not been configured yet. ' +
        (GT.state.isAdmin() ? 'Set it up from Course Configuration.' : 'Check back once your organiser has added the course.')));
      if (GT.state.isAdmin()) {
        app.appendChild(h('button.btn.btn-primary.btn-block', { style: { marginTop: '12px' },
          onclick: function () { GT.router.go('course', [round.id]); } }, 'Configure this round'));
      }
      return;
    }

    var ch = util.courseHcp(round, player);
    app.appendChild(h('div.card', {}, [
      h('h3', {}, round.courseName || 'Course'),
      h('div.muted', { style: { marginBottom: '10px' } },
        [round.date ? GT.formatDate(round.date) : null, round.teeColour ? round.teeColour + ' tees' : null,
         (round.numHoles || 18) + ' holes'].filter(Boolean).join(' · ')),
      h('div.grid3', {}, [
        h('div.pill-stat', {}, [h('div.v', {}, round.courseRating != null ? round.courseRating : '—'), h('div.k', {}, 'Rating')]),
        h('div.pill-stat', {}, [h('div.v', {}, round.slopeRating != null ? round.slopeRating : '—'), h('div.k', {}, 'Slope')]),
        h('div.pill-stat', {}, [h('div.v', {}, util.parTotal(round) || '—'), h('div.k', {}, 'Par')])
      ]),
      player ? h('div.note.note-green', { style: { marginTop: '12px' } },
        'Your Course Handicap for this round: ' + (ch == null ? '—' : ch)) : null
    ]));

    if (round.details && round.details.trim()) {
      app.appendChild(h('div.card', {}, [
        h('div.muted', { style: { marginBottom: '6px', fontWeight: '600' } }, 'Course details'),
        h('div', { style: { whiteSpace: 'pre-wrap' } }, round.details)
      ]));
    }

    var tee = teeTimesCard(round, player);
    if (tee) app.appendChild(tee);

    if (round.imageDataUrl) {
      app.appendChild(h('div.card', {}, [h('div.muted', { style: { marginBottom: '8px' } }, 'Original scorecard'),
        h('img.imgthumb', { src: round.imageDataUrl, alt: 'Scorecard image' })]));
    }

    // Par / SI reference table
    app.appendChild(scorecardReference(round, player));

    if (player) {
      var r = util.result(round, player);
      var actions = h('div.stack', { style: { marginTop: '6px' } });
      if (r.locked) {
        actions.appendChild(h('div.note.note-blue', {}, 'This round is locked by the admin. Scores can no longer be edited.'));
        actions.appendChild(h('button.btn.btn-outline.btn-block', { onclick: function () { GT.router.go('scorecard', [round.id]); } }, 'View my scorecard'));
      } else if (r.hasScore) {
        actions.appendChild(h('div.btn-row', {}, [
          h('button.btn.btn-primary', { onclick: function () { GT.router.go(r.mode === 'A' ? 'enterA' : 'enterB', [round.id]); } }, 'Continue scoring'),
          h('button.btn.btn-outline', { onclick: function () { GT.router.go('scorecard', [round.id]); } }, 'My scorecard')
        ]));
      } else {
        actions.appendChild(h('button.btn.btn-primary.btn-block', { onclick: function () { GT.router.go('enter', [round.id]); } }, '⛳ Enter my scores'));
      }
      app.appendChild(actions);
    }
  });

  // Tee times / groups for a round (shown to players and viewers).
  function teeTimesCard(round, player) {
    var groups = db.getGroups(round.id);
    if (!groups.length) return null;
    var card = h('div.card', {}, [h('div.muted', { style: { marginBottom: '8px', fontWeight: '600' } }, 'Tee times & groups')]);
    if (player) {
      var pg = db.playerGroup(round.id, player.id);
      if (pg) card.appendChild(h('div.note.note-green', { style: { marginBottom: '10px' } },
        '⛳ Your tee time: ' + (pg.group.teeTime || 'TBC') + ' · Group ' + (pg.index + 1)));
    }
    groups.forEach(function (g, gi) {
      var mine = player && (g.players || []).indexOf(player.id) > -1;
      var names = (g.players || []).map(function (pid) { var p = db.getPlayer(pid); return p ? GT.displayName(p) : '—'; }).join(', ');
      card.appendChild(h('div.tee-row' + (mine ? '.mine' : ''), {}, [
        h('div.tee-time', {}, g.teeTime || '—'),
        h('div.grow', {}, [h('div', { style: { fontWeight: 600 } }, 'Group ' + (gi + 1)), h('div.muted', {}, names)])
      ]));
    });
    return card;
  }

  // Read-only par / stroke-index / shots reference for a round.
  function scorecardReference(round, player) {
    var n = round.numHoles || 18;
    var ch = player ? util.courseHcp(round, player) : null;
    function rowFor(start, end, label) {
      var cells = [h('td.rowhead', {}, label)];
      var holeCells = [], parCells = [], siCells = [];
      var th = [h('th.rowhead', {}, 'Hole')];
      for (var i = start; i < end; i++) {
        th.push(h('th', {}, String(i + 1)));
        var shots = ch != null ? golf.shotsReceived(ch, Number(round.strokeIndex[i])) : 0;
        parCells.push(h('td', {}, round.par[i] != null ? String(round.par[i]) : '—'));
        siCells.push(h('td' + (shots ? '.shot' + (shots > 1 ? '.shot2' : '') : ''), {}, round.strokeIndex[i] != null ? String(round.strokeIndex[i]) : '—'));
      }
      return { th: th, parCells: parCells, siCells: siCells };
    }
    function block(start, end) {
      var ref = rowFor(start, end);
      return h('table.sc', {}, [
        h('thead', {}, [h('tr', {}, ref.th)]),
        h('tbody', {}, [
          h('tr.r-par', {}, [h('td.rowhead', {}, 'Par')].concat(ref.parCells)),
          h('tr', {}, [h('td.rowhead', {}, 'SI')].concat(ref.siCells))
        ])
      ]);
    }
    var wrap = h('div.card', {}, [h('div.muted', { style: { marginBottom: '8px' } },
      'Course layout' + (ch != null ? ' · ⬤ marks holes where you get a shot' : ''))]);
    wrap.appendChild(h('div.sc-wrap', {}, block(0, Math.min(9, n))));
    if (n > 9) wrap.appendChild(h('div.sc-wrap', { style: { marginTop: '8px' } }, block(9, n)));
    return wrap;
  }
  GT.scorecardReference = scorecardReference;

  // ---- My Scorecard (read-only) ----------------------------------------
  GT.router.register('scorecard', function (app, params) {
    var round = db.getRound(params[0]);
    var player = GT.state.currentPlayer();
    if (!round || !player) { app.appendChild(emptyState('❓', 'Scorecard unavailable')); return; }
    app.appendChild(h('h1.page-title', {}, 'My Scorecard'));
    app.appendChild(h('p.page-sub', {}, 'Round ' + round.index + ' · ' + (round.courseName || '')));
    app.appendChild(GT.fullScorecard(round, player, { readOnly: true }));
    app.appendChild(h('button.btn.btn-outline.btn-block', { style: { marginTop: '12px' },
      onclick: function () { GT.router.go('round', [round.id]); } }, 'Back to round'));
  });

  // ---- View ANY player's scorecard for a round (from leaderboard) -------
  GT.router.register('viewcard', function (app, params) {
    var round = db.getRound(params[0]);
    var player = db.getPlayer(params[1]);
    if (!round || !player) { app.appendChild(emptyState('❓', 'Scorecard unavailable')); return; }
    var me = GT.state.currentPlayer();
    var isMe = me && me.id === player.id;

    app.appendChild(h('h1.page-title', {}, isMe ? 'My Scorecard' : GT.formalName(player)));
    app.appendChild(h('p.page-sub', {}, 'Round ' + round.index + ' · ' + (round.courseName || '') +
      ' · HI ' + GT.fmtHi(player.handicapIndex)));

    var r = util.result(round, player);
    if (!r.hasScore) {
      app.appendChild(emptyState('⛳', 'No score yet', GT.displayName(player).split(' ')[0] + ' hasn’t entered a score for this round.'));
    } else {
      app.appendChild(GT.fullScorecard(round, player, { readOnly: true }));
    }
    app.appendChild(h('button.btn.btn-outline.btn-block', { style: { marginTop: '12px' },
      onclick: function () { GT.router.go('leaderboard', [], { view: 'round', round: round.id }); } }, '← Back to leaderboard'));
  });

  // ---- View a player's whole tournament (from overall leaderboard) ------
  GT.router.register('viewplayer', function (app, params) {
    var player = db.getPlayer(params[0]);
    if (!player) { app.appendChild(emptyState('❓', 'Player not found')); return; }
    var me = GT.state.currentPlayer();
    var isMe = me && me.id === player.id;

    app.appendChild(h('h1.page-title', {}, isMe ? 'My Tournament' : GT.formalName(player)));
    app.appendChild(h('p.page-sub', {}, 'Handicap Index ' + GT.fmtHi(player.handicapIndex) +
      (player.cdhId ? ' · CDH ' + player.cdhId : '')));

    var rounds = db.getRounds().filter(function (rd) { return rd.configured; });
    var totGross = 0, totPoints = 0, played = 0, anyScore = false;
    rounds.forEach(function (rd) {
      var res = util.result(rd, player);
      if (res.hasScore) { anyScore = true; played++; if (res.gross != null) totGross += res.gross; if (res.points != null) totPoints += res.points; }
    });

    if (anyScore) {
      app.appendChild(h('div.card.grid3', {}, [
        h('div.pill-stat', {}, [h('div.v', {}, totPoints), h('div.k', {}, 'Total Points')]),
        h('div.pill-stat', {}, [h('div.v', {}, totGross), h('div.k', {}, 'Total Gross')]),
        h('div.pill-stat', {}, [h('div.v', {}, played + '/' + rounds.length), h('div.k', {}, 'Rounds')])
      ]));
    }

    app.appendChild(h('h2.section-title', {}, 'Rounds'));
    var list = h('div.stack');
    rounds.forEach(function (rd) {
      var res = util.result(rd, player);
      list.appendChild(h('div.card' + (res.hasScore ? '.tap' : '') + '.card-row', {
        onclick: res.hasScore ? function () { GT.router.go('viewcard', [rd.id, player.id]); } : null
      }, [
        h('div.grow', {}, [h('h3', {}, 'Round ' + rd.index),
          h('div.muted', {}, (rd.courseName || 'Course') + (rd.date ? ' · ' + GT.formatDate(rd.date) : ''))]),
        res.hasScore
          ? h('div.wrap', {}, [h('span.badge.badge-green', {}, res.points + ' pts'), h('span', {}, '›')])
          : h('span.badge.badge-grey', {}, 'No score')
      ]));
    });
    app.appendChild(list);

    app.appendChild(h('button.btn.btn-outline.btn-block', { style: { marginTop: '12px' },
      onclick: function () { GT.router.go('leaderboard', [], { view: 'overall' }); } }, '← Back to leaderboard'));
  });

  // Full per-hole scorecard table with running totals (used in several places).
  GT.fullScorecard = function (round, player, opts) {
    opts = opts || {};
    var n = round.numHoles || 18;
    var ch = util.courseHcp(round, player);
    var r = util.result(round, player);

    if (r.mode === 'B') {
      return h('div.card', {}, [
        h('div.note.note-blue', { style: { marginBottom: '12px' } }, 'Summary entry — no per-hole breakdown for this round.'),
        h('div.grid3', {}, [
          h('div.pill-stat', {}, [h('div.v', {}, r.gross != null ? r.gross : '—'), h('div.k', {}, 'Gross')]),
          h('div.pill-stat', {}, [h('div.v', {}, r.net != null ? r.net : 'N/A'), h('div.k', {}, 'Net')]),
          h('div.pill-stat', {}, [h('div.v', {}, r.points != null ? r.points : '—'), h('div.k', {}, 'Points')])
        ])
      ]);
    }

    var comp = golf.computeRound(round, ch || 0, r.record ? r.record.holes : []);

    function block(start, end) {
      var head = [h('th.rowhead', {}, 'Hole')];
      var parRow = [h('td.rowhead', {}, 'Par')];
      var siRow = [h('td.rowhead', {}, 'SI')];
      var grossRow = [h('td.rowhead', {}, 'Gross')];
      var netRow = [h('td.rowhead', {}, 'Net')];
      var ptsRow = [h('td.rowhead', {}, 'Points')];
      var subGross = 0, subPts = 0;
      for (var i = start; i < end; i++) {
        var hh = comp.holes[i];
        head.push(h('th', {}, String(hh.hole)));
        parRow.push(h('td', {}, String(hh.par)));
        siRow.push(h('td' + (hh.shots ? '.shot' + (hh.shots > 1 ? '.shot2' : '') : ''), {}, String(hh.si)));
        if (hh.nr) {
          grossRow.push(h('td.nr', {}, 'NR'));
          netRow.push(h('td.nr', {}, '—'));
        } else {
          grossRow.push(h('td', {}, String(hh.gross)));
          netRow.push(h('td', {}, String(hh.net)));
          subGross += hh.gross;
        }
        ptsRow.push(h('td.pts-' + hh.points, {}, String(hh.points)));
        subPts += hh.points;
      }
      head.push(h('th.tot', {}, end - start === 9 ? (start === 0 ? 'OUT' : 'IN') : 'TOT'));
      parRow.push(h('td.tot', {}, String(golf.parTotal(round.par.slice(start, end)))));
      siRow.push(h('td.tot', {}, ''));
      grossRow.push(h('td.tot', {}, String(subGross)));
      netRow.push(h('td.tot', {}, ''));
      ptsRow.push(h('td.tot', {}, String(subPts)));
      return h('table.sc', {}, [
        h('thead', {}, [h('tr', {}, head)]),
        h('tbody', {}, [h('tr.r-par', {}, parRow), h('tr', {}, siRow), h('tr', {}, grossRow), h('tr', {}, netRow), h('tr', {}, ptsRow)])
      ]);
    }

    var card = h('div.card', {}, [
      h('div.spread', { style: { marginBottom: '10px' } }, [
        h('div.muted', {}, 'Course Hcp ' + (ch == null ? '—' : ch)),
        h('div.wrap', {}, [
          h('span.badge.badge-grey', {}, 'Gross ' + comp.totals.gross),
          h('span.badge.badge-grey', {}, 'Net ' + comp.totals.net),
          h('span.badge.badge-green', {}, comp.totals.points + ' pts')
        ])
      ])
    ]);
    card.appendChild(h('div.sc-wrap', {}, block(0, Math.min(9, n))));
    if (n > 9) card.appendChild(h('div.sc-wrap', { style: { marginTop: '10px' } }, block(9, n)));
    if (!comp.totals.complete && comp.totals.played > 0) {
      card.appendChild(h('div.note.note-amber', { style: { marginTop: '10px' } },
        'Incomplete round — ' + comp.totals.played + '/' + n + ' holes. Marked with * on leaderboards.'));
    }
    return card;
  };

  GT.emptyState = emptyState;
})(window.GT = window.GT || {});
