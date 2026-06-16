/*
 * db.js — Local-first storage layer (localStorage).
 *
 * The whole tournament lives in one JSON blob under a single key. localStorage
 * is used (not IndexedDB) because it works reliably from file:// across every
 * browser, and the data — players, rounds, scores — is small JSON.
 *
 * Attaches to GT.db.
 */
(function (GT) {
  'use strict';

  var KEY = 'golf_tournament_v1';
  var SCHEMA_VERSION = 1;

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  function defaultData() {
    return {
      version: SCHEMA_VERSION,
      tournament: {
        name: 'My Golf Tournament',
        numRounds: 4,
        playerCode: 'golf',
        adminCode: 'admin',
        estimateNetForSummary: false, // PRD 7.3.2 admin option
        sessionHours: 4,
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      rounds: [],   // [{ id, index, courseName, date, teeColour, numHoles,
                    //    courseRating, slopeRating, par[], strokeIndex[], yardage[],
                    //    imageDataUrl, configured }]
      players: [],  // [{ id, fullName, handicapIndex, cdhId, createdAt }]
      scores: {},   // key `${roundId}:${playerId}` -> score record
      auditLog: []  // [{ ts, message }]
    };
  }

  var cache = null;

  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) {
      cache = defaultData();
      ensureRounds();
      save();
      return cache;
    }
    try {
      cache = JSON.parse(raw);
    } catch (e) {
      console.error('Corrupt save data, starting fresh', e);
      cache = defaultData();
    }
    if (!cache.version) cache = defaultData();
    ensureRounds();
    return cache;
  }

  function save() {
    if (!cache) return;
    cache.tournament.updatedAt = Date.now();
    try {
      window.localStorage.setItem(KEY, JSON.stringify(cache));
    } catch (e) {
      console.error('Save failed (storage full?)', e);
      GT.toast && GT.toast('Could not save — storage may be full.', 'error');
    }
  }

  /** Make sure there is one round slot per configured round number.
   *  Returns the list of round slots it newly created (for cloud seeding). */
  function ensureRounds() {
    var n = cache.tournament.numRounds;
    var created = [];
    if (!Array.isArray(cache.rounds)) cache.rounds = [];
    // Add missing round slots
    for (var i = cache.rounds.length; i < n; i++) {
      var nr = blankRound(i + 1);
      cache.rounds.push(nr);
      created.push(nr);
    }
    // Trim extra rounds beyond configured count (only if unconfigured)
    while (cache.rounds.length > n) {
      var last = cache.rounds[cache.rounds.length - 1];
      if (last.configured) break; // never silently delete configured rounds
      cache.rounds.pop();
    }
    // Re-index
    cache.rounds.forEach(function (r, idx) { r.index = idx + 1; });
    return created;
  }

  // ---- Cloud sync helpers (no-ops unless cloud mode is configured) -------
  function cloudOn() { return GT.cloud && GT.cloud.enabled(); }
  function pushTournament() { if (cloudOn()) GT.cloud.upsertTournament(cache.tournament); }
  function pushRound(r) { if (cloudOn()) GT.cloud.upsertRound(r); }
  function pushPlayer(p) { if (cloudOn()) GT.cloud.upsertPlayer(p); }
  function pushScore(s) { if (cloudOn()) GT.cloud.upsertScore(s); }
  /** Upsert the entire current state to the cloud (used after import/reset). */
  function pushAll() {
    if (!cloudOn()) return;
    pushTournament();
    cache.rounds.forEach(pushRound);
    cache.players.forEach(pushPlayer);
    Object.keys(cache.scores).forEach(function (k) { pushScore(cache.scores[k]); });
  }

  /** Returns a fresh empty data structure (used by the cloud adapter). */
  function blankCache() { return defaultData(); }

  /** Replace the in-memory cache (called by the cloud adapter at boot/refresh).
   *  Returns the round slots it had to create so the caller can seed them. */
  function _hydrate(newCache) {
    cache = newCache;
    if (!cache.version) cache = defaultData();
    var created = ensureRounds();
    save(); // keep a local offline copy
    return { newRounds: created };
  }

  function blankRound(index) {
    return {
      id: uid('round'),
      index: index,
      courseName: '',
      date: '',
      teeColour: '',
      numHoles: 18,
      courseRating: null,
      slopeRating: null,
      par: new Array(18).fill(null),
      strokeIndex: new Array(18).fill(null),
      yardage: new Array(18).fill(null),
      imageDataUrl: null,
      configured: false
    };
  }

  // ---- Tournament -------------------------------------------------------
  function getTournament() { return load().tournament; }
  function updateTournament(patch) {
    var t = load().tournament;
    Object.assign(t, patch);
    var created = [];
    if (patch.numRounds != null) created = ensureRounds();
    save();
    pushTournament();
    created.forEach(pushRound);
    return t;
  }

  // ---- Rounds -----------------------------------------------------------
  function getRounds() { return load().rounds; }
  function getRound(id) {
    return load().rounds.filter(function (r) { return r.id === id; })[0] || null;
  }
  function updateRound(id, patch) {
    var r = getRound(id);
    if (!r) return null;
    Object.assign(r, patch);
    save();
    pushRound(r);
    return r;
  }

  // ---- Players ----------------------------------------------------------
  function getPlayers() { return load().players; }
  function getPlayer(id) {
    return load().players.filter(function (p) { return p.id === id; })[0] || null;
  }
  function addPlayer(data) {
    var p = {
      id: uid('player'),
      fullName: data.fullName,
      handicapIndex: data.handicapIndex,
      cdhId: data.cdhId || '',
      username: data.username || '',
      passwordHash: data.passwordHash || '',
      createdAt: Date.now()
    };
    load().players.push(p);
    save();
    pushPlayer(p);
    return p;
  }
  function updatePlayer(id, patch) {
    var p = getPlayer(id);
    if (!p) return null;
    Object.assign(p, patch);
    save();
    pushPlayer(p);
    return p;
  }
  function removePlayer(id) {
    var d = load();
    d.players = d.players.filter(function (p) { return p.id !== id; });
    // Remove that player's scores too
    var removedScoreKeys = [];
    Object.keys(d.scores).forEach(function (k) {
      if (k.indexOf(':' + id) > -1) { removedScoreKeys.push(k); delete d.scores[k]; }
    });
    save();
    if (cloudOn()) {
      GT.cloud.removeRow('players', id);
      removedScoreKeys.forEach(function (k) { GT.cloud.removeRow('scores', k); });
    }
  }
  /** Returns the player record with a duplicate CDH ID, if any (PRD 4.2). */
  function findDuplicateCdh(cdhId, exceptId) {
    if (!cdhId) return null;
    return load().players.filter(function (p) {
      return p.id !== exceptId && p.cdhId &&
        p.cdhId.toLowerCase() === cdhId.toLowerCase();
    })[0] || null;
  }
  /** Find a player by username (case-insensitive), for login. */
  function findPlayerByUsername(username) {
    if (!username) return null;
    var u = username.trim().toLowerCase();
    return load().players.filter(function (p) {
      return p.username && p.username.toLowerCase() === u;
    })[0] || null;
  }
  /** Another player already using this username? (usernames must be unique). */
  function findDuplicateUsername(username, exceptId) {
    if (!username) return null;
    var u = username.trim().toLowerCase();
    return load().players.filter(function (p) {
      return p.id !== exceptId && p.username && p.username.toLowerCase() === u;
    })[0] || null;
  }

  // ---- Scores -----------------------------------------------------------
  function scoreKey(roundId, playerId) { return roundId + ':' + playerId; }

  function getScore(roundId, playerId) {
    return load().scores[scoreKey(roundId, playerId)] || null;
  }
  function blankScore(roundId, playerId, mode) {
    return {
      roundId: roundId,
      playerId: playerId,
      mode: mode || 'A',
      holes: new Array(18).fill(null), // gross per hole; null = not entered / NR
      summaryGross: null,
      summaryStableford: null,
      locked: false,
      updatedAt: Date.now()
    };
  }
  function saveScore(record) {
    record.updatedAt = Date.now();
    load().scores[scoreKey(record.roundId, record.playerId)] = record;
    save();
    pushScore(record);
    return record;
  }
  function deleteScore(roundId, playerId) {
    delete load().scores[scoreKey(roundId, playerId)];
    save();
    if (cloudOn()) GT.cloud.removeRow('scores', scoreKey(roundId, playerId));
  }

  // ---- Audit log --------------------------------------------------------
  function logAdmin(message) {
    load().auditLog.unshift({ ts: Date.now(), message: message });
    if (cache.auditLog.length > 500) cache.auditLog.length = 500;
    save();
  }
  function getAuditLog() { return load().auditLog; }

  // ---- Whole-DB ops -----------------------------------------------------
  function exportJSON() { return JSON.stringify(load(), null, 2); }
  function importJSON(json) {
    var parsed = JSON.parse(json);
    if (!parsed.version) throw new Error('Not a valid tournament file.');
    cache = parsed;
    ensureRounds();
    save();
    pushAll(); // mirror the restored tournament to the cloud
  }
  function resetTournament() {
    if (cloudOn()) GT.cloud.wipeAll();
    cache = defaultData();
    ensureRounds();
    save();
    pushAll(); // seed the fresh tournament in the cloud
  }

  GT.db = {
    uid: uid,
    load: load,
    save: save,
    blankCache: blankCache,
    _hydrate: _hydrate,
    pushAll: pushAll,
    getTournament: getTournament,
    updateTournament: updateTournament,
    getRounds: getRounds,
    getRound: getRound,
    updateRound: updateRound,
    getPlayers: getPlayers,
    getPlayer: getPlayer,
    addPlayer: addPlayer,
    updatePlayer: updatePlayer,
    removePlayer: removePlayer,
    findDuplicateCdh: findDuplicateCdh,
    findPlayerByUsername: findPlayerByUsername,
    findDuplicateUsername: findDuplicateUsername,
    getScore: getScore,
    blankScore: blankScore,
    saveScore: saveScore,
    deleteScore: deleteScore,
    logAdmin: logAdmin,
    getAuditLog: getAuditLog,
    exportJSON: exportJSON,
    importJSON: importJSON,
    resetTournament: resetTournament
  };
})(window.GT = window.GT || {});
