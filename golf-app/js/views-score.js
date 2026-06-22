/*
 * views-score.js — Score entry (PRD 7). Mode selection, Mode A hole-by-hole
 * (auto Net + Stableford), Mode B summary, and mode switching with warnings.
 */
(function (GT) {
  'use strict';
  var h = GT.h, db = GT.db, golf = GT.golf, util = GT.util;

  // Raw gross-vs-par label, the way a golfer names their score on the hole.
  function grossLabel(gross, par) {
    var d = gross - par;
    if (d <= -3) return 'Albatross';
    return { '-2': 'Eagle', '-1': 'Birdie', '0': 'Par', '1': 'Bogey', '2': 'Double', '3': 'Triple' }[String(d)] || ('+' + d);
  }

  function guard(round, player, app) {
    if (!round || !player) { app.appendChild(GT.emptyState('❓', 'Not available')); return false; }
    if (!round.configured) { app.appendChild(h('div.note.note-amber', {}, 'This round is not configured yet.')); return false; }
    var rec = db.getScore(round.id, player.id);
    if (rec && rec.locked) {
      app.appendChild(h('div.note.note-blue', {}, 'This round is locked by the admin and can no longer be edited.'));
      app.appendChild(h('button.btn.btn-outline.btn-block', { style: { marginTop: '12px' },
        onclick: function () { GT.router.go('scorecard', [round.id]); } }, 'View my scorecard'));
      return false;
    }
    return true;
  }

  // ---- Mode selection --------------------------------------------------
  GT.router.register('enter', function (app, params) {
    var round = db.getRound(params[0]);
    var player = GT.state.currentPlayer();
    app.appendChild(h('h1.page-title', {}, 'Enter Scores'));
    app.appendChild(h('p.page-sub', {}, 'Round ' + (round ? round.index : '') + ' · ' + (round ? round.courseName : '')));
    if (!guard(round, player, app)) return;

    var rec = db.getScore(round.id, player.id);
    if (rec && (rec.mode === 'A' ? rec.holes.some(function (x) { return x != null; }) : rec.summaryGross != null)) {
      // Already started — go straight to the relevant editor.
      GT.router.go(rec.mode === 'A' ? 'enterA' : 'enterB', [round.id]);
      return;
    }

    app.appendChild(h('div.card.tap.stack', {
      onclick: function () { startMode(round, player, 'A'); }
    }, [
      h('h3', {}, '🕳 Hole-by-Hole'),
      h('p.muted', {}, 'Enter your gross score on each hole. Net and Stableford points are calculated automatically. Recommended for full stats.')
    ]));
    app.appendChild(h('div.card.tap.stack', {
      onclick: function () { startMode(round, player, 'B'); }
    }, [
      h('h3', {}, '📋 Summary Entry'),
      h('p.muted', {}, 'Just enter your total gross score and total Stableford points for the round. Quick, no per-hole detail.')
    ]));
  });

  function startMode(round, player, mode) {
    var rec = db.getScore(round.id, player.id) || db.blankScore(round.id, player.id, mode);
    rec.mode = mode;
    db.saveScore(rec);
    GT.router.go(mode === 'A' ? 'enterA' : 'enterB', [round.id]);
  }

  // ---- Mode A: hole-by-hole --------------------------------------------
  GT.router.register('enterA', function (app, params) {
    var round = db.getRound(params[0]);
    var player = GT.state.currentPlayer();
    app.appendChild(h('h1.page-title', {}, 'Hole-by-Hole'));
    if (!guard(round, player, app)) return;

    var rec = db.getScore(round.id, player.id);
    if (!rec || rec.mode !== 'A') { rec = db.blankScore(round.id, player.id, 'A'); if (rec) db.saveScore(rec); }
    var n = round.numHoles || 18;
    var ch = util.courseHcp(round, player) || 0;

    var progress = h('div.note.note-green.sh-progress');
    app.appendChild(progress);

    var holeList = h('div.hole-list');
    app.appendChild(holeList);

    var inputEls = [];   // current <input> for each hole (replaced on rebuild)
    var cardEls = [];    // card element for each hole

    var doneBtn = h('button.btn.btn-primary.btn-block', {
      onclick: function () { GT.toast('Scores saved', 'success'); GT.router.go('scorecard', [round.id]); }
    }, '✓ Done — view scorecard');

    function refreshTotals() {
      var comp = golf.computeRound(round, ch, rec.holes);
      var tot = comp.totals;
      var pct = Math.round((tot.played / n) * 100);
      GT.clear(progress);
      progress.appendChild(h('div.spread', {}, [
        h('div', {}, [h('b', {}, tot.played + ' / ' + n + ' holes'),
          h('span.muted', { style: { marginLeft: '8px' } }, 'F9 ' + tot.frontPoints + ' · B9 ' + tot.backPoints)]),
        h('div', {}, [h('b', {}, tot.points + ' pts'), h('span.muted', { style: { marginLeft: '8px' } }, 'Gross ' + tot.gross)])
      ]));
      progress.appendChild(h('div.sh-bar', {}, h('div.sh-bar-fill', { style: { width: pct + '%' } })));
    }

    // Move focus / highlight to hole j. Past the last hole → jump to Done.
    function focusHole(j) {
      if (j >= n) {
        setActive(-1);
        try { doneBtn.focus(); } catch (e) {}
        doneBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (j < 0) j = 0;
      setActive(j);
      var inp = inputEls[j];
      if (inp) {
        try { inp.focus(); inp.select && inp.select(); } catch (e) {}
        cardEls[j].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    function setActive(j) {
      for (var k = 0; k < cardEls.length; k++) {
        if (cardEls[k]) cardEls[k].classList.toggle('active', k === j);
      }
    }

    // Set a hole's score: value is a positive int, 'NR', or null (clear).
    function setScore(i, value, advance) {
      if (value === 'NR') { rec.holes[i] = 'NR'; }
      else if (value == null || value === '') { rec.holes[i] = null; }
      else {
        var num = parseInt(value, 10);
        if (isNaN(num) || num < 1) { rec.holes[i] = null; }
        else {
          if (num > 20) num = 20;
          rec.holes[i] = num;
          if (num >= Number(round.par[i]) + 5) GT.toast('Hole ' + (i + 1) + ': that’s a high score — double-check.', '');
        }
      }
      db.saveScore(rec);
      rebuildHole(i, cardEls[i]);
      refreshTotals();
      if (advance) focusHole(i + 1);
    }

    function rebuildHole(i, cardEl) {
      var par = Number(round.par[i]);
      var si = Number(round.strokeIndex[i]);
      var shots = golf.shotsReceived(ch, si);
      var raw = rec.holes[i];
      var isNR = raw === 'NR';
      var hasGross = raw != null && raw !== '' && raw !== 'NR' && !isNaN(Number(raw));
      var gross = hasGross ? Number(raw) : null;
      var net = gross == null ? null : gross - shots;
      var pts = (gross == null) ? 0 : golf.stablefordPoints(par, net);

      var wasActive = cardEl.classList.contains('active');
      cardEl.className = 'card scorehole' + (shots ? ' has-shot' : '') + (isNR ? ' is-nr' : '') + (wasActive ? ' active' : '');
      GT.clear(cardEl);

      // --- Header: hole number, par/SI/shots, live result ---
      var resultNode;
      if (isNR) {
        resultNode = h('div.sh-result', {}, [h('div.nr-tag', {}, 'No return'), h('div.muted', {}, '0 pts')]);
      } else if (gross != null) {
        resultNode = h('div.sh-result', {}, [
          h('div.muted', {}, 'Net ' + net),
          h('div.pts', {}, pts + ' pts'),
          h('div.muted', { style: { fontSize: '.7rem' } }, golf.stablefordLabel(pts))
        ]);
      } else {
        resultNode = h('div.sh-result.muted', {}, '—');
      }
      cardEl.appendChild(h('div.sh-head', {}, [
        h('div.sh-num', {}, String(i + 1)),
        h('div.sh-meta', {}, [
          h('div.ttl', {}, 'Par ' + par),
          h('div.hmeta', {}, [
            'SI ' + si,
            shots ? h('span.badge.badge-amber', { style: { marginLeft: '6px' } }, shots === 2 ? '2 shots' : '1 shot') : null,
            (round.holeImages && round.holeImages[i])
              ? h('button.btn.btn-sm.btn-photo', { type: 'button', style: { marginLeft: '8px', minHeight: '28px', padding: '2px 8px' },
                  onclick: function () { GT.viewImage(round.holeImages[i], 'Hole ' + (i + 1)); } }, '📷 Hole')
              : null
          ])
        ]),
        resultNode
      ]));

      // --- Entry row: − [input] + ---
      var input = h('input', {
        type: 'number', inputmode: 'numeric', min: '1', max: '20',
        enterkeyhint: (i === n - 1) ? 'done' : 'next',
        value: hasGross ? gross : '', placeholder: '–',
        onfocus: function () { setActive(i); input.select && input.select(); }
      });
      inputEls[i] = input;

      function commitInput(advance) {
        setScore(i, input.value.trim() === '' ? null : input.value.trim(), advance);
      }
      input.addEventListener('change', function () { commitInput(false); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commitInput(true); }
        else if (e.key === 'Tab') { e.preventDefault(); commitInput(false); focusHole(e.shiftKey ? i - 1 : i + 1); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); commitInput(false); focusHole(i + 1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); commitInput(false); focusHole(i - 1); }
      });

      function bump(delta) {
        var base = gross != null ? gross : par; // empty starts from par
        setScore(i, Math.max(1, base + delta), false);
        try { inputEls[i].focus(); } catch (e) {}
      }
      cardEl.appendChild(h('div.sh-entry', {}, [
        h('button.step-btn', { type: 'button', 'aria-label': 'One less', onclick: function () { bump(-1); } }, '−'),
        input,
        h('button.step-btn', { type: 'button', 'aria-label': 'One more', onclick: function () { bump(1); } }, '+')
      ]));

      // --- Quick-score chips (relative to par) ---
      var chipScores = [];
      [-1, 0, 1, 2, 3].forEach(function (d) { var v = par + d; if (v >= 1 && chipScores.indexOf(v) < 0) chipScores.push(v); });
      var chips = h('div.quick-chips');
      chipScores.forEach(function (v) {
        chips.appendChild(h('button.chip' + (gross === v ? '.cur' : ''), {
          type: 'button', onclick: function () { setScore(i, v, true); }
        }, [h('span', {}, String(v)), h('small', {}, grossLabel(v, par))]));
      });
      cardEl.appendChild(chips);

      // --- Footer: pick-up + next ---
      cardEl.appendChild(h('div.sh-foot', {}, [
        h('button.btn.btn-ghost.btn-sm', {
          type: 'button',
          onclick: function () { setScore(i, isNR ? null : 'NR', isNR ? false : true); }
        }, isNR ? 'Undo pick-up' : 'Pick up (NR)'),
        i < n - 1
          ? h('button.btn.btn-outline.btn-sm', { type: 'button', onclick: function () { commitInput(false); focusHole(i + 1); } }, 'Next hole →')
          : h('button.btn.btn-outline.btn-sm', { type: 'button', onclick: function () { commitInput(false); focusHole(n); } }, 'Finish →')
      ]));
    }

    for (var i = 0; i < n; i++) {
      var cardEl = h('div.card.scorehole');
      cardEls.push(cardEl);
      holeList.appendChild(cardEl);
      rebuildHole(i, cardEl);
    }
    refreshTotals();

    app.appendChild(h('div.stack', { style: { marginTop: '8px' } }, [
      doneBtn,
      h('button.btn.btn-ghost.btn-block', { onclick: function () { switchToB(round, player); } }, 'Switch to summary entry instead')
    ]));

    // Continue where you left off: highlight (and on desktop focus) the first
    // hole still needing a score.
    var startIdx = 0;
    while (startIdx < n && rec.holes[startIdx] != null) startIdx++;
    if (startIdx >= n) startIdx = 0;
    setTimeout(function () {
      setActive(startIdx);
      cardEls[startIdx].scrollIntoView({ block: 'center' });
    }, 60);
  });

  function switchToB(round, player) {
    GT.confirm('Switch to summary entry? Your per-hole scores for this round will be replaced.',
      function () {
        var rec = db.blankScore(round.id, player.id, 'B');
        db.saveScore(rec);
        GT.router.go('enterB', [round.id]);
      }, { yesLabel: 'Switch & clear', danger: true });
  }

  function switchToA(round, player) {
    GT.confirm('Switch to hole-by-hole entry? Your summary totals for this round will be cleared.',
      function () {
        var rec = db.blankScore(round.id, player.id, 'A');
        db.saveScore(rec);
        GT.router.go('enterA', [round.id]);
      }, { yesLabel: 'Switch & clear' });
  }

  // ---- Mode B: summary -------------------------------------------------
  GT.router.register('enterB', function (app, params) {
    var round = db.getRound(params[0]);
    var player = GT.state.currentPlayer();
    app.appendChild(h('h1.page-title', {}, 'Summary Entry'));
    app.appendChild(h('p.page-sub', {}, 'Round ' + (round ? round.index : '') + ' · ' + (round ? round.courseName : '')));
    if (!guard(round, player, app)) return;

    var rec = db.getScore(round.id, player.id);
    if (!rec || rec.mode !== 'B') rec = db.blankScore(round.id, player.id, 'B');

    var gross = h('input', { type: 'number', inputmode: 'numeric', min: '1',
      value: rec.summaryGross != null ? rec.summaryGross : '', placeholder: 'e.g. 92' });
    var stab = h('input', { type: 'number', inputmode: 'numeric', min: '0',
      value: rec.summaryStableford != null ? rec.summaryStableford : '', placeholder: 'e.g. 34' });

    function save(go) {
      var g = gross.value === '' ? null : parseInt(gross.value, 10);
      var s = stab.value === '' ? null : parseInt(stab.value, 10);
      if (g != null && (isNaN(g) || g < 1)) { GT.toast('Total gross must be a positive number.', 'error'); return; }
      if (s != null && (isNaN(s) || s < 0)) { GT.toast('Stableford must be 0 or above.', 'error'); return; }
      rec.mode = 'B'; rec.summaryGross = g; rec.summaryStableford = s;
      db.saveScore(rec);
      GT.toast('Summary saved', 'success');
      if (go) GT.router.go('scorecard', [round.id]);
    }

    app.appendChild(h('div.card.stack', {}, [
      h('div.field', {}, [h('label', {}, 'Total Gross Score'), gross,
        h('div.hint', {}, 'Your total strokes for the whole round.')]),
      h('div.field', {}, [h('label', {}, 'Total Stableford Points'), stab,
        h('div.hint', {}, 'Your total Stableford points for the round.')]),
      h('button.btn.btn-primary.btn-block', { onclick: function () { save(true); } }, '✓ Save summary')
    ]));

    app.appendChild(h('button.btn.btn-ghost.btn-block', {
      onclick: function () { save(false); switchToA(round, player); }
    }, 'Switch to hole-by-hole instead'));
  });

  GT.switchToA = switchToA;
  GT.switchToB = switchToB;
})(window.GT = window.GT || {});
