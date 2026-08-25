/* ══════════════════════════════════════════════════════════════
   results.js — a finished test as a document, and as a file.

   Two consumers, and they want different things:

     · the database here, which stores the test whole;
     · Coach, which is a separate app with a separate project and
       reads a downloaded file.

   Coach is the only thing connecting the two projects, and it is a
   one-way street: a file goes out, nothing comes back. So the export
   shape and the filename below are a contract with somebody else's
   parser, and worth leaving alone unless that parser changes.
   ══════════════════════════════════════════════════════════════ */
import { CONFIG, GRIPS } from './engine.js';

/* ── the filename ───────────────────────────────────────────
   Coach reads the athlete, the grip and the hand out of the *name*
   of the file and nowhere else:

     Maks_half_crimp_left_cf-test-2026-07-20T18-35-30.json
     name ─┘ grip ────┘ hand ┘        stamp ┘

   A space in a name becomes an underscore because that is how Coach
   decodes it back — it joins the leading parts with spaces. Case is
   kept; the name is shown to a coach. */
const COACH_GRIP_TOKEN = {
  'half-crimp':    'half_crimp',
  '3-finger-drag': 'three_finger_drag'
};

export function filenameFor(test, when) {
  const stamp = when.toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const name  = String(test.name || '').replace(/[^a-z0-9 ]+/gi, '').trim().replace(/\s+/g, '_') || 'Unnamed';
  /* Coach's grip vocabulary, not ours. '3-finger-drag' underscored is
     '3_finger_drag', which Coach does not know — it then matches the
     trailing 'drag' instead and swallows '3 finger' into the athlete's
     name. Emitting a token from its list is what keeps a downloaded
     file readable over there. */
  const grip  = COACH_GRIP_TOKEN[test.grip] || String(test.grip).replace(/-/g, '_');
  return `${name}_${grip}_${test.hand}_cf-test-${stamp}.json`;
}

/* ── the document ───────────────────────────────────────────
   Everything the device saw, not just what it concluded. The raw
   trace is the only record of how a rep was actually pulled, and a
   headline number with no trace behind it cannot be argued with
   later. */
export function buildExport(appData, stateMachine, results, when) {
  return {
    timestamp: when.toISOString(),
    name: appData.name,
    bodyweight: appData.bodyweight,
    hand: appData.hand,
    grip: appData.grip,
    gripLabel: GRIPS[appData.grip],
    protocol: {
      totalReps:        CONFIG.TOTAL_REPS,
      countdownDuration: CONFIG.COUNTDOWN_DURATION,
      hangDuration:     CONFIG.HANG_DURATION,
      restDuration:     CONFIG.REST_DURATION,
      windowStartMs:    CONFIG.WINDOW_START_MS,
      windowEndMs:      CONFIG.WINDOW_END_MS,
      noiseThreshold:   CONFIG.NOISE_THRESHOLD
    },
    criticalForce: results.cf,
    cfMin:         results.cfMin,
    cfRatio:       results.ratio,
    arcZone:       results.arcZone,
    thresholdZone: results.thresholdZone,
    cfRepValues:   results.cfValues,
    unreliableReps: results.unreliableReps,
    allReps: stateMachine.repData.map((rep, idx) => ({
      rep: idx + 1,
      average: rep.average,
      minimum: rep.minimum,
      peak: rep.peak,
      unreliable: rep.unreliable,
      rawReadings: rep.rawReadings,
      rawCount: rep.stats.rawCount,
      windowedReadings: rep.stats.windowCount,
      filteredReadings: rep.stats.filteredCount
    })),
    /* Every reading the scale emitted for the whole test, including
       the countdown and the rests, timestamped from the start. */
    totalReadings: stateMachine.allReadings.length,
    allReadings: stateMachine.allReadings
  };
}

/* ── reading one back ───────────────────────────────────────
   One shape for the comparison screen whatever the source: a
   document out of the database, or a file somebody dropped on the
   page. Written once so the two can never disagree about what a
   dataset is. */
export function titleCase(str) {
  return String(str)
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/* ── the name, when the file doesn't carry it ───────────────
   Early exports recorded the hand but not the athlete or the grip —
   both lived in the filename and nowhere else. Those files are still
   the only record of tests that were actually done, so they have to
   keep loading.

   Two filename shapes, because this app changed its own:

     Maks_half_crimp_left_cf-test-2026-07-20T18-35-30.json   (now)
     cf-test-2026-07-20T18-35-30_maks_left_half-crimp.json   (before)

   In the current shape the split between name and grip is the only
   ambiguous part — a name can hold an underscore just as a grip can —
   so the grip is matched from the right against a closed vocabulary,
   the same way Coach does it. */
const GRIP_TOKENS = {
  half_crimp: 'Half Crimp', halfcrimp: 'Half Crimp', half: 'Half Crimp',
  three_finger_drag: '3 Finger Drag', threefingerdrag: '3 Finger Drag',
  '3_finger_drag': '3 Finger Drag', '3f_drag': '3 Finger Drag', drag: '3 Finger Drag',
  tfd: '3 Finger Drag', open_hand: 'Open Hand', full_crimp: 'Full Crimp'
};

export function fromFilename(filename) {
  const base = String(filename || '').replace(/\.json$/i, '');
  const out = { name: null, hand: null, grip: null };
  if (!base) return out;

  /* Current shape: everything up to the hand is name-then-grip. */
  let m = base.match(/^(.*)_(left|right)_cf-test-(.+)$/i);
  if (m) {
    out.hand = m[2].toLowerCase();
    const parts = m[1].split('_');
    for (let i = 1; i < parts.length; i++) {
      const token = parts.slice(i).join('_').toLowerCase();
      if (GRIP_TOKENS[token]) {
        out.grip = GRIP_TOKENS[token];
        out.name = parts.slice(0, i).join(' ');
        break;
      }
    }
    if (!out.name) out.name = parts[0];
    return out;
  }

  /* Older shape: stamp first, then name, hand, grip. */
  m = base.match(/^cf-test-([^_]+)_([^_]+)_(left|right)_(.+)$/i);
  if (m) {
    out.name = titleCase(m[2]);
    out.hand = m[3].toLowerCase();
    out.grip = GRIP_TOKENS[m[4].replace(/-/g, '_').toLowerCase()] || titleCase(m[4]);
  }
  return out;
}

export function toDataset(json, source, filename) {
  for (const field of ['criticalForce', 'arcZone', 'allReps']) {
    if (!(field in json)) throw new Error(`Missing required field: "${field}"`);
  }
  if (!Array.isArray(json.allReps) || json.allReps.length === 0) {
    throw new Error('allReps must be a non-empty array');
  }

  /* The file's own fields win; the filename is what is left when a
     test predates them being written down. */
  const meta = fromFilename(filename);
  const name = json.name || meta.name;
  const hand = json.hand || meta.hand;
  if (!name || !hand) {
    throw new Error('No name or hand, in the file or its filename');
  }

  const date = json.timestamp ? new Date(json.timestamp) : null;
  /* A stored ratio is the device's own; recompute only if it is
     absent and there is a bodyweight to divide by. */
  const ratio = json.cfRatio != null ? json.cfRatio
              : (json.bodyweight > 0 ? json.criticalForce / json.bodyweight : null);

  return {
    id: json.id || null,
    name: titleCase(name),
    hand: titleCase(hand),
    grip: json.gripLabel || (json.grip ? titleCase(json.grip) : (meta.grip || '—')),
    date: date && !isNaN(date.getTime()) ? date : null,
    cf: json.criticalForce,
    cfRatio: ratio,
    bodyweight: json.bodyweight,
    arcZone: json.arcZone,
    thresholdZone: json.thresholdZone,
    repData: json.allReps,
    unreliableReps: json.unreliableReps || [],
    source: source || 'db'
  };
}

/* ── the download ───────────────────────────────────────────
   Kept whatever the database did. Four minutes of hanging is not
   repeatable, so a saved test that only exists on a server one
   dropped connection away is a test at risk — and this file is what
   goes into Coach regardless. */
export function download(json, filename) {
  const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
