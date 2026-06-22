/*
 * golf.js — Pure scoring logic for the Golf Tournament Scoring App.
 *
 * Everything here is a pure function (no DOM, no storage) so the rules from the
 * PRD (handicaps, shot allocation, Stableford) live in one testable place.
 * Attaches to the global GT.golf namespace (classic script, runs from file://).
 */
(function (GT) {
  'use strict';

  /**
   * WHS Course Handicap.
   *   Course Handicap = Handicap Index x (Slope / 113) + (Course Rating - Par)
   * Rounded to the nearest whole number (PRD 6.1).
   */
  function courseHandicap(handicapIndex, slopeRating, courseRating, parTotal) {
    if (handicapIndex == null || slopeRating == null || courseRating == null || parTotal == null) {
      return null;
    }
    var raw = handicapIndex * (slopeRating / 113) + (courseRating - parTotal);
    return Math.round(raw);
  }

  /**
   * Shots received on a single hole, given the player's course handicap and the
   * hole's stroke index (PRD 7.2.3). Generalised so handicaps above 36 still
   * work, but matches the PRD exactly for the 0-36 range:
   *   - CH <= 0 (scratch / plus): 0 shots
   *   - CH <= 18: 1 shot where SI <= CH
   *   - CH > 18: 2 shots where SI <= CH-18, else 1 shot where SI <= 18
   */
  function shotsReceived(courseHcp, strokeIndex) {
    if (courseHcp == null || strokeIndex == null) return 0;
    if (courseHcp <= 0) return 0;
    var full = Math.floor(courseHcp / 18);
    var remainder = courseHcp - full * 18;
    return full + (strokeIndex <= remainder ? 1 : 0);
  }

  /** Net score for a hole = gross - shots received. */
  function netScore(gross, shots) {
    if (gross == null) return null;
    return gross - shots;
  }

  /**
   * Stableford points for a hole (PRD 7.2.3):
   *   points = max(0, Par + 2 - Net)
   * A skipped / "No Return" hole (gross == null) scores 0.
   */
  function stablefordPoints(par, net) {
    if (net == null || par == null) return 0;
    return Math.max(0, par + 2 - net);
  }

  /** Friendly label for a Stableford result, for tooltips / accessibility. */
  function stablefordLabel(points) {
    switch (points) {
      case 5: return 'Albatross';
      case 4: return 'Eagle';
      case 3: return 'Birdie';
      case 2: return 'Par';
      case 1: return 'Bogey';
      default: return 'Blob';
    }
  }

  /** Total par across an array of per-hole pars. */
  function parTotal(parArray) {
    if (!parArray) return null;
    return parArray.reduce(function (sum, p) {
      return sum + (Number(p) || 0);
    }, 0);
  }

  /**
   * Compute a full per-hole breakdown for a Mode A (hole-by-hole) round.
   * @param {object} round  - round config (par[], strokeIndex[], numHoles).
   * @param {number} courseHcp - player's course handicap for this round.
   * @param {Array<number|null>} grossArray - gross per hole (null = No Return).
   * @returns {object} { holes:[{hole,par,si,shots,gross,net,points,nr}],
   *                     totals:{gross,net,points,played,front,back} }
   */
  function computeRound(round, courseHcp, grossArray) {
    var n = round.numHoles || 18;
    var holes = [];
    var totGross = 0, totNet = 0, totPoints = 0, played = 0;
    var frontPoints = 0, backPoints = 0, frontGross = 0, backGross = 0;

    for (var i = 0; i < n; i++) {
      var par = Number(round.par[i]);
      var si = Number(round.strokeIndex[i]);
      var shots = shotsReceived(courseHcp, si);
      // A hole is "No Return" if blank, explicitly picked up ('NR'), or otherwise
      // not a valid number. NR holes score 0 points and are excluded from totals.
      var raw = grossArray ? grossArray[i] : null;
      var gross = (raw != null && raw !== '' && raw !== 'NR' && !isNaN(Number(raw)))
        ? Number(raw) : null;
      var nr = gross == null;
      var net = nr ? null : netScore(gross, shots);
      var pts = stablefordPoints(par, net);

      if (!nr) {
        totGross += gross;
        totNet += net;
        played++;
        if (i < 9) { frontGross += gross; } else { backGross += gross; }
      }
      totPoints += pts;
      if (i < 9) { frontPoints += pts; } else { backPoints += pts; }

      holes.push({
        hole: i + 1, par: par, si: si, shots: shots,
        gross: gross, net: net, points: pts, nr: nr
      });
    }

    return {
      holes: holes,
      totals: {
        gross: totGross, net: totNet, points: totPoints, played: played,
        frontPoints: frontPoints, backPoints: backPoints,
        frontGross: frontGross, backGross: backGross,
        complete: played === n
      }
    };
  }

  /**
   * Validate a set of stroke indexes is a complete 1..n with no duplicates
   * (PRD 5A.4). Returns { ok:boolean, message:string }.
   */
  function validateStrokeIndex(siArray, n) {
    var seen = {};
    for (var i = 0; i < n; i++) {
      var v = Number(siArray[i]);
      if (!v || v < 1 || v > n || Math.floor(v) !== v) {
        return { ok: false, message: 'Stroke Index for hole ' + (i + 1) + ' must be between 1 and ' + n + '.' };
      }
      if (seen[v]) {
        return { ok: false, message: 'Stroke Index ' + v + ' is used more than once.' };
      }
      seen[v] = true;
    }
    return { ok: true, message: '' };
  }

  /** Validate par values are plausible (3-6 per PRD 5A.4). */
  function validatePar(parArray, n) {
    for (var i = 0; i < n; i++) {
      var v = Number(parArray[i]);
      if (!v || v < 3 || v > 6 || Math.floor(v) !== v) {
        return { ok: false, message: 'Par for hole ' + (i + 1) + ' must be between 3 and 6.' };
      }
    }
    return { ok: true, message: '' };
  }

  // ---- Group generation (tee groups) -----------------------------------
  /**
   * Decide group sizes for N players given a preferred size S (2,3,4).
   * Returns sizes in play order (smallest first, per PRD), avoiding lone
   * 1-balls by re-balancing.
   */
  function groupSizes(N, S) {
    if (N <= 0) return [];
    if (N <= S) return [N];
    var full = Math.floor(N / S), rem = N % S, sizes = [], i;
    for (i = 0; i < full; i++) sizes.push(S);
    if (rem > 0) sizes.push(rem);
    // Avoid a lone single: merge it with a full group and re-split sensibly.
    if (rem === 1 && sizes.length > 1) {
      sizes.pop();                 // drop the 1
      var last = sizes.pop();      // a full S group
      var total = last + 1;        // S + 1
      if (total <= 3) sizes.push(total);                 // 2+1 -> a 3-ball
      else { var a = Math.ceil(total / 2); sizes.push(a, total - a); } // 4+1 -> 3,2
    }
    sizes.sort(function (x, y) { return x - y; }); // smallest (plays first) first
    return sizes;
  }

  function pairKey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

  /** Total "repeat pairing" cost of an arrangement, from prior pair counts. */
  function repeatCost(groups, pairCounts) {
    var cost = 0;
    groups.forEach(function (g) {
      for (var i = 0; i < g.length; i++)
        for (var j = i + 1; j < g.length; j++)
          cost += (pairCounts[pairKey(g[i], g[j])] || 0);
    });
    return cost;
  }

  function shuffle(arr, rnd) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor((rnd ? rnd() : Math.random()) * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function sliceBy(ids, sizes) {
    var groups = [], k = 0;
    sizes.forEach(function (s) { groups.push(ids.slice(k, k + s)); k += s; });
    return groups;
  }

  /**
   * Build tee groups.
   * @param {string[]} ids        player ids in the field
   * @param {number}   size       preferred group size (2|3|4)
   * @param {object}   opts
   *        mode: 'random' (default) | 'ranking'
   *        rankingWorstFirst: ids ordered worst→best (for 'ranking' mode)
   *        pairCounts: { 'a|b': n } prior groupings (for 'random' avoidance)
   *        attempts: random tries (default 400)
   * @returns {string[][]} groups in play order (smallest/worst first)
   */
  function makeGroups(ids, size, opts) {
    opts = opts || {};
    var sizes = groupSizes(ids.length, size);
    if (opts.mode === 'ranking') {
      var ordered = (opts.rankingWorstFirst || ids).filter(function (id) { return ids.indexOf(id) > -1; });
      // include any ids missing from the ranking at the end
      ids.forEach(function (id) { if (ordered.indexOf(id) < 0) ordered.push(id); });
      return sliceBy(ordered, sizes);
    }
    // random, minimising repeat pairings via best-of-N
    var pc = opts.pairCounts || {};
    var attempts = opts.attempts || 400;
    var best = null, bestCost = Infinity;
    for (var n = 0; n < attempts; n++) {
      var cand = sliceBy(shuffle(ids), sizes);
      var c = repeatCost(cand, pc);
      if (c < bestCost) { bestCost = c; best = cand; if (c === 0) break; }
    }
    return best || sliceBy(ids, sizes);
  }

  GT.golf = {
    courseHandicap: courseHandicap,
    shotsReceived: shotsReceived,
    netScore: netScore,
    stablefordPoints: stablefordPoints,
    stablefordLabel: stablefordLabel,
    parTotal: parTotal,
    computeRound: computeRound,
    validateStrokeIndex: validateStrokeIndex,
    validatePar: validatePar,
    groupSizes: groupSizes,
    makeGroups: makeGroups,
    pairKey: pairKey
  };
})(window.GT = window.GT || {});
