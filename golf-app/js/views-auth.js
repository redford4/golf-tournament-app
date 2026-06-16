/*
 * views-auth.js — Login and registration.
 *
 * Players sign in with a username + password they choose at registration.
 * New players join via the shared player access code (the gate), then create
 * their profile and credentials. Admins sign in with the admin access code.
 * The admin can change any player's username and password from Player Management.
 */
(function (GT) {
  'use strict';
  var h = GT.h, db = GT.db;

  function isFresh() {
    return db.getPlayers().length === 0 &&
      db.getRounds().every(function (r) { return !r.configured; });
  }

  // ---- Login -----------------------------------------------------------
  GT.router.register('login', function (app) {
    var t = db.getTournament();
    var mode = 'signin'; // 'signin' | 'register' | 'admin'
    var panel = h('div.stack');

    function focusFirst() {
      setTimeout(function () { var i = panel.querySelector('input'); if (i) i.focus(); }, 40);
    }

    function render() {
      GT.clear(panel);

      // Player / Admin segmented control
      panel.appendChild(h('div.tabs', {}, [
        h('button' + (mode !== 'admin' ? '.active' : ''), { onclick: function () { mode = 'signin'; render(); focusFirst(); } }, 'Player'),
        h('button' + (mode === 'admin' ? '.active' : ''), { onclick: function () { mode = 'admin'; render(); focusFirst(); } }, 'Admin')
      ]));

      if (mode === 'admin') {
        var adminCode = h('input', { type: 'password', placeholder: 'Admin access code', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
          onkeydown: function (e) { if (e.key === 'Enter') adminSignin(); } });
        function adminSignin() {
          if (adminCode.value.trim() === t.adminCode) {
            GT.state.setRole('admin'); GT.toast('Signed in as Admin', 'success'); GT.router.go('admin');
          } else { GT.toast('Incorrect admin code.', 'error'); adminCode.value = ''; adminCode.focus(); }
        }
        panel.appendChild(h('div.card.stack', {}, [
          h('div.field', {}, [h('label', {}, 'Admin access code'), adminCode,
            h('div.hint', {}, 'The organiser’s code for tournament setup and management.')]),
          h('button.btn.btn-primary.btn-block', { onclick: adminSignin }, 'Sign in as Admin')
        ]));

      } else if (mode === 'register') {
        var code = h('input', { type: 'password', placeholder: 'Player access code', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
          onkeydown: function (e) { if (e.key === 'Enter') joinNext(); } });
        function joinNext() {
          if (code.value.trim() !== t.playerCode) { GT.toast('Incorrect player access code.', 'error'); code.value = ''; code.focus(); return; }
          GT.state.setRole('player');
          GT.router.go('register');
        }
        panel.appendChild(h('div.card.stack', {}, [
          h('div.field', {}, [h('label', {}, 'Player access code'), code,
            h('div.hint', {}, 'Ask your organiser for this. You’ll set up your own login next.')]),
          h('button.btn.btn-primary.btn-block', { onclick: joinNext }, 'Continue'),
          h('button.btn.btn-ghost.btn-block', { onclick: function () { mode = 'signin'; render(); focusFirst(); } }, '« Back to sign in')
        ]));

      } else { // signin
        var uname = h('input', { type: 'text', placeholder: 'Username', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false',
          onkeydown: function (e) { if (e.key === 'Enter') { pword.focus(); } } });
        var pword = h('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password',
          onkeydown: function (e) { if (e.key === 'Enter') signin(); } });
        function signin() {
          var u = uname.value.trim();
          if (!u || !pword.value) { GT.toast('Enter your username and password.', 'error'); return; }
          var p = db.findPlayerByUsername(u);
          if (!p || !GT.verifyPassword(pword.value, p.passwordHash)) {
            GT.toast('Incorrect username or password.', 'error'); pword.value = ''; pword.focus(); return;
          }
          GT.state.setRole('player'); GT.state.setPlayer(p.id);
          GT.toast('Welcome back, ' + p.fullName.split(' ')[0] + '!', 'success');
          GT.router.go('home');
        }
        panel.appendChild(h('div.card.stack', {}, [
          h('div.field', {}, [h('label', {}, 'Username'), uname]),
          h('div.field', {}, [h('label', {}, 'Password'), pword]),
          h('button.btn.btn-primary.btn-block', { onclick: signin }, 'Sign in'),
          h('div.spread', { style: { marginTop: '2px' } }, [
            h('span.muted', { style: { fontSize: '.85rem' } }, 'New to the tournament?'),
            h('button.btn.btn-ghost.btn-sm', { onclick: function () { mode = 'register'; render(); focusFirst(); } }, 'Register »')
          ])
        ]));
      }

      if (isFresh()) {
        panel.appendChild(h('button.btn.btn-ghost.btn-sm', {
          onclick: function () { GT.seedDemo(); GT.state.setRole('admin'); GT.router.go('admin'); }
        }, '✨ Load demo tournament'));
      }
    }

    app.appendChild(h('div.login-wrap', {}, [
      h('div.login-logo', {}, '⛳'),
      h('h1', {}, t.name || 'Golf Tournament'),
      h('p.tag', {}, 'Scoring · Handicaps · Leaderboards'),
      panel
    ]));
    render();
    focusFirst();
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
      var dupUser = db.findDuplicateUsername(username, existing ? existing.id : null);
      if (dupUser) { GT.toast('That username is already taken.', 'error'); return; }
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

      // Duplicate CDH warning (PRD 4.2) — warn, don't block.
      var dup = db.findDuplicateCdh(cdh, existing ? existing.id : null);
      if (dup) {
        GT.confirm('CDH ID "' + cdh + '" is already used by ' + dup.fullName + '. Save anyway?', finish, { yesLabel: 'Save anyway' });
      } else {
        finish();
      }
    }

    var card = h('div.card.stack', {}, [
      h('div.field', {}, [h('label', {}, 'Full Name'), f.fullName,
        h('div.hint', {}, 'Shown on scorecards and leaderboards.')]),
      h('div.field', {}, [h('label', {}, 'Handicap Index (WHS)'), f.handicapIndex,
        h('div.hint', {}, 'Your official portable handicap, e.g. 12.4.')]),
      h('div.field', {}, [h('label', {}, 'CDH ID'), f.cdhId,
        h('div.hint', {}, 'Central Database of Handicaps ID from your certificate (optional).')]),
      h('hr.divider'),
      h('div.field', {}, [h('label', {}, 'Username'), f.username,
        h('div.hint', {}, 'Used with your password to sign in.')]),
      h('div.field', {}, [h('label', {}, existing ? 'New Password' : 'Password'), f.password,
        h('div.hint', {}, existing ? 'Leave blank to keep the current password.' : 'At least 4 characters.')]),
      h('button.btn.btn-primary.btn-block', { onclick: submit },
        existing ? 'Save Changes' : 'Register & Continue')
    ]);
    app.appendChild(card);
  }
  GT.registrationForm = registrationForm;

  // ---- New player registration -----------------------------------------
  GT.router.register('register', function (app) {
    app.appendChild(h('h1.page-title', {}, 'Create your profile'));
    app.appendChild(h('p.page-sub', {}, 'Register once for the whole tournament. Your username and password let you sign in on any device.'));
    registrationForm(app, {
      onSaved: function (p) { GT.state.setPlayer(p.id); GT.router.go('home'); }
    });
  });

  // ---- My profile (player edits self) ----------------------------------
  GT.router.register('profile', function (app) {
    var player = GT.state.currentPlayer();
    app.appendChild(h('h1.page-title', {}, player ? 'My Profile' : 'Create your profile'));
    if (!player) {
      app.appendChild(h('p.page-sub', {}, 'Set up your golfer profile to start scoring.'));
      registrationForm(app, { onSaved: function (p) { GT.state.setPlayer(p.id); GT.router.go('home'); } });
      return;
    }
    registrationForm(app, {
      player: player,
      onSaved: function () { GT.router.go('home'); }
    });
    app.appendChild(h('div.card', {}, [
      h('div.spread', {}, [
        h('div', {}, [h('div', { style: { fontWeight: 600 } }, 'Not you?'),
          h('div.muted', {}, 'Sign out to switch to a different golfer.')]),
        h('button.btn.btn-outline.btn-sm', { onclick: function () { GT.state.logout(); } }, 'Sign out')
      ])
    ]));
  });

  // Small shared formatter for handicap index display.
  GT.fmtHi = function (hi) {
    if (hi == null || isNaN(hi)) return '—';
    return (Math.round(hi * 10) / 10).toFixed(1);
  };
})(window.GT = window.GT || {});
