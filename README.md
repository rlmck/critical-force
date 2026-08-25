# Critical Force

Two tools that read a WH-C06 Bluetooth load cell in the browser and turn
what a finger pulls into something a coach can act on.

**No build step.** `index.html` carries its own styles and its own module;
the only import is the scale driver. Nothing to install, nothing to bundle.

| | |
|---|---|
| **`index.html`** | The critical-force test — 24 reps of 7s on, 3s off, with a 10s lead-in. Critical force is the mean of the closing three reps, read off a 2–6s window inside each hang so the grab and the drop-off don't count. |
| **`jade-arc.html`** | An ARC timer for 20 minutes of low-intensity repeaters against a target weight, with the live reading colour-coded against it. |
| **`bluetooth-scale.js`** | The WH-C06 driver both share. Weight arrives in BLE advertisement packets, not a GATT characteristic — see below. |

## Running it

Serve the folder — not `file://`, which is not a secure context and so
reaches no Bluetooth at all:

```bash
python -m http.server 5178
```

Then <http://localhost:5178>.

**Chrome or Edge, with an experimental flag on.** The scale broadcasts
weight in its manufacturer advertisement data, so the driver reads it
with `watchAdvertisements()` rather than connecting to a service. That
API sits behind `chrome://flags/#enable-experimental-web-platform-features`.
Without the flag the connect button raises `watchAdvertisements() not
available`; on iOS Safari there is no Web Bluetooth to raise it with.

`localhost` and HTTPS are both secure contexts. Any other plain-HTTP
origin is not, which is most of why this is hosted rather than passed
around as a folder.

## What a test measures

The load cell is polled continuously, but not every reading counts.

- **The averaging window is 2–6s of each 7s hang.** The first two seconds
  are the athlete loading the edge and the last is them coming off; neither
  is the rep.
- **Readings under 1kg are dropped** as noise rather than recorded as a
  weak pull.
- **A rep with fewer than 3 surviving readings is flagged unreliable.** It
  still carries its average, because the flag is a caveat for whoever reads
  the test and not grounds for throwing a rep away.
- **A rep that averages zero is missing data, not a rep at zero force.**
  Anything drawing it has to tell the two apart.

Reps 22, 23 and 24 are what critical force is read off. The ARC zone
ceiling is 80% of it.

## Where the results go

A finished test is filed straight onto an athlete's record in
[Coach](https://github.com/rlmck/climbing-coach) — the same Firestore
project, the same document its uploader would have produced. Sign in at
the top of the setup screen, pick the athlete, and the test is on their
record before you have taken the scale off the board.

**Signing in gates filing, not testing.** With nobody signed in, no
athlete picked, or no network, the tools work exactly as they always
did and the test downloads as JSON. That path is the fallback, not a
failure — four minutes of hanging is not repeatable, so the file is
written either way.

**Only a coach can file a test.** That is Coach's rule and not this
app's: `firestore.rules` there says a critical-force test is written by
the coach and nobody else, because the load cell is the coach's. An
account that isn't the coach on that athlete's record is refused by the
server. Nothing in this repo changes those rules.

### The document

Keyed `{date}_{grip}` in `athletes/{id}/criticalForce`, which is doing
two jobs. A test is two files, so running the left hand and then the
right merges into one document with two hands rather than two documents
with one hand each. And re-running a grip because the first attempt was
a mess corrects the record instead of doubling it.

The parse is not done here. `vendor/cftest.js` is a verbatim copy of
Coach's own reader, so there is no second implementation to drift —
see [vendor/README.md](vendor/README.md).

### The filename still matters

The downloaded file is the fallback path, and Coach's uploader reads
the athlete, grip and hand out of its *name*:

```
Maks_half_crimp_left_cf-test-2026-07-20T18-35-30.json
name ─┘ grip ────┘ hand ┘        stamp ┘
```

This app used to emit `cf-test-{stamp}_{name}_{hand}_{grip}.json`,
which Coach's parser reads as `{athlete: null, grip: null, hand: null}`
— every field wrong, silently, with the grip defaulting to half-crimp.
Every export had to be renamed by hand before it could be uploaded.
It now emits the format above.

Grips go out as Coach's tokens rather than this app's: `3-finger-drag`
underscores to `3_finger_drag`, which is not in Coach's vocabulary, so
it matches the trailing `drag` and swallows `3 finger` into the
athlete's name.

Test exports are gitignored. They are real people's bodyweight and
finger strength, and they belong on an athlete's record rather than in
this history.

## Layout

| | |
|---|---|
| `js/config.js` | Which Firebase project. Blank the `apiKey` and filing switches off cleanly. |
| `js/firebase.js` | The pinned SDK, dynamically imported. A trimmed cousin of Coach's file of the same name. |
| `js/ct-shim.js` | The grip list and date helpers the vendored parser stands on. Loads before it. |
| `js/sync.js` | Sign-in, the roster, and the merge that files a test. |
| `vendor/cftest.js` | Coach's parser, verbatim. Do not edit here. |

Load order is a dependency order and `index.html` states it as one.
