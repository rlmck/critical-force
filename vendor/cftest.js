/* ═══════════════════════════════════════════════════════════════
   cftest.js — the critical-force device's export, turned into the
   shape the rest of the app reads.

   The device writes one file per hand, so a test is two files that
   have to find each other. It puts the athlete's name and the grip
   in the *filename* and nowhere else, which is why parsing is a
   guess the coach confirms rather than something done silently.

   Nothing here invents a number. Every headline value is the
   device's own; what this file adds is the bookkeeping the device
   leaves out — which reps the critical force was read off, and
   whether the device trusted them.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const CT = (window.CT = window.CT || {});
  /* Read late, not captured: this file loads before data.js so the
     mock world can be built through the same parser a real upload
     goes through, and CT.dt doesn't exist yet at load time. */
  const dt = () => CT.dt;

  const r2 = v => Math.round(v * 100) / 100;
  const r1 = v => Math.round(v * 10) / 10;

  /* The last N reps are what the device averages into a critical
     force. Named because it appears in the UI copy too. */
  const CF_WINDOW = 3;

  /* ── grips ──────────────────────────────────────────────────
     The app already has a grip vocabulary for max hangs, and the
     device's filenames use its own. Known tokens map onto CT.GRIPS;
     anything else survives as an id with a prettified label, so an
     unrecognised grip is still a grip and not a dropped file. */
  const GRIP_TOKENS = {
    half_crimp: 'half', halfcrimp: 'half', half: 'half', crimp: 'half',
    three_finger_drag: 'tfd', threefingerdrag: 'tfd', three_finger: 'tfd',
    '3f_drag': 'tfd', '3fdrag': 'tfd', drag: 'tfd', tfd: 'tfd',
    open_hand: 'open', openhand: 'open', open: 'open',
    full_crimp: 'full', fullcrimp: 'full',
    front_three: 'front3', front_3: 'front3'
  };
  const EXTRA_GRIPS = {
    open:   { id: 'open',   name: 'Open Hand',   short: 'Open hand' },
    full:   { id: 'full',   name: 'Full Crimp',  short: 'Full crimp' },
    front3: { id: 'front3', name: 'Front Three', short: 'Front three' }
  };

  function gripOf(id) {
    return CT.GRIPS.find(g => g.id === id) || EXTRA_GRIPS[id] || {
      id, short: prettify(id), name: prettify(id)
    };
  }
  function prettify(s) {
    return String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || 'Unknown grip';
  }

  /* Every grip the coach can choose at upload: the app's own pair
     first, then the ones the device is known to emit. */
  function gripChoices() {
    const ids = CT.GRIPS.map(g => g.id);
    Object.keys(EXTRA_GRIPS).forEach(id => { if (!ids.includes(id)) ids.push(id); });
    return ids.map(gripOf);
  }

  /* ── filename ───────────────────────────────────────────────
     Maks_half_crimp_left_cf-test-2026-07-20T18-35-30.json
     name ──┘ grip ────┘ hand ┘        stamp ┘
     Everything before the hand is name-then-grip, and the split
     between them is the only genuinely ambiguous part: a name can
     hold an underscore just as a grip can. The grip is matched from
     the right, longest token first, because the grip vocabulary is
     closed and names are not. */
  function fromName(filename) {
    const base = String(filename || '').replace(/\.json$/i, '');
    const m = base.match(/^(.*)_(left|right)_cf-test-(.+)$/i);
    if (!m) return { athlete: null, grip: null, hand: null };

    const head = m[1], hand = m[2].toLowerCase();
    let grip = null, athlete = head;

    const parts = head.split('_');
    for (let i = 1; i < parts.length; i++) {
      const token = parts.slice(i).join('_').toLowerCase();
      if (GRIP_TOKENS[token]) { grip = GRIP_TOKENS[token]; athlete = parts.slice(0, i).join(' '); break; }
    }
    /* Unrecognised grip: still take everything after the first
       underscore as one, rather than throwing it away. */
    if (!grip && parts.length > 1) {
      grip = parts.slice(1).join('_').toLowerCase();
      athlete = parts[0];
    }
    return { athlete: athlete.trim() || null, grip, hand };
  }

  /* ── one hand ───────────────────────────────────────────────
     The device's numbers pass through untouched. The derived part
     is which reps the critical force came from, since that is what
     decides whether the headline can be trusted. */
  function readHand(json) {
    const reps = (json.allReps || []).map(r => ({
      rep: r.rep,
      avg: r2(r.average),
      min: r2(r.minimum),
      peak: r2(r.peak),
      unreliable: !!r.unreliable,
      samples: r.rawCount == null ? null : r.rawCount,
      kept: r.filteredReadings == null ? null : r.filteredReadings,
      trace: (r.rawReadings || []).map(p => ({ t: p.t, f: r2(p.force) }))
    }));

    /* Match the device's cfRepValues back to the reps they came
       from, so the UI can point at them. It averages the closing
       reps, so search from the end; fall back to the last three if
       the values don't line up with anything. */
    const vals = (json.cfRepValues || []).map(r2);
    const used = [];
    vals.forEach(v => {
      for (let i = reps.length - 1; i >= 0; i--) {
        if (!used.includes(reps[i].rep) && Math.abs(reps[i].avg - v) < 0.02) { used.push(reps[i].rep); break; }
      }
    });
    const window = used.length === vals.length && used.length
      ? used.slice().sort((a, b) => a - b)
      : reps.slice(-CF_WINDOW).map(r => r.rep);

    /* Reps the device flagged, and — the part that matters — the
       flagged ones sitting inside the window that defines the
       critical force. */
    const flagged = reps.filter(r => r.unreliable).map(r => r.rep);
    const suspect = window.filter(n => flagged.includes(n));

    /* A rep with no usable readings averages zero. That is missing
       data, not a rep at zero force, and drawing it as a bar to the
       floor would be a lie. */
    const missing = reps.filter(r => r.avg === 0).map(r => r.rep);

    const usable = reps.filter(r => r.avg > 0);
    const opening = usable.length ? Math.max(...usable.slice(0, 3).map(r => r.avg)) : null;
    const cf = json.criticalForce;

    return {
      at: json.timestamp || null,
      cf: r2(cf),
      cfMin: json.cfMin == null ? null : r2(json.cfMin),
      ratio: json.cfRatio == null ? null : Math.round(json.cfRatio * 1000) / 1000,
      arc: json.arcZone == null ? null : r2(json.arcZone),
      /* the device ships this as a display string; keep the numbers */
      zone: [r1(json.arcZone == null ? cf * 0.8 : json.arcZone), r1(cf)],
      repValues: vals,
      window, flagged, suspect, missing,
      opening: opening == null ? null : r2(opening),
      /* how much force fell away from the opening reps to the
         asymptote — the shape of the curve in one number */
      fade: opening ? Math.round((1 - cf / opening) * 100) : null,
      reps
    };
  }

  /* ── one file ───────────────────────────────────────────── */
  function parse(filename, json) {
    if (!json || !Array.isArray(json.allReps) || typeof json.criticalForce !== 'number') {
      throw new Error('Not a critical-force export');
    }
    const meta = fromName(filename);
    const at = json.timestamp ? new Date(json.timestamp) : null;
    return {
      file: filename,
      athlete: meta.athlete,
      grip: meta.grip || 'half',
      gripGuessed: !meta.grip,
      hand: (json.hand || meta.hand || '').toLowerCase() || null,
      date: at && !isNaN(at) ? dt().iso(at) : dt().iso(dt().today()),
      bodyweight: typeof json.bodyweight === 'number' ? json.bodyweight : null,
      hand_: readHand(json)
    };
  }

  /* ── files into tests ───────────────────────────────────────
     Two files are the same test when they share a date and a grip.
     A single hand on its own is still a test — a coach who only
     tested one side shouldn't be stuck waiting for a file that is
     never coming. */
  function group(parsed) {
    const tests = [];
    parsed.forEach(p => {
      let t = tests.find(t => t.date === p.date && t.grip === p.grip && !t.hands[p.hand]);
      if (!t) {
        t = {
          id: null, date: p.date, grip: p.grip, gripGuessed: p.gripGuessed,
          bodyweight: p.bodyweight, athlete: p.athlete, hands: {}, source: {}
        };
        tests.push(t);
      }
      t.hands[p.hand || 'right'] = p.hand_;
      t.source[p.hand || 'right'] = p.file;
      if (t.bodyweight == null) t.bodyweight = p.bodyweight;
      if (!t.athlete) t.athlete = p.athlete;
      if (p.gripGuessed) t.gripGuessed = true;
    });
    return tests.sort((a, b) => a.date < b.date ? -1 : 1);
  }

  /* ── reading a stored test ──────────────────────────────────
     Everything below is what the views call. Hands are always read
     through here so a one-handed test never needs special-casing
     at the call site. */
  const HANDS = ['left', 'right'];

  function hands(test) {
    return HANDS.filter(h => test && test.hands && test.hands[h]).map(h => ({ hand: h, ...test.hands[h] }));
  }

  /* The gap between hands, always expressed as the weaker one's
     shortfall — a deficit is easier to act on than a ratio. */
  function balance(test) {
    const l = test.hands && test.hands.left, r = test.hands && test.hands.right;
    if (!l || !r) return null;
    const weak = l.cf <= r.cf ? 'left' : 'right';
    const lo = Math.min(l.cf, r.cf), hi = Math.max(l.cf, r.cf);
    return { weak, strong: weak === 'left' ? 'right' : 'left', lo: r2(lo), hi: r2(hi),
             gap: r2(hi - lo), pct: Math.round((1 - lo / hi) * 100) };
  }

  /* Every caveat worth putting in front of a coach, in the order
     they'd want to hear them. Empty means the test reads clean. */
  function caveats(test) {
    const out = [];
    hands(test).forEach(h => {
      const side = h.hand === 'left' ? 'Left' : 'Right';
      if (h.suspect.length) {
        out.push({
          tone: 'warn',
          text: `${side} hand: the critical force is read off reps ${list(h.window)}, and the device flagged ` +
                `rep${h.suspect.length > 1 ? 's' : ''} ${list(h.suspect)} as unreliable. The headline number rests on it.`
        });
      }
      if (h.missing.length) {
        out.push({
          tone: 'warn',
          text: `${side} hand: rep${h.missing.length > 1 ? 's' : ''} ${list(h.missing)} recorded no usable force. ` +
                `Shown as a gap in the curve rather than a reading of zero.`
        });
      }
      const rest = h.flagged.filter(n => !h.suspect.includes(n) && !h.missing.includes(n));
      if (rest.length >= 4) {
        out.push({
          tone: 'info',
          text: `${side} hand: ${h.flagged.length} of ${h.reps.length} reps were flagged — too few samples to be sure of the average. ` +
                `The shape of the curve is softer than it looks.`
        });
      }
    });
    return out;
  }

  function list(ns) {
    if (ns.length === 1) return String(ns[0]);
    return ns.slice(0, -1).join(', ') + ' and ' + ns[ns.length - 1];
  }

  /* CF as a share of bodyweight — the device ships it per hand, but
     a test taken without a bodyweight still has to render. */
  function pctBw(hand, bw) {
    if (hand.ratio != null) return Math.round(hand.ratio * 100);
    return bw ? Math.round(hand.cf / bw * 100) : null;
  }

  /* One test per date for the trend line: if a grip was tested
     twice in a day, the later file wins. */
  function series(tests, grip) {
    return tests.filter(t => t.grip === grip);
  }

  CT.cf = {
    CF_WINDOW, HANDS,
    parse, group, fromName,
    gripOf, gripChoices, prettify,
    hands, balance, caveats, pctBw, series
  };
})();
