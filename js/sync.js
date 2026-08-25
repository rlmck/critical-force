/* ═══════════════════════════════════════════════════════════════
   sync.js — filing a finished test on an athlete's record.

   The device used to write a JSON file that somebody renamed by hand
   and uploaded in Coach. This does that trip in one step, into the
   same Firestore document Coach's uploader would have produced —
   because it goes through Coach's own parser to get there. See
   vendor/cftest.js: nothing in this file reads a force.

   Who may write is not this file's decision. firestore.rules in the
   Coach repo says a critical-force test is written by the coach and
   nobody else, on the grounds that the load cell is the coach's. So
   there is a sign-in here, and no way to skip it — an unauthorised
   write is refused by the server, not by politeness in the client.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const CT = (window.CT = window.CT || {});

  const sync = CT.sync = {
    available: false,   /* is there a backend configured at all */
    /* undefined means "not settled yet", which is a different thing
       from null. A listener registered before init() finishes must not
       be told there is no backend — it would render "no backend" for
       as long as the SDK takes to load, on every single page open. */
    user: undefined,
    _listeners: []
  };

  /* Firestore rejects undefined outright. Verbatim from Coach's
     repo.js so a document written here and one written there are the
     same document. */
  function clean(obj) {
    const out = {};
    Object.keys(obj).forEach(k => {
      const v = obj[k];
      if (v === undefined) return;
      out[k] = (v && typeof v === 'object' && !Array.isArray(v) && v.constructor === Object)
        ? clean(v) : v;
    });
    return out;
  }

  sync.onUser = function (fn) { sync._listeners.push(fn); if (sync.user !== undefined) fn(sync.user); };
  function announce() { sync._listeners.forEach(fn => fn(sync.user)); }

  /* ── starting up ────────────────────────────────────────────
     Never throws. A capture tool that refuses to open because a CDN
     is unreachable is worse than one that can't file: the test still
     runs, and still downloads. */
  sync.init = async function () {
    sync.available = !!(CT.CONFIG && CT.CONFIG.live);
    if (!sync.available) { sync.user = null; announce(); return false; }
    try {
      const fb = await CT.fb.init();
      fb.fn.onAuthStateChanged(fb.auth, u => { sync.user = u || null; announce(); });
      return true;
    } catch (err) {
      console.warn('[sync] backend unavailable:', err && err.message);
      sync.available = false;
      sync.user = null;
      announce();
      return false;
    }
  };

  sync.signIn = async function (email, password) {
    const fb = await CT.fb.init();
    await fb.fn.signIn(fb.auth, String(email || '').trim(), password);
  };

  sync.signOut = async function () {
    const fb = await CT.fb.init();
    await fb.fn.signOut(fb.auth);
  };

  /* ── the roster ─────────────────────────────────────────────
     Membership is what Coach queries on, so this asks the same
     question — then keeps only the athletes this account actually
     coaches. A coach is a member of their own record too, and a test
     filed against it would be refused: coachId is what the write rule
     compares against, so anything this list shows must already
     satisfy it. Better an athlete missing from a picker than a
     permission error after a 4-minute test. */
  sync.roster = async function () {
    const fb = await CT.fb.init();
    const { collection, query, where, getDocs } = fb.fn;
    const q = query(collection(fb.db, 'athletes'), where('members', 'array-contains', sync.user.uid));
    const snap = await getDocs(q);
    return snap.docs
      .map(d => Object.assign({ id: d.id }, d.data()))
      .filter(a => a.coachId === sync.user.uid)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  };

  /* ── filing a test ──────────────────────────────────────────
     The id is the date and the grip rather than a random string, and
     that is doing real work:

       · A test is two files. Running the left hand and then the right
         has to produce one document with two hands in it, not two
         documents with one hand each.
       · Re-running a grip because the first attempt was a mess should
         correct the record rather than double it — which is the rule
         Coach's uploader already follows, keyed the same way.

     Coach reads the document id straight off the snapshot, so the
     shape of the id is ours to choose. Existing tests uploaded as
     files carry random ids; a re-test of one of those dates writes
     alongside rather than over it, which is the one seam here.  */
  sync.fileTest = async function (opts) {
    const fb = await CT.fb.init();
    const { doc, getDoc, setDoc } = fb.fn;

    /* Coach's parser, unmodified, is what turns the export into a
       record. If this throws, the export is not what Coach reads and
       the fault is upstream of the write. */
    const parsed = CT.cf.parse(opts.filename, opts.json);
    const hand = parsed.hand || 'right';
    const id = `${parsed.date}_${parsed.grip}`;
    const ref = doc(fb.db, 'athletes', opts.athleteId, 'criticalForce', id);

    const snap = await getDoc(ref);
    const prev = snap.exists() ? snap.data() : {};

    const body = {
      date: parsed.date,
      grip: parsed.grip,
      gripGuessed: false,   /* picked from a list here, never guessed from a filename */
      /* The athlete is whoever the picker said. The name parsed out of
         the filename is the device's guess at the same thing and loses
         to the roster every time. */
      athlete: opts.athleteName || parsed.athlete || null,
      bodyweight: parsed.bodyweight != null ? parsed.bodyweight
                : (prev.bodyweight != null ? prev.bodyweight : null),
      hands:  Object.assign({}, prev.hands  || {}, { [hand]: parsed.hand_ }),
      source: Object.assign({}, prev.source || {}, { [hand]: parsed.file })
    };

    await setDoc(ref, clean(body));
    return { id, hand, date: parsed.date, grip: parsed.grip, both: !!(body.hands.left && body.hands.right) };
  };
})();
