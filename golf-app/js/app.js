/*
 * app.js — Bootstrap: not-found route, demo seeding, service-worker
 * registration (when served over http), and first render.
 */
(function (GT) {
  'use strict';
  var h = GT.h, db = GT.db;

  GT.router.register('notfound', function (app) {
    app.appendChild(GT.emptyState('🧭', 'Page not found', 'That screen doesn’t exist.'));
    app.appendChild(h('button.btn.btn-primary.btn-block', { onclick: function () { GT.router.go(GT.state.isAdmin() ? 'admin' : 'home'); } }, 'Go home'));
  });

  // ---- Demo data --------------------------------------------------------
  GT.seedDemo = function () {
    db.resetTournament();
    db.updateTournament({ name: 'Marbella Golf Week 2026', numRounds: 4, playerCode: 'golf', adminCode: 'admin' });
    var rounds = db.getRounds();
    var parA = [4,4,5,3,4,4,3,5,4, 4,3,4,5,4,4,3,4,5];
    var siA  = [7,5,11,17,1,9,15,3,13, 8,18,2,12,6,10,16,4,14];
    var parB = [4,5,4,3,4,4,5,3,4, 4,4,3,5,4,3,4,4,5];
    var siB  = [5,9,1,15,7,3,11,17,13, 6,2,18,10,8,16,4,12,14];
    db.updateRound(rounds[0].id, { courseName: 'Las Brisas', date: '2026-06-15', teeColour: 'Yellow', numHoles: 18,
      courseRating: 72.1, slopeRating: 131, par: parA.slice(), strokeIndex: siA.slice(), yardage: new Array(18).fill(null), configured: true });
    db.updateRound(rounds[1].id, { courseName: 'Valderrama', date: '2026-06-16', teeColour: 'White', numHoles: 18,
      courseRating: 73.4, slopeRating: 142, par: parB.slice(), strokeIndex: siB.slice(), yardage: new Array(18).fill(null), configured: true });

    var people = [
      { fullName: 'Rory McIlroy', handicapIndex: 2.1, cdhId: 'IRL-1001', username: 'rory' },
      { fullName: 'Shane Lowry', handicapIndex: 5.4, cdhId: 'IRL-1002', username: 'shane' },
      { fullName: 'Scott Redford', handicapIndex: 14.2, cdhId: 'ENG-2050', username: 'scott' },
      { fullName: 'Tommy Fleetwood', handicapIndex: 8.7, cdhId: 'ENG-2051', username: 'tommy' },
      { fullName: 'Jon Rahm', handicapIndex: 3.3, cdhId: 'ESP-3001', username: 'jon' }
    ];
    // All demo players use the password "golf" so you can try player sign-in.
    var players = people.map(function (p) {
      p.passwordHash = GT.hashPassword('golf');
      return db.addPlayer(p);
    });

    // Round 1: hole-by-hole for everyone
    var r1 = db.getRound(rounds[0].id);
    players.forEach(function (p, idx) {
      var ch = GT.util.courseHcp(r1, p) || 0;
      var rec = db.blankScore(r1.id, p.id, 'A');
      for (var i = 0; i < 18; i++) {
        var par = parA[i];
        var shots = GT.golf.shotsReceived(ch, siA[i]);
        // simulate: net around par +/- skill
        var swing = [(-1),0,1,0,1,2,0,1][(i + idx) % 8];
        rec.holes[i] = Math.max(2, par + shots + swing - (idx === 0 ? 1 : 0));
      }
      db.saveScore(rec);
    });

    // Round 2: mix of modes, one incomplete
    var r2 = db.getRound(rounds[1].id);
    var rec2a = db.blankScore(r2.id, players[2].id, 'B'); rec2a.summaryGross = 91; rec2a.summaryStableford = 33; db.saveScore(rec2a);
    var rec2b = db.blankScore(r2.id, players[0].id, 'A');
    for (var j = 0; j < 14; j++) { rec2b.holes[j] = parB[j] + (j % 3 === 0 ? 1 : 0); } // incomplete (14 holes)
    db.saveScore(rec2b);
    var rec2c = db.blankScore(r2.id, players[1].id, 'B'); rec2c.summaryGross = 84; rec2c.summaryStableford = 38; db.saveScore(rec2c);

    GT.toast('Demo tournament loaded', 'success');
  };

  // ---- Service worker (no-op on file://) --------------------------------
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('service-worker.js').catch(function () { /* offline cache optional */ });
  }

  // ---- Start ------------------------------------------------------------
  function start() {
    GT.chrome.wire();
    function go() {
      if (!location.hash) location.hash = '#/login';
      GT.router.render();
    }

    if (GT.cloud && GT.cloud.enabled()) {
      // Shared cloud mode: load the tournament from Supabase, then keep it live.
      GT.cloud.bootstrap().then(function () {
        var pending = false;
        GT.cloud.subscribe(function () {
          // Debounce a burst of changes into a single refresh + re-render.
          if (pending) return;
          pending = true;
          setTimeout(function () {
            pending = false;
            GT.cloud.refresh().then(function () { GT.router.render(); });
          }, 250);
        });
        go();
      }).catch(function (e) {
        var msg = (e && (e.message || e.error_description)) || (e ? JSON.stringify(e) : 'unknown error');
        console.error('Cloud start failed:', msg, e);
        if (/schema cache|does not exist|PGRST205/i.test(msg)) {
          GT.toast('Database not set up yet — run supabase-schema.sql in Supabase. Using this device for now.', 'error');
        } else {
          GT.toast('Could not reach the cloud — using this device only.', 'error');
        }
        db.load();
        go();
      });
    } else {
      db.load();
      go();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window.GT = window.GT || {});
