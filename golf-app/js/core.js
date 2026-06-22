/*
 * core.js — Shared UI utilities: DOM helpers, toast, modal/confirm,
 * session state, and a tiny hash router. Attaches to GT.
 */
(function (GT) {
  'use strict';

  // ---- DOM helper -------------------------------------------------------
  // h('div.card#id', { onclick: fn }, [children|strings])
  function h(tag, attrs, children) {
    var parts = String(tag).split(/(?=[.#])/);
    var el = document.createElement(parts[0] || 'div');
    for (var i = 1; i < parts.length; i++) {
      var p = parts[i];
      if (p[0] === '.') el.classList.add(p.slice(1));
      else if (p[0] === '#') el.id = p.slice(1);
    }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') { el.className += (el.className ? ' ' : '') + v; }
        else if (k === 'html') { el.innerHTML = v; }
        else if (k === 'text') { el.textContent = v; }
        else if (k === 'style' && typeof v === 'object') { Object.assign(el.style, v); }
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'value') { el.value = v; }
        else if (v === true) { el.setAttribute(k, ''); }
        else { el.setAttribute(k, v); }
      });
    }
    appendChildren(el, children);
    return el;
  }

  function appendChildren(el, children) {
    if (children == null) return;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null || c === false) return;
      if (typeof c === 'string' || typeof c === 'number') {
        el.appendChild(document.createTextNode(String(c)));
      } else {
        el.appendChild(c);
      }
    });
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDate(iso) {
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // ---- Password hashing -------------------------------------------------
  // cyrb53: a fast 53-bit string hash. Not cryptographically strong, but it
  // keeps player passwords out of localStorage in plaintext (so they can't be
  // shoulder-read) and lets the admin set — but not see — a password. Good
  // enough for a friends' golf-trip app; see README for the security note.
  var PW_SALT = 'golf-tourney-v1';
  function cyrb53(str, seed) {
    seed = seed || 0;
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0, ch; i < str.length; i++) {
      ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  function hashPassword(pw) {
    if (pw == null || pw === '') return '';
    return 'h1$' + cyrb53(PW_SALT + String(pw)).toString(16);
  }
  function verifyPassword(pw, hash) {
    if (!hash) return false;
    return hashPassword(pw) === hash;
  }

  // ---- Toast ------------------------------------------------------------
  function toast(message, type) {
    var host = document.getElementById('toast-host');
    if (!host) return;
    var t = h('div.toast' + (type ? '.toast-' + type : ''), {}, message);
    host.appendChild(t);
    setTimeout(function () { t.classList.add('show'); }, 10);
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.remove(); }, 300);
    }, 3200);
  }

  // ---- Modal / confirm --------------------------------------------------
  function modal(opts) {
    // opts: { title, body(Node|string), actions:[{label,kind,onClick(close)}], onClose }
    var overlay = h('div.modal-overlay');
    function close() { overlay.remove(); opts.onClose && opts.onClose(); }
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    var actionEls = (opts.actions || [{ label: 'Close', kind: 'ghost' }]).map(function (a) {
      return h('button.btn' + (a.kind ? '.btn-' + a.kind : ''), {
        onclick: function () { if (a.onClick) a.onClick(close); else close(); }
      }, a.label);
    });

    var bodyNode = typeof opts.body === 'string' ? h('p', {}, opts.body) : opts.body;
    var box = h('div.modal', {}, [
      opts.title ? h('h3.modal-title', {}, opts.title) : null,
      h('div.modal-body', {}, bodyNode),
      h('div.modal-actions', {}, actionEls)
    ]);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    return close;
  }

  function confirm(message, onYes, opts) {
    opts = opts || {};
    modal({
      title: opts.title || 'Please confirm',
      body: message,
      actions: [
        { label: opts.cancelLabel || 'Cancel', kind: 'ghost' },
        { label: opts.yesLabel || 'Confirm', kind: opts.danger ? 'danger' : 'primary',
          onClick: function (close) { close(); onYes && onYes(); } }
      ]
    });
  }

  // ---- Session state ----------------------------------------------------
  var SESSION_KEY = 'golf_session_v1';
  var state = { role: null, playerId: null, tournamentId: null, expiresAt: 0 };

  function loadSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s.expiresAt && s.expiresAt > Date.now()) state = s;
      }
    } catch (e) { /* ignore */ }
    return state;
  }
  function saveSession() {
    var t = GT.db.getActiveTournament && GT.db.getActiveTournament();
    var hours = (t && t.sessionHours) || 4;
    state.expiresAt = Date.now() + hours * 3600 * 1000;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch (e) {}
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function setRole(role) { state.role = role; saveSession(); }
  function setPlayer(id) { state.playerId = id; saveSession(); }
  function setTournament(id) { state.tournamentId = id; GT.db.setActiveTournament(id); saveSession(); }
  function logout() {
    state = { role: null, playerId: null, tournamentId: null, expiresAt: 0 };
    GT.db.setActiveTournament(null);
    try { sessionStorage.removeItem(SESSION_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) {}
    GT.router.go('login');
  }
  function isAdmin() { return state.role === 'admin'; }
  function isViewer() { return state.role === 'viewer'; }
  function currentPlayer() { return state.playerId ? GT.db.getPlayer(state.playerId) : null; }

  // ---- Router (hash based) ---------------------------------------------
  var routes = {};
  function register(name, fn) { routes[name] = fn; }

  function parseHash() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('?');
    var path = parts[0] || '';
    var query = {};
    if (parts[1]) {
      parts[1].split('&').forEach(function (pair) {
        var kv = pair.split('=');
        query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
    }
    var seg = path.split('/');
    return { name: seg[0] || 'login', params: seg.slice(1), query: query };
  }

  function go(name, params, query) {
    var hash = '#/' + name;
    if (params && params.length) hash += '/' + params.join('/');
    if (query) {
      var qs = Object.keys(query).map(function (k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(query[k]);
      }).join('&');
      if (qs) hash += '?' + qs;
    }
    if (location.hash === hash) render();
    else location.hash = hash;
  }

  function render() {
    var route = parseHash();
    loadSession();
    // Keep the data layer scoped to the session's active tournament.
    GT.db.setActiveTournament(state.tournamentId || null);

    // Auth gate: everything except these public routes requires a role
    var PUBLIC = { login: 1, createtournament: 1 };
    if (!PUBLIC[route.name] && !state.role) {
      go('login');
      return;
    }
    var fn = routes[route.name] || routes['notfound'];
    var app = document.getElementById('view');
    clear(app);
    window.scrollTo(0, 0);
    try {
      fn(app, route.params, route.query);
    } catch (e) {
      console.error('Render error', e);
      app.appendChild(h('div.card', {}, 'Something went wrong rendering this screen. ' + e.message));
    }
    GT.chrome && GT.chrome.update(route);
  }

  window.addEventListener('hashchange', render);

  GT.h = h;
  GT.clear = clear;
  GT.escapeHtml = escapeHtml;
  GT.formatDate = formatDate;
  GT.hashPassword = hashPassword;
  GT.verifyPassword = verifyPassword;
  GT.THEMES = [
    { id: 'green', name: 'Fairway Green', swatch: '#0b6e4f' },
    { id: 'ocean', name: 'Ocean Blue', swatch: '#1565a8' },
    { id: 'sunset', name: 'Sunset Orange', swatch: '#c4561d' },
    { id: 'berry', name: 'Berry', swatch: '#8e2d6b' },
    { id: 'slate', name: 'Slate', swatch: '#37474f' },
    { id: 'claret', name: 'Claret', swatch: '#7b1e2b' }
  ];
  GT.applyTheme = function (theme) {
    var id = (theme && GT.THEMES.some(function (t) { return t.id === theme; })) ? theme : 'green';
    var root = document.documentElement;
    if (id === 'green') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', id);
    var meta = document.querySelector('meta[name="theme-color"]');
    var sw = GT.THEMES.filter(function (t) { return t.id === id; })[0];
    if (meta && sw) meta.setAttribute('content', sw.swatch);
  };
  GT.toast = toast;
  GT.modal = modal;
  GT.confirm = confirm;
  GT.state = {
    get: function () { return state; },
    load: loadSession, save: saveSession, setRole: setRole, setPlayer: setPlayer,
    setTournament: setTournament, logout: logout, isAdmin: isAdmin, isViewer: isViewer,
    currentPlayer: currentPlayer
  };
  GT.router = { register: register, go: go, render: render, parseHash: parseHash };
})(window.GT = window.GT || {});
