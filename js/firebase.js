/* ═══════════════════════════════════════════════════════════════
   firebase.js — the SDK, and nothing else.

   A trimmed cousin of Coach's file of the same name: same pinned
   dynamic import from gstatic, same CT.fb surface, but only the
   handful of calls this app makes. A capture tool signs one coach in
   and writes one document; it does not need batches, listeners or
   an offline cache.

   Loaded as a classic script so index.html's existing module keeps
   working untouched — no bundler, no module graph, no build step.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const CT = window.CT;

  const fb = CT.fb = { ready: false, app: null, auth: null, db: null, fn: {} };

  fb.init = async function () {
    if (fb.ready) return fb;

    const base = `https://www.gstatic.com/firebasejs/${CT.CONFIG.sdkVersion}`;
    const [A, U, F] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-firestore.js`)
    ]);

    fb.app = A.initializeApp(CT.CONFIG.firebase);
    fb.db  = F.getFirestore(fb.app);

    fb.auth = U.initializeAuth(fb.app, {
      persistence: [U.indexedDBLocalPersistence, U.browserLocalPersistence]
    });

    if (CT.CONFIG.useEmulators) {
      U.connectAuthEmulator(fb.auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      F.connectFirestoreEmulator(fb.db, '127.0.0.1', 8080);
    }

    fb.fn = {
      onAuthStateChanged: U.onAuthStateChanged,
      signIn: U.signInWithEmailAndPassword,
      signOut: U.signOut,
      collection: F.collection, doc: F.doc,
      getDoc: F.getDoc, getDocs: F.getDocs, setDoc: F.setDoc,
      query: F.query, where: F.where
    };

    fb.ready = true;
    return fb;
  };

  /* Firebase's error codes are for machines. These are for someone
     standing at a board with a scale in one hand. */
  fb.message = function (err) {
    const code = (err && err.code) || '';
    const map = {
      'auth/invalid-email':          'That doesn’t look like an email address.',
      'auth/invalid-credential':     'Email or password not recognised.',
      'auth/wrong-password':         'Email or password not recognised.',
      'auth/user-not-found':         'Email or password not recognised.',
      'auth/too-many-requests':      'Too many attempts. Wait a minute and try again.',
      'auth/network-request-failed': 'No connection — the test still runs, and still downloads.',
      'permission-denied':           'Only a coach can file a critical-force test, and this account isn’t the coach on that athlete’s record.',
      'unavailable':                 'No connection. The test downloaded instead — upload it in Coach.'
    };
    return map[code] || (err && err.message) || 'Something went wrong.';
  };
})();
