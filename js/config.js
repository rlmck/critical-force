/* ═══════════════════════════════════════════════════════════════
   config.js — which backend to talk to.

   The same project Coach uses, and the same values: a Firebase web
   config identifies a project, it does not authorise anything. What
   may be written here is decided by firestore.rules in the Coach
   repo, which is the file worth reading and this one isn't.

   Blank the apiKey and the tools still run — they just don't file
   anything. The test works, the timer works, and a finished test
   downloads as JSON exactly as it always did. That is the fallback
   path, not a broken one.

   To fill it in:
     Firebase console → Project settings → Your apps → Web app → Config
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const CT = (window.CT = window.CT || {});

  CT.CONFIG = {
    firebase: {
      apiKey: 'AIzaSyBbV8Hkg2GPcNwAoGCrOYoqRcks6JPzTfY',
      authDomain: 'coach-climbing-app.firebaseapp.com',
      projectId: 'coach-climbing-app',
      storageBucket: 'coach-climbing-app.firebasestorage.app',
      messagingSenderId: '305441257210',
      appId: '1:305441257210:web:93d52cb004f20d75b8bb43'
    },

    useEmulators: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
                  && new URLSearchParams(location.search).has('emulate'),

    /* Pinned, for the reason Coach pins it: an unpinned SDK is a
       dependency someone else can change under you. Keep in step with
       Coach's js/config.js so both apps speak to Firestore the same way. */
    sdkVersion: '10.14.1'
  };

  CT.CONFIG.live = !!CT.CONFIG.firebase.apiKey || CT.CONFIG.useEmulators;
})();
