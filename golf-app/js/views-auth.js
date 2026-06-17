/*
 * views-auth.js — Landing + accounts for the multi-tournament app.
 *
 *  Players  : open sign-up, one global account; sign in with username/password,
 *             then pick which tournament to enter (join others by code).
 *  Organisers: create a tournament (setting its own admin + join codes) or sign
 *             in to one they run with its admin code.
 *  Viewers  : no login — pick a tournament and see its leaderboard read-only.
 */
(function (GT) {
  'use strict';
  var h = GT.h, db = GT.db;

  function tournamentSelect() {
    var ts = db.getTournaments();
    return h('select', {}, ts.map(function (t) { return h('option', { value: t.id }, t.name); }));
  }

  // ---- Landing ----------------------------------------------------------
  GT.router.register('login', function (app) {
    var mode = 'player'; // 'player' | 'org' | 'view'
    var panel = h('div.stack');

    function focusFirst() { setTimeout(function () { var i = panel.querySelector('input,select'); if (i) i.focus(); }, 40); }

    function render() {
      GT.clear(panel);
      panel.appendChild(h('div.tabs', {}, [
        h('button' + (mode === 'player' ? '.active' : ''), { onclick: function () { mode = 'player'; render(); } }, 'Player'),
        h('button' + (mode === 'org' ? '.active' : ''), { onclick: function () { mode = 'org'; render(); } }, 'Organiser'),
        h('button' + (mode === 'view' ? '.active' : ''), { onclick: function () { mode = 'view'; render(); } }, 'View')
      ]));

      if (mode === 'player') renderPlayer();
      else if (mode === 'org') renderOrg();
      else renderView();

      if (!db.getTournaments().length) {
        panel.appendChild(h('button.btn.btn-ghost.btn-sm', {
          onclick: function () { var t = GT.seedDemo(); GT.state.setRole('admin'); GT.state.setTournament(t.id); GT.router.go('admin'); }
        }, '✨ Load demo tournament'));
      }
      focusFirst();
    }

    function renderPlayer() {
      var uname = h('input', { type: 'text', placeholder: 'Username', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false',
        onkeydown: function (e) { if (e.key === 'Enter') pword.focus(); } });
      var pword = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password',
        onkeydown: function (e) { if (e.key === 'Enter') signin(); } });
      function signin() {
        var u = uname.value.trim();
        if (!u || !pword.value) { GT.toast('Enter your username and password.', 'error'); return; }
        var p = db.findPlayerByUsername(u);
        if (!p || !GT.verifyPassword(pword.value, p.passwordHash)) { GT.toast('Incorrect username or password.', 'error'); pword.value = ''; pword.focus(); return; }
        GT.state.setRole('player'); GT.state.setPlayer(p.id);
        GT.toast('Welcome back, ' + p.fullName.split(' ')[0] + '!', 'success');
        GT.router.go('tournaments');
      }
      panel.appendChild(h('div.card.stack', {}, [
        h('div.field', {}, [h('label', {}, 'Username'), uname]),
        h('div.field', {}, [h('label', {}, 'Password'), pword]),
        h('button.btn.btn-primary.btn-block', { onclick: signin }, 'Sign in'),
        h('div.spread', { style: { marginTop: '2px' } }, [
          h('span.muted', { style: { fontSize: '.85rem' } }, 'New here?'),
          h('button.btn.btn-ghost.btn-sm', { onclick: function () { GT.router.go('register'); } }, 'Create an account »')
        ])
      ]));
    }

    function renderOrg() {
      var ts = db.getTournaments();
      var card = h('div.card.stack');
      if (ts.length) {
        var sel = tournamentSelect();
        var code = h('input', { type: 'password', placeholder: 'Admin code', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
          onkeydown: function (e) { if (e.key === 'Enter') signin(); } });
        function signin() {
          var t = db.getTournamentById(sel.value);
          if (!t) { GT.toast('Pick a tournament.', 'error'); return; }
          if (!t.adminCode || code.value.trim() !== t.adminCode) { GT.toast('Incorrect admin code for ' + t.name + '.', 'error'); code.value = ''; code.focus(); return; }
          GT.state.setRole('admin'); GT.state.setTournament(t.id);
          GT.toast('Managing ' + t.name, 'success'); GT.router.go('admin');
        }
        card.appendChild(h('div.field', {}, [h('label', {}, 'Manage a tournament'), sel]));
        card.appendChild(h('div.field', {}, [h('label', {}, 'Admin code'), code]));
        card.appendChild(h('button.btn.btn-primary.btn-block', { onclick: signin }, 'Sign in as Organiser'));
        card.appendChild(h('hr.divider'));
      }
      card.appendChild(h('button.btn.btn-outline.btn-block', { onclick: function () { GT.router.go('createtournament'); } }, '+ Create a new tournament'));
      panel.appendChild(card);
    }

    function renderView() {
      var ts = db.getTournaments();
      if (!ts.length) { panel.appendChild(h('div.card', {}, h('div.empty', {}, [h('span.ic', {}, '🏆'), 'No tournaments yet.']))); return; }
      var sel = tournamentSelect();
      panel.appendChild(h('div.card.stack', {}, [
        h('div.field', {}, [h('label', {}, 'View a leaderboard (no login)'), sel]),
        h('button.btn.btn-primary.btn-block', {
          onclick: function () { GT.state.setRole('viewer'); GT.state.setTournament(sel.value); GT.router.go('leaderboard'); }
        }, 'View leaderboard')
      ]));
    }

    app.appendChild(h('div.login-wrap', {}, [
      h('div.login-logo', {}, '⛳'),
      h('h1', {}, 'Golf Tournaments'),
      h('p.tag', {}, 'Scoring · Handicaps · Leaderboards'),
      panel
    ]));
    render();
  });

  // ---- Create a tournament (organiser) ---------------------------------
  GT.router.register('createtournament', function (app) {
    app.appendChild(h('h1.page-title', {}, 'Create a Tournament'));
    app.appendChild(h('p.page-sub', {}, 'You’ll be its organiser. Share the join code with players; keep the admin code to yourself.'));
    var f = {
      name: h('input', { type: 'text', placeholder: 'e.g. Marbella Golf Week 2026' }),
      numRounds: h('input', { type: 'number', min: '1', value: '4' }),
      joinCode: h('input', { type: 'text', placeholder: 'e.g. MARBELLA26', autocapitalize: 'off', spellcheck: 'false' }),
      adminCode: h('input', { type: 'text', placeholder: 'a secret only you know', autocapitalize: 'off', spellcheck: 'false' })
    };
    function create() {
      var name = f.name.value.trim();
      var nr = parseInt(f.numRounds.value, 10);
      var jc = f.joinCode.value.trim();
      var ac = f.adminCode.value.trim();
      if (!name) { GT.toast('Tournament name is required.', 'error'); return; }
      if (!nr || nr < 1) { GT.toast('Number of rounds must be at least 1.', 'error'); return; }
      if (!jc || !ac) { GT.toast('Both a join code and an admin code are required.', 'error'); return; }
      if (jc.toLowerCase() === ac.toLowerCase()) { GT.toast('Join code and admin code must be different.', 'error'); return; }
      if (db.findTournamentByJoinCode(jc)) { GT.toast('That join code is already in use — pick another.', 'error'); return; }
      var t = db.createTournament({ name: name, numRounds: nr, joinCode: jc, adminCode: ac });
      GT.state.setRole('admin'); GT.state.setTournament(t.id);
      GT.toast('Tournament created', 'success');
      GT.router.go('admin');
    }
    app.appendChild(h('div.card.stack', {}, [
      h('div.field', {}, [h('label', {}, 'Tournament Name'), f.name]),
      h('div.field', {}, [h('label', {}, 'Number of Rounds'), f.numRounds]),
      h('div.field', {}, [h('label', {}, 'Join Code (for players)'), f.joinCode, h('div.hint', {}, 'Players enter this to join.')]),
      h('div.field', {}, [h('label', {}, 'Admin Code (for you)'), f.adminCode, h('div.hint', {}, 'Used to manage this tournament.')]),
      h('button.btn.btn-primary.btn-block', { onclick: create }, 'Create Tournament')
    ]));
    app.appendChild(h('button.btn.btn-ghost.btn-block', { onclick: function () { GT.router.go('login'); } }, '« Back'));
  });

  // ---- Player tournament picker / join ---------------------------------
  GT.router.register('tournaments', function (app) {
    var player = GT.state.currentPlayer();
    if (!player) { GT.router.go('login'); return; }
    app.appendChild(h('h1.page-title', {}, 'Your Tournaments'));

    var mine = db.getPlayerTournaments(player.id);
    if (mine.length) {
      var list = h('div.stack');
      mine.forEach(function (t) {
        list.appendChild(h('div.card.tap.card-row', { onclick: function () { GT.state.setTournament(t.id); GT.router.go('home'); } }, [
          h('div.grow', {}, [h('h3', {}, t.name), h('div.muted', {}, t.numRounds + ' rounds')]),
          h('span', {}, '→')
        ]));
      });
      app.appendChild(list);
    } else {
      app.appendChild(GT.emptyState('⛳', 'You haven’t joined any tournaments', 'Enter a join code below to get started.'));
    }

    var code = h('input', { type: 'text', placeholder: 'Join code', autocapitalize: 'off', spellcheck: 'false',
      onkeydown: function (e) { if (e.key === 'Enter') join(); } });
    function join() {
      var v = code.value.trim();
      if (!v) { GT.toast('Enter a join code.', 'error'); return; }
      var res = db.joinTournamentByCode(v, player.id);
      if (res.ok) { GT.toast('Joined ' + res.tournament.name, 'success'); GT.state.setTournament(res.tournament.id); GT.router.go('home'); }
      else if (res.reason === 'blocked') { GT.toast('Your access to that tournament has been blocked.', 'error'); }
      else { GT.toast('No tournament found with that join code.', 'error'); }
    }
    app.appendChild(h('div.card.stack', { style: { marginTop: '10px' } }, [
      h('div.field', {}, [h('label', {}, 'Join a tournament'), code, h('div.hint', {}, 'Ask the organiser for the join code.')]),
      h('button.btn.btn-primary.btn-block', { onclick: join }, 'Join')
    ]));

    app.appendChild(h('button.btn.btn-ghost.btn-block', { onclick: function () { GT.state.logout(); } }, 'Sign out'));
  });

  // ---- Registration form (shared by register + edit profile + admin) ----
  function registrationForm(app, opts) {
    opts = opts || {};
    var existing = opts.player || null;
    var f = {
      fullName: h('input', { type: 'text', value: existing ? existing.fullName : '', placeholder: 'e.g. Rory McIlroy' }),
      handicapIndex: h('input', { type: 'number', step: '0.1', inputmode: 'decimal',
        value: existing && existing.handicapIndex != null ? existing.handicapIndex : '', placeholder: 'e.g. 12.4' }),
      cdhId: h('input', { type: 'text', value: existing ? existing.cdhId : '', placeholder: 'Handicap certificate ID' }),
      username: h('input', { type: 'text', value: existing ? (existing.username || '') : '', placeholder: 'Choose a username', autocapitalize: 'off', spellcheck: 'false', autocomplete: 'username' }),
      password: h('input', { type: 'password', placeholder: existing ? 'Leave blank to keep current' : 'Choose a password', autocomplete: 'new-password' })
    };

    function submit() {
      var name = f.fullName.value.trim();
      var hi = f.handicapIndex.value === '' ? null : parseFloat(f.handicapIndex.value);
      var cdh = f.cdhId.value.trim();
      var username = f.username.value.trim();
      var pw = f.password.value;
      if (!name) { GT.toast('Full name is required.', 'error'); return; }
      if (hi == null || isNaN(hi)) { GT.toast('Enter a valid Handicap Index.', 'error'); return; }
      if (!username) { GT.toast('A username is required for login.', 'error'); return; }
      if (/\s/.test(username)) { GT.toast('Usernames can’t contain spaces.', 'error'); return; }
      if (db.findDuplicateUsername(username, existing ? existing.id : null)) { GT.toast('That username is already taken.', 'error'); return; }
      if (!existing && (!pw || pw.length < 4)) { GT.toast('Choose a password of at least 4 characters.', 'error'); return; }
      if (existing && pw && pw.length < 4) { GT.toast('New password must be at least 4 characters.', 'error'); return; }

      function finish() {
        var p;
        if (existing) {
          var patch = { fullName: name, handicapIndex: hi, cdhId: cdh, username: username };
          if (pw) patch.passwordHash = GT.hashPassword(pw);
          p = db.updatePlayer(existing.id, patch);
          if (opts.isAdmin) db.logAdmin('Edited player profile: ' + name + (pw ? ' (password reset)' : ''));
          GT.toast('Profile updated', 'success');
        } else {
          p = db.addPlayer({ fullName: name, handicapIndex: hi, cdhId: cdh, username: username, passwordHash: GT.hashPassword(pw) });
          GT.toast('Welcome, ' + name + '!', 'success');
        }
        if (opts.onSaved) opts.onSaved(p);
      }
      var dup = db.findDuplicateCdh(cdh, existing ? existing.id : null);
      if (dup) GT.confirm('CDH ID "' + cdh + '" is already used by ' + dup.fullName + '. Save anyway?', finish, { yesLabel: 'Save anyway' });
      else finish();
    }

    app.appendChild(h('div.card.stack', {}, [
      h('div.field', {}, [h('label', {}, 'Full Name'), f.fullName, h('div.hint', {}, 'Shown on scorecards and leaderboards.')]),
      h('div.field', {}, [h('label', {}, 'Handicap Index (WHS)'), f.handicapIndex, h('div.hint', {}, 'Your official portable handicap, e.g. 12.4.')]),
      h('div.field', {}, [h('label', {}, 'CDH ID'), f.cdhId, h('div.hint', {}, 'From your handicap certificate (optional).')]),
      h('hr.divider'),
      h('div.field', {}, [h('label', {}, 'Username'), f.username, h('div.hint', {}, 'Used with your password to sign in.')]),
      h('div.field', {}, [h('label', {}, existing ? 'New Password' : 'Password'), f.password, h('div.hint', {}, existing ? 'Leave blank to keep the current password.' : 'At least 4 characters.')]),
      h('button.btn.btn-primary.btn-block', { onclick: submit }, existing ? 'Save Changes' : 'Create Account')
    ]));
  }
  GT.registrationForm = registrationForm;

  GT.router.register('register', function (app) {
    app.appendChild(h('h1.page-title', {}, 'Create your account'));
    app.appendChild(h('p.page-sub', {}, 'One account works across every tournament. After this you’ll join a tournament with its code.'));
    registrationForm(app, { onSaved: function (p) { GT.state.setRole('player'); GT.state.setPlayer(p.id); GT.router.go('tournaments'); } });
    app.appendChild(h('button.btn.btn-ghost.btn-block', { onclick: function () { GT.router.go('login'); } }, '« Back to sign in'));
  });

  GT.router.register('profile', function (app) {
    var player = GT.state.currentPlayer();
    app.appendChild(h('h1.page-title', {}, player ? 'My Profile' : 'Create your account'));
    if (!player) { registrationForm(app, { onSaved: function (p) { GT.state.setRole('player'); GT.state.setPlayer(p.id); GT.router.go('tournaments'); } }); return; }
    registrationForm(app, { player: player, onSaved: function () { GT.router.go(GT.db.getActiveTournamentId() ? 'home' : 'tournaments'); } });
    app.appendChild(h('div.card', {}, [
      h('div.spread', {}, [
        h('div', {}, [h('div', { style: { fontWeight: 600 } }, 'Switch tournament or golfer'),
          h('div.muted', {}, 'Go to your tournaments, or sign out.')]),
        h('div.wrap', {}, [
          h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.router.go('tournaments'); } }, 'Tournaments'),
          h('button.btn.btn-ghost.btn-sm', { onclick: function () { GT.state.logout(); } }, 'Sign out')
        ])
      ])
    ]));
  });

  GT.fmtHi = function (hi) {
    if (hi == null || isNaN(hi)) return '—';
    return (Math.round(hi * 10) / 10).toFixed(1);
  };
})(window.GT = window.GT || {});
