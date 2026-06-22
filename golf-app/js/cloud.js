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
      c.from('tournaments').select('*'),
      c.from('rounds').select('*'),
      c.from('players').select('*'),
      c.from('scores').select('*')
    ]).then(function (res) {
      res.forEach(function (r) { if (r.error) throw r.error; });
      var tournRows = res[0].data || [], roundRows = res[1].data || [], playerRows = res[2].data || [], scoreRows = res[3].data || [];

      // Inject each row's primary key into its JSON, in case an older record
      // stored the id only as the row key (e.g. the original single tournament).
      function withId(row) { var d = row.data || {}; if (d.id == null) d.id = row.id; return d; }

      var cache = GT.db.blankCache();
      cache.tournaments = tournRows.map(withId);
      cache.rounds = roundRows.map(withId);
      cache.players = playerRows.map(withId);
      cache.scores = {};
      scoreRows.forEach(function (s) { cache.scores[s.id] = s.data; });

      return { cache: cache };
    });
  }

  function bootstrap() {
    if (!enabled()) return Promise.resolve(false);
    return loadSdk().then(fetchAll).then(function (out) {
      // Hydrate the data layer; if the cloud held an older (v1) shape it gets
      // migrated to v2 here and written back. Newly created round slots are
      // also pushed.
      var res = GT.db._hydrate(out.cache);
      if (res.migrated) {
        GT.db.pushAll();
      } else {
        res.newRounds.forEach(function (r) { upsertRound(r); });
      }
      return true;
    });
  }

  // Re-fetch everything and refresh the cache (used on realtime events).
  function refresh() {
    if (!enabled()) return Promise.resolve(false);
    return fetchAll().then(function (out) { GT.db._hydrate(out.cache); return true; });
  }

  // Track ids we just wrote so we can ignore the realtime echo of our own
  // changes (which would otherwise re-render the screen mid-interaction).
  var recentWrites = {};
  function markWrite(id) { if (id) recentWrites[id] = Date.now(); }
  function isRecentWrite(id) {
    if (!id || !recentWrites[id]) return false;
    if (Date.now() - recentWrites[id] > 8000) { delete recentWrites[id]; return false; }
    return true;
  }

  // ---- Per-entity writes (fire-and-forget, with error toast) ------------
  function ok(table, row) {
    markWrite(row.id);
    return getClient().from(table).upsert(row).then(function (r) {
      if (r.error) { console.error('[cloud] ' + table + ' write failed', r.error); GT.toast('Cloud save failed — will retry on next change.', 'error'); }
    }, function (e) { console.error('[cloud]', e); });
  }

  function upsertTournament(t) { return ok('tournaments', { id: t.id, data: t, updated_at: new Date().toISOString() }); }
  function upsertRound(r) { return ok('rounds', { id: r.id, idx: r.index || 0, data: r, updated_at: new Date().toISOString() }); }
  function upsertPlayer(p) { return ok('players', { id: p.id, data: p, updated_at: new Date().toISOString() }); }
  function upsertScore(s) {
    return ok('scores', { id: s.roundId + ':' + s.playerId, round_id: s.roundId, player_id: s.playerId, data: s, updated_at: new Date().toISOString() });
  }
  function removeRow(table, id) {
    if (!enabled()) return Promise.resolve();
    markWrite(id);
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

  // ---- Image storage (Supabase Storage 'images' bucket) ----------------
  function uploadImage(blob, path, contentType) {
    if (!enabled()) return Promise.reject(new Error('Image upload needs the cloud.'));
    return loadSdk().then(function () {
      return getClient().storage.from('images').upload(path, blob, { contentType: contentType || 'image/jpeg', upsert: true });
    }).then(function (res) {
      if (res.error) throw res.error;
      return getClient().storage.from('images').getPublicUrl(path).data.publicUrl;
    });
  }
  // Best-effort delete of an image given its public URL.
  function deleteImageByUrl(url) {
    if (!enabled() || !url) return Promise.resolve();
    var m = /\/images\/(.+?)(\?.*)?$/.exec(url);
    if (!m) return Promise.resolve();
    return getClient().storage.from('images').remove([m[1]]).catch(function () {});
  }

  // ---- Realtime ---------------------------------------------------------
  var channel = null;
  function subscribe(onChange) {
    if (!enabled()) return;
    var c = getClient();
    var tables = ['tournaments', 'rounds', 'players', 'scores'];
    channel = c.channel('golf-sync');
    tables.forEach(function (tbl) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table: tbl }, function (payload) {
        var id = (payload && payload.new && payload.new.id) || (payload && payload.old && payload.old.id);
        if (isRecentWrite(id)) return; // our own change — already applied locally
        onChange(payload);
      });
    });
    channel.subscribe();
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
    wipeAll: wipeAll,
    uploadImage: uploadImage,
    deleteImageByUrl: deleteImageByUrl,
    isRecentWrite: isRecentWrite
  };
})(window.GT = window.GT || {});
