/*
 * chrome.js — App bar + slide-out navigation drawer. Rebuilt on each route so
 * the menu reflects the current role (player vs admin) and highlights the
 * active screen. Attaches to GT.chrome.
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
    { name: 'players', icon: '👥', label: 'Player Management' },
    { name: 'scores', icon: '📝', label: 'Score Management' }
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
    var t = GT.db.getTournament();
    var isAdmin = GT.state.isAdmin();
    var player = GT.state.currentPlayer();

    drawer.appendChild(h('div.drawer-header', {}, [
      h('div.t-name', {}, t.name || 'Golf Tournament'),
      h('div.t-sub', {}, isAdmin ? 'Admin' : (player ? player.fullName : 'Player'))
    ]));

    var playerSection = h('div.drawer-section', {}, [h('div.label', {}, 'Play')]);
    PLAYER_NAV.forEach(function (item) { playerSection.appendChild(navLink(item, activeName)); });
    drawer.appendChild(playerSection);

    if (isAdmin) {
      var adminSection = h('div.drawer-section', {}, [h('div.label', {}, 'Admin')]);
      ADMIN_NAV.forEach(function (item) { adminSection.appendChild(navLink(item, activeName)); });
      drawer.appendChild(adminSection);
    }

    var footer = h('div.drawer-section', {}, [
      h('button.drawer-link', { onclick: function () { closeDrawer(); GT.state.logout(); } },
        [h('span.ic', {}, '⏻'), 'Sign out'])
    ]);
    drawer.appendChild(footer);
  }

  function update(route) {
    var appbar = document.getElementById('appbar');
    var loggedIn = !!GT.state.get().role;

    if (!loggedIn || route.name === 'login') {
      appbar.hidden = true;
      document.getElementById('drawer').hidden = true;
      document.getElementById('drawer-scrim').hidden = true;
      return;
    }
    appbar.hidden = false;
    var t = GT.db.getTournament();
    document.getElementById('appbar-title').textContent = t.name || 'Golf Tournament';
    buildDrawer(route.name);
  }

  function wire() {
    document.getElementById('nav-toggle').addEventListener('click', openDrawer);
    document.getElementById('drawer-scrim').addEventListener('click', closeDrawer);
    document.getElementById('appbar-logout').addEventListener('click', function () {
      GT.state.logout();
    });
  }

  GT.chrome = { update: update, wire: wire, closeDrawer: closeDrawer };
})(window.GT = window.GT || {});
