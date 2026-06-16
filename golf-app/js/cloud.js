/*
 * cloud.js — Optional Supabase backend adapter.
 *
 * When GT.CONFIG has a Supabase URL + anon key, this turns the app from
 * on-device-only into a shared, live tournament: it hydrates the same
 * in-memory cache the app already uses from the database, pushes each change
 * back per-record, and subscribes to realtime updates so every device stays
 * in sync. When not configured, everything here is a no-op and the app runs
 * exactly as before on localStorage.
 *
 * The data layer (db.js) stays synchronous: the cloud is loaded once at boot
 * into the cache, writes are fire-and-forget, and realtime events refresh.
 */
(function (GT) {
  'use strict';

  var cfg = (GT.CONFIG || {});
  var client = null;          // Supabase client (once loaded)
  var SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';

  function enabled() {
    return !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  }

  // Dynamically load the Supabase JS SDK (only when cloud mode is on, so local
  // mode never needs the network).
  function loadSdk() {
    return new Promise(function (resolve, reject) {
      if (window.supabase && window.supabase.createClient) return resolve();
      var s = document.createElement('script');
      s.src = SDK_URL;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Could not load Supabase SDK')); };
      document.head.appendChild(s);
    });
  }

  function getClient() {
    if (!client) client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return client;
  }

  // ---- Boot: load the whole tournament into the cache -------------------
  function fetchAll() {
    var c = getClient();
    return Promise.all([
      c.from('tournaments').select('*').eq('id', 'main').maybeSingle(),
      c.from('rounds').select('*'),
      c.from('players').select('*'),
      c.from('scores').select('*')
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw r.error; });
      var tRow = res[0].data, roundRows = res[1].data || [], playerRows = res[2].data || [], scoreRows = res[3].data || [];

      var cache = GT.db.blankCache();
      if (tRow && tRow.data) cache.tournament = tRow.data;

      cache.rounds = roundRows
        .map(function (r) { return r.data; })
        .sort(function (a, b) { return (a.index || 0) - (b.index || 0); });

      cache.players = playerRows.map(function (p) { return p.data; });

      cache.scores = {};
      scoreRows.forEach(function (s) { cache.scores[s.id] = s.data; });

      return { cache: cache, tournamentNew: !tRow };
    });
  }

  function bootstrap() {
    if (!enabled()) return Promise.resolve(false);
    return loadSdk().then(fetchAll).then(function (out) {
      // Hydrate the data layer, then make sure the tournament row + round slots
      // exist in the cloud (first run seeds them).
      var created = GT.db._hydrate(out.cache);
      var seeds = [];
      if (out.tournamentNew) seeds.push(upsertTournament(out.cache.tournament));
      created.newRounds.forEach(function (r) { seeds.push(upsertRound(r)); });
      return Promise.all(seeds).then(function () { return true; });
    });
  }

  // Re-fetch everything and refresh the cache (used on realtime events).
  function refresh() {
    if (!enabled()) return Promise.resolve(false);
    return fetchAll().then(function (out) { GT.db._hydrate(out.cache); return true; });
  }

  // ---- Per-entity writes (fire-and-forget, with error toast) ------------
  function ok(table, row) {
    return getClient().from(table).upsert(row).then(function (r) {
      if (r.error) { console.error('[cloud] ' + table + ' write failed', r.error); GT.toast('Cloud save failed — will retry on next change.', 'error'); }
    }, function (e) { console.error('[cloud]', e); });
  }

  function upsertTournament(t) { return ok('tournaments', { id: 'main', data: t, updated_at: new Date().toISOString() }); }
  function upsertRound(r) { return ok('rounds', { id: r.id, idx: r.index || 0, data: r, updated_at: new Date().toISOString() }); }
  function upsertPlayer(p) { return ok('players', { id: p.id, data: p, updated_at: new Date().toISOString() }); }
  function upsertScore(s) {
    return ok('scores', { id: s.roundId + ':' + s.playerId, round_id: s.roundId, player_id: s.playerId, data: s, updated_at: new Date().toISOString() });
  }
  function removeRow(table, id) {
    if (!enabled()) return Promise.resolve();
    return getClient().from(table).delete().eq('id', id).then(function (r) {
      if (r.error) console.error('[cloud] delete failed', r.error);
    });
  }

  function wipeAll() {
    if (!enabled()) return Promise.resolve();
    var c = getClient();
    // neq on a value no id will ever equal = "delete all rows"
    return Promise.all([
      c.from('scores').delete().neq('id', '__none__'),
      c.from('players').delete().neq('id', '__none__'),
      c.from('rounds').delete().neq('id', '__none__'),
      c.from('tournaments').delete().neq('id', '__none__')
    ]);
  }

  // ---- Realtime ---------------------------------------------------------
  var channel = null;
  function subscribe(onChange) {
    if (!enabled()) return;
    var c = getClient();
    channel = c.channel('golf-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournaments' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, onChange)
      .subscribe();
  }

  GT.cloud = {
    enabled: enabled,
    bootstrap: bootstrap,
    refresh: refresh,
    subscribe: subscribe,
    upsertTournament: upsertTournament,
    upsertRound: upsertRound,
    upsertPlayer: upsertPlayer,
    upsertScore: upsertScore,
    removeRow: removeRow,
    wipeAll: wipeAll
  };
})(window.GT = window.GT || {});
