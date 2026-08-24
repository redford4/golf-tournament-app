/*
 * bonus.js — Bonus prizes (longest drive, nearest the pin, …) shared across the
 * organiser editor, the score-entry hole cards, the round screen and the
 * leaderboards. A bonus lives on its round: { id, hole (1-based), type, icon,
 * dir:'high'|'low', unit, winnerId, value, updatedAt, updatedBy }.
 *
 * dir governs who beats whom: 'high' = a bigger measurement wins (longest
 * drive/putt), 'low' = a smaller one wins (nearest the pin). The measurement is
 * optional — groups may just tap the winner and let the next group judge by eye.
 * Any signed-in player (or the organiser) can set or overwrite the holder.
 */
(function (GT) {
  'use strict';
  var h = GT.h, db = GT.db;

  // Preset types the organiser can pick in one tap (plus a free-text custom).
  var PRESETS = [
    { type: 'Longest Drive',    icon: '💥', dir: 'high', unit: 'yd' },
    { type: 'Nearest the Pin',  icon: '🎯', dir: 'low',  unit: 'ft' },
    { type: 'Longest Putt',     icon: '🏌', dir: 'high', unit: 'ft' },
    { type: 'Straightest Drive', icon: '🎯', dir: 'low',  unit: '' }
  ];
  function presetFor(type) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].type === type) return PRESETS[i];
    return null;
  }
  function iconFor(b) { var p = presetFor(b.type); return b.icon || (p && p.icon) || '🏅'; }
  function unitFor(b) { if (b.unit) return b.unit; var p = presetFor(b.type); return p ? p.unit : ''; }

  // Bonuses on a round, ordered by hole then type.
  function forRound(round) {
    return ((round && round.bonuses) || []).slice().sort(function (a, b) {
      return (a.hole - b.hole) || String(a.type).localeCompare(String(b.type));
    });
  }
  // Bonuses attached to a given 0-based hole index.
  function forHole(round, holeIndex) {
    return forRound(round).filter(function (b) { return b.hole === holeIndex + 1; });
  }
  function winnerName(b) {
    if (!b.winnerId) return null;
    var p = db.getPlayer(b.winnerId);
    return p ? GT.displayName(p) : null;
  }
  function valueLabel(b) {
    if (b.value == null || b.value === '') return '';
    var u = unitFor(b);
    return b.value + (u ? ' ' + u : '');
  }
  function canEdit() { return !!(GT.state.currentPlayer() || GT.state.isAdmin()); }

  // Small inline label for a hole header / scorecard, e.g. "🎯 Nearest the Pin".
  function badge(b, opts) {
    opts = opts || {};
    return h('span.bonus-badge', { title: b.type }, [iconFor(b) + ' ', opts.short ? '' : b.type].join(''));
  }

  // A self-contained, editable card for one bonus. Re-reads the bonus from the
  // db and rebuilds itself in place on save, so it can live on the heavy
  // score-entry screen without forcing a full route re-render.
  function captureCard(round, bonus, opts) {
    opts = opts || {};
    var card = h('div.card.bonus-card');
    var editing = false;

    function latest() {
      var list = (db.getRound(round.id) || {}).bonuses || [];
      return list.filter(function (x) { return x.id === bonus.id; })[0] || bonus;
    }

    function draw() {
      GT.clear(card);
      var b = latest();
      var name = winnerName(b);
      var val = valueLabel(b);

      var head = h('div.bonus-head', {}, [
        h('span.bonus-title', {}, [iconFor(b) + ' ' + b.type]),
        h('span.bonus-hole', {}, 'Hole ' + b.hole)
      ]);
      card.appendChild(head);

      if (!editing) {
        card.appendChild(h('div.bonus-holder' + (name ? '' : '.none'), {}, name
          ? [h('span.bonus-who', {}, name), val ? h('span.bonus-val', {}, val) : null]
          : [h('span.muted', {}, 'No winner yet')]));
        if (canEdit()) {
          card.appendChild(h('button.btn.btn-outline.btn-sm.btn-block', {
            type: 'button', style: { marginTop: '8px' },
            onclick: function () { editing = true; draw(); }
          }, name ? '✏️ Change winner' : '✏️ Set winner'));
        }
        return;
      }

      // --- Edit mode ---
      var players = db.getPlayers().slice().sort(function (a, c) {
        return GT.displayName(a).localeCompare(GT.displayName(c));
      });
      var sel = h('select', {}, [h('option', { value: '' }, '— pick a player —')].concat(
        players.map(function (p) { return h('option', { value: p.id }, GT.displayName(p)); })
      ));
      sel.value = b.winnerId || '';

      var u = unitFor(b);
      var valInput = h('input', {
        type: 'number', step: 'any', inputmode: 'decimal',
        placeholder: 'Measurement' + (u ? ' (' + u + ')' : '') + ' — optional',
        value: b.value != null ? b.value : ''
      });

      card.appendChild(h('div.bonus-edit', {}, [
        h('div.field', {}, [h('label', {}, 'Winning shot'), sel]),
        h('div.field', {}, [h('label', {}, 'Distance ' + (u ? '(' + u + ')' : '') +
          (b.dir === 'low' ? ' · closer wins' : ' · longer wins')), valInput])
      ]));

      var actions = h('div.btn-row', { style: { marginTop: '4px' } }, [
        h('button.btn.btn-primary.btn-sm', { type: 'button', onclick: function () {
          var me = GT.state.currentPlayer();
          db.setBonusWinner(round.id, b.id, { winnerId: sel.value || null, value: valInput.value, byId: me ? me.id : null });
          editing = false;
          GT.toast(sel.value ? 'Bonus winner saved' : 'Winner cleared', 'success');
          draw();
          if (opts.onChange) opts.onChange();
        } }, 'Save'),
        h('button.btn.btn-ghost.btn-sm', { type: 'button', onclick: function () { editing = false; draw(); } }, 'Cancel')
      ]);
      if (b.winnerId) {
        actions.appendChild(h('button.btn.btn-ghost.btn-sm', { type: 'button', style: { marginLeft: 'auto', color: 'var(--danger, #c0392b)' },
          onclick: function () {
            db.setBonusWinner(round.id, b.id, { winnerId: null, value: '', byId: null });
            editing = false; GT.toast('Winner cleared', ''); draw(); if (opts.onChange) opts.onChange();
          } }, 'Clear'));
      }
      card.appendChild(actions);
    }

    draw();
    return card;
  }

  // The round-screen "Bonuses" panel: one capture card per bonus. Returns null
  // when the round has none, so callers can skip it cleanly.
  function panel(round, opts) {
    var list = forRound(round);
    if (!list.length) return null;
    var wrap = h('div.bonus-panel', {}, [
      h('h2.section-title', {}, '🏅 Bonuses')
    ]);
    if (canEdit()) wrap.appendChild(h('div.muted', { style: { fontSize: '.8rem', margin: '-6px 0 8px' } },
      'Tap a bonus to record who has the winning shot. The next group can overwrite it if they beat it.'));
    list.forEach(function (b) { wrap.appendChild(captureCard(round, b, opts)); });
    return wrap;
  }

  // A read-only board of winners for the leaderboard. `scope` is a label; `rounds`
  // is the list to summarise (one round, or the whole tournament). Returns null
  // if no bonuses are defined anywhere in the set.
  function board(rounds, opts) {
    opts = opts || {};
    var any = rounds.some(function (r) { return forRound(r).length; });
    if (!any) return null;
    var wrap = h('div.card.bonus-board', {}, [
      h('div.bonus-board-title', {}, '🏅 ' + (opts.title || 'Bonuses'))
    ]);
    rounds.forEach(function (r) {
      forRound(r).forEach(function (b) {
        var name = winnerName(b);
        var val = valueLabel(b);
        wrap.appendChild(h('div.bonus-line', {}, [
          h('span.bonus-line-what', {}, [
            iconFor(b) + ' ',
            (opts.showRound ? ('R' + r.index + ' · ') : '') + b.type,
            h('span.bonus-line-hole', {}, ' · H' + b.hole)
          ]),
          h('span.bonus-line-who', {}, name
            ? [h('strong', {}, name), val ? h('span.muted', {}, ' · ' + val) : null]
            : [h('span.muted', {}, 'TBD')])
        ]));
      });
    });
    return wrap;
  }

  GT.bonus = {
    PRESETS: PRESETS, presetFor: presetFor, iconFor: iconFor, unitFor: unitFor,
    forRound: forRound, forHole: forHole, winnerName: winnerName, valueLabel: valueLabel,
    badge: badge, captureCard: captureCard, panel: panel, board: board
  };
})(window.GT = window.GT || {});
