/* ══════════════════════════════════════════════════════════════
   config.js — which backend to talk to.

   Its own Firebase project, `critical-force-test`. Nothing here is
   shared with the Coach app: separate project, separate database,
   separate rules, separate accounts. The only thing joining the two
   is a JSON file that a person uploads by hand, which is a seam you
   can see rather than one you have to trust.

   These values are not secret. A Firebase web config identifies a
   project; it does not authorise anything. What may be written is
   decided by firestore.rules.

   Blank the apiKey and the app still runs — the test works and
   results download as files. That is the fallback path, not a broken
   one.
   ══════════════════════════════════════════════════════════════ */
export const CONFIG = {
  firebase: {
    apiKey: 'AIzaSyDp8j6dM6Ezfu2SF2AqS2W1nyOrSpXUNx8',
    authDomain: 'critical-force-test.firebaseapp.com',
    projectId: 'critical-force-test',
    storageBucket: 'critical-force-test.firebasestorage.app',
    messagingSenderId: '947087350997',
    appId: '1:947087350997:web:1c19928c2c13d76d3b565c'
  },

  useEmulators: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
                && new URLSearchParams(location.search).has('emulate'),

  /* Pinned. An unpinned SDK is a dependency someone else can change
     under you, between one session at the board and the next. */
  sdkVersion: '10.14.1'
};

CONFIG.live = !!CONFIG.firebase.apiKey || CONFIG.useEmulators;
