/*
 * db.js — Local-first storage layer (localStorage) with optional cloud sync.
 *
 * v2 data model (multi-tournament):
 *   - tournaments[]: each has its own adminCode + joinCode + members map.
 *   - players[]:     GLOBAL accounts (username/password); a player can belong
 *                    to many tournaments.
 *   - rounds[]:      each tagged with tournamentId.
 *   - scores{}:      keyed "<roundId>:<playerId>", tagged with tournamentId.
 *
 * Most accessors (getTournament/getRounds/getPlayers/…) operate on the
 * "active" tournament so the per-tournament screens work unchanged; a set of
 * by-id and membership helpers manage the wider platform.
 *
 * A v1 (single-tournament) save is migrated to v2 automatically on load.
 */
(function (GT) {
  'use strict';

  var KEY = 'golf_tournament_v1'; // storage key kept for continuity
  var SCHEMA_VERSION = 2;

  var cache = null;
  var activeTid = null; // currently selected tournament id

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + '_' +
      Math.random().toString(36).slice(2, 8);
  }

  function defaultData() {
    return {
      version: SCHEMA_VERSION,
      tournaments: [], // {id,name,numRounds,adminCode,joinCode,estimateNetForSummary,sessionHours,members,createdAt,updatedAt}
      players: [],     // {id,fullName,handicapIndex,cdhId,username,passwordHash,createdAt}
      rounds: [],      // {id,tournamentId,index,courseName,...,configured}
      scores: {},      // "<roundId>:<playerId>" -> {roundId,playerId,tournamentId,mode,holes,...}
      auditLog: []
    };
  }

  function blankTournament(data) {
    data = data || {};
    return {
      id: data.id || uid('tourn'),
      name: data.name || 'New Tournament',
      numRounds: data.numRounds || 4,
      adminCode: data.adminCode || '',
      joinCode: data.joinCode || '',
      estimateNetForSummary: !!data.estimateNetForSummary,
      sessionHours: data.sessionHours || 4,
      theme: data.theme || 'green',
      members: data.members || {}, // playerId -> { status:'member'|'blocked', joinedAt }
      createdAt: data.createdAt || Date.now(),
      updatedAt: Date.now()
    };
  }

  function blankRound(tournamentId, index) {
    return {
      id: uid('round'),
      tournamentId: tournamentId,
      index: index,
      courseName: '', date: '', teeColour: '', numHoles: 18,
      courseRating: null, slopeRating: null,
      details: '',
      par: new Array(18).fill(null),
      strokeIndex: new Array(18).fill(null),
      yardage: new Array(18).fill(null),
      imageDataUrl: null,
      configured: false
    };
  }

  // ---- Migration v1 -> v2 ----------------------------------------------
  /** Normalise any older shape into v2 in place. Returns true if it changed. */
  function migrateCache(c) {
    var changed = false;

    // (a) Oldest local shape: a single `tournament` object.
    if (c.tournament && !c.tournaments) {
      var old = c.tournament;
      var t = blankTournament({
        id: 'main', name: old.name, numRounds: old.numRounds,
        adminCode: old.adminCode, joinCode: old.playerCode || old.joinCode,
        estimateNetForSummary: old.estimateNetForSummary, sessionHours: old.sessionHours,
        createdAt: old.createdAt
      });
      t.legacyGrant = true; // every existing player belonged to this one tournament
      c.tournaments = [t];
      delete c.tournament;
      changed = true;
    }
    if (!Array.isArray(c.tournaments)) { c.tournaments = []; changed = true; }
    if (!Array.isArray(c.rounds)) { c.rounds = []; changed = true; }
    if (!Array.isArray(c.players)) { c.players = []; changed = true; }
    if (!c.scores) { c.scores = {}; changed = true; }

    // (b) Cloud v1 shape: tournaments exist but lack the v2 fields. A tournament
    //     that still has a `playerCode` is a pre-v2 one whose existing players
    //     should all be granted membership (flagged for the one-time grant in
    //     _hydrate, never on routine refreshes).
    c.tournaments.forEach(function (t) {
      if (t.playerCode != null) { if (t.joinCode == null) t.joinCode = t.playerCode; delete t.playerCode; t.legacyGrant = true; changed = true; }
      if (t.members == null) { t.members = {}; changed = true; }
      if (t.joinCode == null) { t.joinCode = ''; changed = true; }
    });

    // (c) Untagged rounds/scores -> assign to a tournament. If there is exactly
    //     one tournament, everything belongs to it (the common migration case).
    var soleTid = c.tournaments.length === 1 ? c.tournaments[0].id : null;
    c.rounds.forEach(function (r) {
      if (!r.tournamentId) { r.tournamentId = soleTid; changed = true; }
    });
    Object.keys(c.scores).forEach(function (k) {
      var s = c.scores[k];
      if (!s.tournamentId) {
        var rd = c.rounds.filter(function (r) { return r.id === s.roundId; })[0];
        s.tournamentId = (rd && rd.tournamentId) || soleTid;
        changed = true;
      }
    });

    if (c.version !== SCHEMA_VERSION) { c.version = SCHEMA_VERSION; changed = true; }
    return changed;
  }

  /** One-time member grant for tournaments migrated from v1 (flagged legacyGrant).
   *  Every existing player was a member of the single old tournament. Runs at
   *  hydrate (where the full player list is present), not on every refresh. */
  function applyLegacyGrants(c) {
    var granted = false;
    c.tournaments.forEach(function (t) {
      if (!t.legacyGrant) return;
      c.players.forEach(function (p) {
        if (!t.members[p.id]) t.members[p.id] = { status: 'member', joinedAt: p.createdAt || Date.now() };
      });
      delete t.legacyGrant;
      granted = true;
    });
    return granted;
  }

  // ---- Load / save ------------------------------------------------------
  function load() {
    if (cache) return cache;
    var raw = null;
    try { raw = window.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (!raw) { cache = defaultData(); save(); return cache; }
    try { cache = JSON.parse(raw); } catch (e) { console.error('Corrupt save data', e); cache = defaultData(); }
    migrateCache(cache);
    cache.tournaments.forEach(function (t) { ensureRoundsFor(t.id); });
    return cache;
  }

  function save() {
    if (!cache) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(cache)); }
    catch (e) { console.error('Save failed', e); GT.toast && GT.toast('Could not save — storage may be full.', 'error'); }
  }

  function blankCache() { return defaultData(); }

  /** Replace the in-memory cache (cloud adapter at boot/refresh).
   *  Migrates if needed and ensures round slots. Returns {migrated, newRounds}. */
  function _hydrate(newCache) {
    cache = newCache || defaultData();
    var migrated = migrateCache(cache);
    var granted = applyLegacyGrants(cache);
    var created = [];
    cache.tournaments.forEach(function (t) { created = created.concat(ensureRoundsFor(t.id)); });
    save();
    return { migrated: migrated || granted, newRounds: created };
  }

  // ---- Cloud sync helpers (no-ops unless configured) --------------------
  function cloudOn() { return GT.cloud && GT.cloud.enabled(); }
  function pushTournament(t) { if (cloudOn() && t) GT.cloud.upsertTournament(t); }
  function pushRound(r) { if (cloudOn() && r) GT.cloud.upsertRound(r); }
  function pushPlayer(p) { if (cloudOn() && p) GT.cloud.upsertPlayer(p); }
  function pushScore(s) { if (cloudOn() && s) GT.cloud.upsertScore(s); }
  function pushAll() {
    if (!cloudOn()) return;
    cache.tournaments.forEach(pushTournament);
    cache.rounds.forEach(pushRound);
    cache.players.forEach(pushPlayer);
    Object.keys(cache.scores).forEach(function (k) { pushScore(cache.scores[k]); });
  }

  // ---- Active tournament context ---------------------------------------
  function setActiveTournament(id) { activeTid = id; }
  function getActiveTournamentId() { return activeTid; }
  function getActiveTournament() { return getTournamentById(activeTid); }

  // ---- Tournaments ------------------------------------------------------
  function getTournaments() { return load().tournaments; }
  function getTournamentById(id) {
    return load().tournaments.filter(function (t) { return t.id === id; })[0] || null;
  }
  /** Back-compat: "the tournament" = the active one. */
  function getTournament() { return getActiveTournament(); }

  function createTournament(data) {
    var t = blankTournament(data);
    load().tournaments.push(t);
    var created = ensureRoundsFor(t.id);
    save();
    pushTournament(t);
    created.forEach(pushRound);
    return t;
  }
  function updateTournamentById(id, patch) {
    var t = getTournamentById(id);
    if (!t) return null;
    Object.assign(t, patch);
    t.updatedAt = Date.now();
    var created = [];
    if (patch.numRounds != null) created = ensureRoundsFor(id);
    save();
    pushTournament(t);
    created.forEach(pushRound);
    return t;
  }
  /** Back-compat: update the active tournament. */
  function updateTournament(patch) { return updateTournamentById(activeTid, patch); }

  function deleteTournament(id) {
    var d = load();
    var rounds = d.rounds.filter(function (r) { return r.tournamentId === id; });
    // remove scores for those rounds
    var removedScoreKeys = [];
    Object.keys(d.scores).forEach(function (k) {
      if (d.scores[k].tournamentId === id) { removedScoreKeys.push(k); delete d.scores[k]; }
    });
    d.rounds = d.rounds.filter(function (r) { return r.tournamentId !== id; });
    d.tournaments = d.tournaments.filter(function (t) { return t.id !== id; });
    save();
    if (cloudOn()) {
      removedScoreKeys.forEach(function (k) { GT.cloud.removeRow('scores', k); });
      rounds.forEach(function (r) { GT.cloud.removeRow('rounds', r.id); });
      GT.cloud.removeRow('tournaments', id);
    }
  }

  /** Clear all scores for a tournament (keeps courses + members). */
  function clearScores(id) {
    var d = load();
    var removed = [];
    Object.keys(d.scores).forEach(function (k) {
      if (d.scores[k].tournamentId === id) { removed.push(k); delete d.scores[k]; }
    });
    save();
    if (cloudOn()) removed.forEach(function (k) { GT.cloud.removeRow('scores', k); });
  }

  function findTournamentByJoinCode(code) {
    if (!code) return null;
    var c = code.trim().toLowerCase();
    return load().tournaments.filter(function (t) {
      return t.joinCode && t.joinCode.toLowerCase() === c;
    })[0] || null;
  }

  // ---- Rounds (scoped to active tournament) ----------------------------
  function getRounds() {
    return load().rounds
      .filter(function (r) { return r.tournamentId === activeTid; })
      .sort(function (a, b) { return a.index - b.index; });
  }
  function getRoundsFor(tid) {
    return load().rounds
      .filter(function (r) { return r.tournamentId === tid; })
      .sort(function (a, b) { return a.index - b.index; });
  }
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
  /** Ensure a tournament has one round slot per its numRounds. Returns new ones. */
  function ensureRoundsFor(tid) {
    var t = getTournamentById(tid);
    if (!t) return [];
    var rounds = load().rounds.filter(function (r) { return r.tournamentId === tid; })
      .sort(function (a, b) { return a.index - b.index; });
    var created = [];
    for (var i = rounds.length; i < t.numRounds; i++) {
      var nr = blankRound(tid, i + 1);
      cache.rounds.push(nr); rounds.push(nr); created.push(nr);
    }
    // trim trailing unconfigured rounds beyond numRounds
    while (rounds.length > t.numRounds) {
      var last = rounds[rounds.length - 1];
      if (last.configured) break;
      cache.rounds = cache.rounds.filter(function (r) { return r.id !== last.id; });
      rounds.pop();
      if (cloudOn()) GT.cloud.removeRow('rounds', last.id);
    }
    rounds.forEach(function (r, idx) { r.index = idx + 1; });
    return created;
  }

  // ---- Players (GLOBAL accounts) ---------------------------------------
  function getAllPlayers() { return load().players; }
  function getPlayer(id) {
    return load().players.filter(function (p) { return p.id === id; })[0] || null;
  }
  function addPlayer(data) {
    var p = {
      id: data.id || uid('player'),
      fullName: data.fullName,
      nickname: data.nickname || '',
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
  /** Remove a global account: from all tournaments' members and all their scores. */
  function removePlayer(id) {
    var d = load();
    d.players = d.players.filter(function (p) { return p.id !== id; });
    var removedScoreKeys = [];
    Object.keys(d.scores).forEach(function (k) {
      if (k.indexOf(':' + id) > -1) { removedScoreKeys.push(k); delete d.scores[k]; }
    });
    var touchedTournaments = [];
    d.tournaments.forEach(function (t) {
      if (t.members && t.members[id]) { delete t.members[id]; touchedTournaments.push(t); }
    });
    save();
    if (cloudOn()) {
      GT.cloud.removeRow('players', id);
      removedScoreKeys.forEach(function (k) { GT.cloud.removeRow('scores', k); });
      touchedTournaments.forEach(pushTournament);
    }
  }
  function findDuplicateCdh(cdhId, exceptId) {
    if (!cdhId) return null;
    return load().players.filter(function (p) {
      return p.id !== exceptId && p.cdhId && p.cdhId.toLowerCase() === cdhId.toLowerCase();
    })[0] || null;
  }
  function findPlayerByUsername(username) {
    if (!username) return null;
    var u = username.trim().toLowerCase();
    return load().players.filter(function (p) { return p.username && p.username.toLowerCase() === u; })[0] || null;
  }
  function findDuplicateUsername(username, exceptId) {
    if (!username) return null;
    var u = username.trim().toLowerCase();
    return load().players.filter(function (p) {
      return p.id !== exceptId && p.username && p.username.toLowerCase() === u;
    })[0] || null;
  }

  // ---- Membership -------------------------------------------------------
  function getMembership(tid, pid) {
    var t = getTournamentById(tid);
    return (t && t.members && t.members[pid]) || null;
  }
  function isMember(tid, pid) {
    var m = getMembership(tid, pid);
    return !!(m && m.status === 'member');
  }
  function isBlocked(tid, pid) {
    var m = getMembership(tid, pid);
    return !!(m && m.status === 'blocked');
  }
  /** Members of a tournament as [{player, status, joinedAt}] (existing accounts). */
  function getMembers(tid) {
    var t = getTournamentById(tid);
    if (!t || !t.members) return [];
    return Object.keys(t.members).map(function (pid) {
      var p = getPlayer(pid);
      return p ? { player: p, status: t.members[pid].status, joinedAt: t.members[pid].joinedAt } : null;
    }).filter(Boolean);
  }
  /** Players (member status) of the ACTIVE tournament — used by scoring/leaderboards. */
  function getPlayers() {
    var t = getActiveTournament();
    if (!t || !t.members) return [];
    return Object.keys(t.members)
      .filter(function (pid) { return t.members[pid].status === 'member'; })
      .map(function (pid) { return getPlayer(pid); })
      .filter(Boolean);
  }
  function setMemberStatus(tid, pid, status) {
    var t = getTournamentById(tid);
    if (!t) return;
    t.members = t.members || {};
    if (status == null) delete t.members[pid];
    else t.members[pid] = { status: status, joinedAt: (t.members[pid] && t.members[pid].joinedAt) || Date.now() };
    t.updatedAt = Date.now();
    save();
    pushTournament(t);
  }
  function addMember(tid, pid) { setMemberStatus(tid, pid, 'member'); }
  function removeMember(tid, pid) { setMemberStatus(tid, pid, null); }
  function blockMember(tid, pid) { setMemberStatus(tid, pid, 'blocked'); }

  /** Join a tournament by its code. Returns {ok, tournament, reason}. */
  function joinTournamentByCode(code, pid) {
    var t = findTournamentByJoinCode(code);
    if (!t) return { ok: false, reason: 'notfound' };
    if (isBlocked(t.id, pid)) return { ok: false, reason: 'blocked', tournament: t };
    addMember(t.id, pid);
    return { ok: true, tournament: t };
  }
  /** Tournaments a player is currently a member of. */
  function getPlayerTournaments(pid) {
    return load().tournaments.filter(function (t) {
      return t.members && t.members[pid] && t.members[pid].status === 'member';
    });
  }

  // ---- Scores -----------------------------------------------------------
  function scoreKey(roundId, playerId) { return roundId + ':' + playerId; }
  function getScore(roundId, playerId) { return load().scores[scoreKey(roundId, playerId)] || null; }
  function blankScore(roundId, playerId, mode) {
    var rd = getRound(roundId);
    return {
      roundId: roundId, playerId: playerId,
      tournamentId: (rd && rd.tournamentId) || activeTid,
      mode: mode || 'A',
      holes: new Array(18).fill(null),
      summaryGross: null, summaryStableford: null,
      locked: false, updatedAt: Date.now()
    };
  }
  function saveScore(record) {
    record.updatedAt = Date.now();
    if (!record.tournamentId) {
      var rd = getRound(record.roundId);
      record.tournamentId = (rd && rd.tournamentId) || activeTid;
    }
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

  // ---- Audit log (global, local-only) ----------------------------------
  function logAdmin(message) {
    load().auditLog.unshift({ ts: Date.now(), message: message, tournamentId: activeTid });
    if (cache.auditLog.length > 500) cache.auditLog.length = 500;
    save();
  }
  function getAuditLog() {
    return load().auditLog.filter(function (e) { return !activeTid || !e.tournamentId || e.tournamentId === activeTid; });
  }

  // ---- Whole-DB ops -----------------------------------------------------
  function exportJSON() { return JSON.stringify(load(), null, 2); }
  function importJSON(json) {
    var parsed = JSON.parse(json);
    if (!parsed.version && !parsed.tournament && !parsed.tournaments) throw new Error('Not a valid tournament file.');
    cache = parsed;
    migrateCache(cache);
    cache.tournaments.forEach(function (t) { ensureRoundsFor(t.id); });
    save();
    pushAll();
  }

  GT.db = {
    uid: uid, load: load, save: save, blankCache: blankCache, _hydrate: _hydrate, pushAll: pushAll,
    // active context
    setActiveTournament: setActiveTournament, getActiveTournamentId: getActiveTournamentId, getActiveTournament: getActiveTournament,
    // tournaments
    getTournaments: getTournaments, getTournamentById: getTournamentById, getTournament: getTournament,
    createTournament: createTournament, updateTournamentById: updateTournamentById, updateTournament: updateTournament,
    deleteTournament: deleteTournament, clearScores: clearScores, findTournamentByJoinCode: findTournamentByJoinCode,
    // rounds
    getRounds: getRounds, getRoundsFor: getRoundsFor, getRound: getRound, updateRound: updateRound, ensureRoundsFor: ensureRoundsFor,
    // players (global)
    getAllPlayers: getAllPlayers, getPlayer: getPlayer, addPlayer: addPlayer, updatePlayer: updatePlayer, removePlayer: removePlayer,
    findDuplicateCdh: findDuplicateCdh, findPlayerByUsername: findPlayerByUsername, findDuplicateUsername: findDuplicateUsername,
    // membership
    getMembership: getMembership, isMember: isMember, isBlocked: isBlocked, getMembers: getMembers, getPlayers: getPlayers,
    setMemberStatus: setMemberStatus, addMember: addMember, removeMember: removeMember, blockMember: blockMember,
    joinTournamentByCode: joinTournamentByCode, getPlayerTournaments: getPlayerTournaments,
    // scores
    getScore: getScore, blankScore: blankScore, saveScore: saveScore, deleteScore: deleteScore,
    // misc
    logAdmin: logAdmin, getAuditLog: getAuditLog, exportJSON: exportJSON, importJSON: importJSON
  };
})(window.GT = window.GT || {});
