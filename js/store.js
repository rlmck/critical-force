/* ══════════════════════════════════════════════════════════════
   store.js — where a test goes, and how it comes back.

   One collection, `tests`, one document per test. A test is read as
   one thing — headline, per-rep breakdown and raw trace together —
   so it is stored as one thing rather than split across collections
   that would then need joining back up.

   There is no sign-in to do. The app signs itself in anonymously so
   that firestore.rules has something to check other than "anybody",
   but nobody types anything and there is no account to forget. That
   identity lives in this browser; it is not a login and does not
   travel between devices. Every test is visible to every visitor —
   one shared space, as asked for.

   Nothing here throws at the caller for being offline. A test that
   cannot be filed is still downloaded, and the UI says which
   happened.
   ══════════════════════════════════════════════════════════════ */
import { CONFIG } from './config.js';
import { toDataset } from './results.js';

const COLLECTION = 'tests';

let fb = null;        /* the loaded SDK, once */
let loading = null;   /* in-flight load, so two callers share one */

export const store = {
  available: !!CONFIG.live,
  ready: false,
  error: null
};

/* ── the SDK ────────────────────────────────────────────────
   Loaded on demand rather than at page load. The scale, the timer
   and the beeps are the urgent part of this app; a chart library
   arriving a second later costs nothing, and a CDN that is slow
   should not hold up a test. */
async function connect() {
  if (fb) return fb;
  if (loading) return loading;

  loading = (async () => {
    const base = `https://www.gstatic.com/firebasejs/${CONFIG.sdkVersion}`;
    /* No auth module. There is no sign-in of any kind — see
       firestore.rules, where the shape of the document is the only
       thing standing between the collection and the open internet.
       Not loading the SDK at all is one less thing to go wrong and
       one less round trip before the first read. */
    const [A, F] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-firestore.js`)
    ]);

    const app = A.initializeApp(CONFIG.firebase);
    const db  = F.getFirestore(app);

    if (CONFIG.useEmulators) F.connectFirestoreEmulator(db, '127.0.0.1', 8080);

    fb = { app, db, F };
    store.ready = true;
    return fb;
  })().catch(err => {
    loading = null;
    store.error = err;
    /* Two different kinds of failure wear the same shape here. A
       dropped connection is worth trying again on the next screen; a
       project with no sign-in method enabled will fail identically
       every time, and retrying it just makes every visit to the
       history wait three seconds to be told the same thing. So a
       configuration fault closes the store for the session and the UI
       goes quiet about it. */
    if (PERMANENT.includes(err && err.code)) {
      store.available = false;
      store.fatal = err;
    }
    throw err;
  });

  return loading;
}

/* Failures that will repeat identically on every retry. A misconfigured
   project should be reported once, not re-attempted on every visit to
   the history. A dropped connection is not on this list, because that
   one is worth trying again. */
const PERMANENT = [
  'permission-denied',
  'auth/api-key-not-valid'
];

/* ── writing ────────────────────────────────────────────────
   The id is the test's own timestamp with the athlete, hand and
   grip: saving the same result twice corrects it rather than
   doubling it, which matters because the Save button is right next
   to a result somebody may well press again. */
function idFor(json) {
  const stamp = String(json.timestamp || '').replace(/[:.]/g, '-').slice(0, -5);
  const name  = String(json.name || 'unnamed').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${stamp}_${name}_${json.hand}_${json.grip}`;
}

export async function saveTest(json) {
  const { db, F } = await connect();
  const id = idFor(json);
  await F.setDoc(F.doc(db, COLLECTION, id), Object.assign({}, json, {
    savedAt: F.serverTimestamp()
  }));
  return id;
}

/* ── reading ────────────────────────────────────────────────
   Newest first, and capped. The history screen is for comparing a
   handful of tests, not for paging through every one ever recorded;
   each document carries its full raw trace, so an uncapped read is
   megabytes for a screen that shows four lines. */
export async function listTests(limitTo = 50) {
  const { db, F } = await connect();
  const q = F.query(
    F.collection(db, COLLECTION),
    F.orderBy('timestamp', 'desc'),
    F.limit(limitTo)
  );
  const snap = await F.getDocs(q);
  const out = [];
  snap.docs.forEach(d => {
    try {
      out.push(toDataset(Object.assign({ id: d.id }, d.data()), 'db'));
    } catch (err) {
      /* One malformed document should cost you that row, not the
         whole history screen. */
      console.warn('[store] skipping ' + d.id + ':', err.message);
    }
  });
  return out;
}

export async function deleteTest(id) {
  const { db, F } = await connect();
  await F.deleteDoc(F.doc(db, COLLECTION, id));
}

/* Human-readable versions of the codes the SDK raises. */
export function message(err) {
  const code = (err && err.code) || '';
  const map = {
    'permission-denied':   'The database refused that write — the rules rejected the shape of the test. Check firestore.rules is deployed.',
    'unavailable':         'No connection to the database.',
    'failed-precondition': 'The database has no index for that query yet.',
    'not-found':           'This Firebase project has no Firestore database yet.',
    'invalid-argument':    'The database refused that test as malformed.'
  };
  return map[code] || (err && err.message) || 'Something went wrong.';
}
