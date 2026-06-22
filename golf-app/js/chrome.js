/*
 * chrome.js — App bar + slide-out navigation drawer. Rebuilt on each route so
 * the menu reflects the current role (player / organiser / viewer) and the
 * active tournament. Attaches to GT.chrome.
 */
(function (GT) {
  'use strict';
  var h = GT.h;

  var PLAYER_NAV = [
    { name: 'home', icon: '⛳', label: 'Tournament Home' },
    { name: 'profile', icon: '👤', label: 'My Profile' },
    { name: 'handicaps', icon: '🎯', label: 'My Handicaps' },
    { name: 'leaderboard', icon: '🏆', label: 'Leaderboards' }
  ];
  var ADMIN_NAV = [
    { name: 'admin', icon: '🛠', label: 'Admin Dashboard' },
    { name: 'setup', icon: '⚙', label: 'Tournament Setup' },
    { name: 'courses', icon: '🗺', label: 'Course Configuration' },
    { name: 'members', icon: '👥', label: 'Member Management' },
    { name: 'scores', icon: '📝', label: 'Score Management' },
    { name: 'leaderboard', icon: '🏆', label: 'Leaderboards' }
  ];

  function openDrawer() {
    document.getElementById('drawer').classList.add('open');
    document.getElementById('drawer').hidden = false;
    document.getElementById('drawer-scrim').hidden = false;
  }
  function closeDrawer() {
    document.getElementById('drawer').classList.remove('open');
    document.getElementById('drawer-scrim').hidden = true;
  }

  function navLink(item, activeName) {
    return h('button.drawer-link' + (item.name === activeName ? '.active' : ''), {
      onclick: function () { closeDrawer(); GT.router.go(item.name); }
    }, [h('span.ic', {}, item.icon), item.label]);
  }

  function buildDrawer(activeName) {
    var drawer = GT.clear(document.getElementById('drawer'));
    var t = GT.db.getActiveTournament();
    var role = GT.state.get().role;
    var player = GT.state.currentPlayer();

    drawer.appendChild(h('div.drawer-header', {}, [
      h('div.t-name', {}, (t && t.name) || 'Golf Tournaments'),
      h('div.t-sub', {}, role === 'admin' ? 'Organiser' : role === 'viewer' ? 'Viewer (read-only)' : (player ? GT.displayName(player) : 'Player'))
    ]));

    if (role === 'viewer') {
      var vsec = h('div.drawer-section', {}, [h('div.label', {}, 'View')]);
      vsec.appendChild(navLink({ name: 'leaderboard', icon: '🏆', label: 'Leaderboards' }, activeName));
      drawer.appendChild(vsec);
      drawer.appendChild(h('div.drawer-section', {}, [
        h('button.drawer-link', { onclick: function () { closeDrawer(); GT.state.logout(); } }, [h('span.ic', {}, '🔁'), 'View another tournament'])
      ]));
      return;
    }

    if (role === 'admin') {
      var asec = h('div.drawer-section', {}, [h('div.label', {}, 'Organiser')]);
      ADMIN_NAV.forEach(function (item) { asec.appendChild(navLink(item, activeName)); });
      drawer.appendChild(asec);
      drawer.appendChild(h('div.drawer-section', {}, [
        h('button.drawer-link', { onclick: function () { closeDrawer(); GT.state.logout(); } }, [h('span.ic', {}, '⏻'), 'Sign out'])
      ]));
      return;
    }

    // player
    var psec = h('div.drawer-section', {}, [h('div.label', {}, 'Play')]);
    PLAYER_NAV.forEach(function (item) { psec.appendChild(navLink(item, activeName)); });
    drawer.appendChild(psec);
    drawer.appendChild(h('div.drawer-section', {}, [
      h('button.drawer-link', { onclick: function () { closeDrawer(); GT.router.go('tournaments'); } }, [h('span.ic', {}, '🔁'), 'Switch tournament']),
      h('button.drawer-link', { onclick: function () { closeDrawer(); GT.state.logout(); } }, [h('span.ic', {}, '⏻'), 'Sign out'])
    ]));
  }

  function update(route) {
    var appbar = document.getElementById('appbar');
    var loggedIn = !!GT.state.get().role;
    // Apply the active tournament's colour theme (default green when none).
    var at = GT.db.getActiveTournament();
    GT.applyTheme(at && at.theme);
    var noChrome = !loggedIn || route.name === 'login' || route.name === 'register' || route.name === 'createtournament';

    if (noChrome) {
      appbar.hidden = true;
      document.getElementById('drawer').hidden = true;
      document.getElementById('drawer-scrim').hidden = true;
      return;
    }
    appbar.hidden = false;
    var t = GT.db.getActiveTournament();
    document.getElementById('appbar-title').textContent = (t && t.name) || 'Golf Tournaments';
    buildDrawer(route.name);
  }

  function wire() {
    document.getElementById('nav-toggle').addEventListener('click', openDrawer);
    document.getElementById('drawer-scrim').addEventListener('click', closeDrawer);
    document.getElementById('appbar-logout').addEventListener('click', function () { GT.state.logout(); });
  }

  GT.chrome = { update: update, wire: wire, closeDrawer: closeDrawer };
})(window.GT = window.GT || {});
