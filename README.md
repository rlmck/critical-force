# Critical Force

A WH-C06 load cell, read in the browser, turned into a number a
climber can train against.

Live at <https://critical-force-test.web.app>.

**No build step.** ES modules loaded straight from the page. Nothing
to install, nothing to bundle, no package.json.

## Two versions

Not one layout that stretches — two, because the two situations are
not the same one:

| | |
|---|---|
| **[/d](https://critical-force-test.web.app/d)** — desktop | A laptop on a bench. Room for the numbers and the charts at once, read from a metre away. Both decay-curve overlays, the CF:BW column in the history list, drag-and-drop for files. |
| **[/m](https://critical-force-test.web.app/m)** — mobile | A phone at the board. The timer is 128px, every control clears 48px, the nav is a bottom bar under your thumb, and the screen is held awake for the four minutes a test takes. One chart, not two. |

`/` picks one and redirects: what you asked for in the URL
(`?layout=m`), then what you chose last time, then a guess — narrow
screen **and** a coarse pointer. A narrow window on a laptop is still
a laptop. Either page has a switch link at the foot of it, and the
choice sticks.

Underneath they are the same app. `js/engine.js` is the protocol and
the arithmetic and knows nothing about screens; `js/views/base.js` is
every behaviour both layouts share. A layout is markup, CSS, and about
twenty lines of wiring.

## Running it

Serve the folder — not `file://`, which is not a secure context and so
reaches no Bluetooth at all:

```bash
python tools/serve.py 5178
```

Then <http://localhost:5178>. Use this rather than
`python -m http.server`: that one sends no `Cache-Control` at all, so
the browser caches modules heuristically and an edit to one file lands
while another is served stale.

**Chrome or Edge, with an experimental flag on.** The scale broadcasts
weight in its manufacturer advertisement data, so the driver reads it
with `watchAdvertisements()` rather than connecting to a service. That
API sits behind `chrome://flags/#enable-experimental-web-platform-features`.
Without the flag, connecting raises `watchAdvertisements() not
available`; on iOS Safari there is no Web Bluetooth to raise it with.

`localhost` and HTTPS are both secure contexts. Any other plain-HTTP
origin is not, which is most of why this is hosted rather than passed
around as a folder.

## What a test measures

The load cell is polled continuously, but not every reading counts.

- **The averaging window is 2–6s of each 7s hang.** The first two
  seconds are the athlete loading the edge and the last is them coming
  off; neither is the rep.
- **Readings under 1kg are dropped** as noise rather than recorded as
  a weak pull.
- **A rep with fewer than 3 surviving readings is flagged unreliable.**
  It still carries its average, because the flag is a caveat for
  whoever reads the test and not grounds for throwing a rep away.
- **A rep that averages zero is missing data, not a rep at zero
  force.** Anything drawing it has to tell the two apart.

Reps 22, 23 and 24 are what critical force is read off. The ARC zone
ceiling is 80% of it. All of that is `computeResults()` in
`js/analysis.js`, in one place, so a test on screen tonight and the
same test read back next month cannot drift apart.

## The history screen

Every saved test, newest first, and **each one draws its own trace in
place**. A list of names with a link to a graph is a list of promises;
the chart is the thing you came to look at, so it is on the screen.

Filter by athlete, grip, hand and recency. The options are built from
the tests actually present rather than a fixed list — the grips on
record are the authority, not the two the app happens to offer today.
A filter value that stops being available is dropped rather than left
selected, so you can never filter yourself into an empty screen with
no way back.

**Old exports can be brought in.** Drop them on the screen and they
read immediately; *Import to database* makes them permanent. The
document id comes from the test's own timestamp, so importing the same
file twice corrects the record rather than doubling it.

### The chart

Every reading as a line, each rep's averaging window laid on top at
that rep's average across the 2–6s slice that counts, and critical
force running underneath. You can watch the average ignore the grab
and the drop-off rather than taking the headline on trust.

Three rules it is built on:

**All 24 reps, always in view.** The chart is drawn at the pixel width
of its container and redrawn when that changes. A chart you scroll
sideways has no shape, and the shape of the decay is the only reason
to draw it.

**Loudest to quietest: measurement, answer, working.** Measured on the
chart ground: window marks 8.7:1, critical force 6.1:1, trace 3.7:1.
The trace is deliberately dim — it is the working behind the number,
and when it was the brightest thing on the card the noise was shouting
down the result. A flagged window is the same orange at 55% rather
than a second colour, so "less certain" reads as less ink without
dropping below the noise it is a measurement of.

**One y-scale across the whole screen.** Stacked charts imply they can
be compared, and scaling each to its own maximum destroys that: a 10 kg
critical force and a 25 kg one would sit at the same height on two
cards an inch apart.

**Every reading is a dot, but only where a dot says something.** The
WH-C06 broadcasts roughly five times a second and about 38% of those
packets never arrive, so a 7-second hang holds between 4 and 26
readings rather than the ~34 the cadence implies. On a rep dense
enough to draw as a line every reading is already a vertex of it, and
a dot on each one only beads the trace and pushes the noise back above
the measurement. So the dots appear on the sparse reps, where they are
the difference between "a rep" and "three readings". If you want a
denser trace the fix is at the radio: keep the receiving device close
to the scale and clear of your body.

**Each rep is clipped to its plateau.** The readings either side of a
hang are the athlete taking hold and letting go — a 50 kg swing
between two samples that says nothing about critical force. Drawn, it
is a near-vertical slash from the floor to the peak, and it reads as a
rendering fault rather than as data.

A rep that averaged zero recorded nothing usable. That is missing
data, not a rep at zero force, so it is marked on the floor rather
than silently skipped.

**kg or × bodyweight.** The toggle in the header changes what the
shared scale is measured in. It is there because comparing athletes of
different mass is the comparison worth making — *not* because it wins
back plot space. Measured across these ten tests, rep 1 is **1.8× to
5.2× the critical force within a single test**, and spans 2.3× across
athletes in kilograms against 2.1× as a share of bodyweight. The
vertical range is set by the opening rep either way. That large
dynamic range is what a critical-force test *is*; the taller plot is
the honest mitigation, not a change of units.

**Below 420px the chart draws the window marks alone.** Twenty-four
reps of trace at 11px each is a picket fence, and the first thing lost
in it is the tail — the three reps the answer comes from. The marks
carry the same numbers legibly at that width. The legend drops the
keys for marks that are not being drawn.

**Three generations of export are in circulation and they do not carry
the same thing.** All three draw the same chart on the same axes — the
sparser ones simply have less on them, and say so with a small label:

| label | what the file kept | what you see |
|---|---|---|
| *(none)* | the whole test, rests included | the true curve, dropping to the floor between reps |
| `hangs only` | each hang, nothing between them | reps at nominal spacing — exact in force, approximate in time |
| `averages only` | a *count* of readings, not the readings | the window marks alone, no trace |

### Comparing and deleting

**Compare** adds a test to the decay-curve overlay above the list, up
to four at once — a fifth line stops being a comparison and becomes a
thicket.

**Delete** is two taps: the first arms it and says what it is about to
do, the second does it, and it disarms itself after five seconds. A
test takes four minutes to record and cannot be repeated, so a stray
press and an extra press do not cost the same. Deleting a test that is
only a dropped file removes it from the session and leaves the file
alone.

## The database

Its own Firebase project, `critical-force-test`. **Nothing is shared
with [climbing-coach](https://github.com/rlmck/climbing-coach)** — separate
project, separate database, separate rules, separate accounts.

One collection, `tests`, one document per test, keyed by the test's
own timestamp with the athlete, hand and grip.

**One shared space, and genuinely no login.** Every test is visible
to everyone who opens the app, and anyone who opens it can record one.
There is no sign-in of any kind, not even an invisible one.

What the rules check is the *shape*: a document has to have a name, a
timestamp, a hand, a grip, a plausible force and a non-empty rep list
to be accepted. That stops malformed writes and drive-by junk. It
stops nothing else. **Do not put anything in this project that would
matter if a stranger read it.**

Deletes are refused outright, so the worst a passer-by can do is add a
row rather than remove a real test. Remove a bad test from the console.

An earlier version minted an anonymous account so the rules had
something to check other than "anybody" — but enabling anonymous
sign-in is a console setting, it was never switched on, and the result
was an app that silently refused to save anything. A floor that stops
the app working is worse than no floor.

**A test is downloaded as well as saved, always.** Four minutes of
hanging does not come round again, so the file is written whatever the
database did — and the message afterwards says which of the two
actually happened rather than a flat "saved".

### Importing an old export

Early files record the hand but neither the athlete nor the grip; both
lived in the filename. Once a test is in the database there is no
filename any more, so `documentFor()` writes the recovered labelling
into the document. The device's own numbers are untouched — only the
labels are filled in.

### Setting the backend up

`firebase deploy --only firestore,hosting` is the whole of it. There
is no console step.

Blank the `apiKey` in `js/config.js` and the app runs with no backend
at all: the test works and results download as files. That is the same
fallback path deliberately.

## Getting a test into Coach

The one thing connecting this project to the Coach app, and a one-way
street: a file goes out, nothing comes back.

Coach reads the athlete, the grip and the hand out of the *filename*
and nowhere else:

```
Maks_half_crimp_left_cf-test-2026-07-20T18-35-30.json
name ─┘ grip ────┘ hand ┘        stamp ┘
```

This app used to emit `cf-test-{stamp}_{name}_{hand}_{grip}.json`,
which Coach's parser reads as `{athlete: null, grip: null, hand: null}`
— every field wrong, silently, with the grip defaulting to half-crimp.
Every export had to be renamed by hand. It now emits the format above.

Grips go out as Coach's own tokens: `3-finger-drag` underscored is
`3_finger_drag`, which Coach does not know, so it matches the trailing
`drag` and swallows `3 finger` into the athlete's name.

Older exports that recorded neither name nor grip still load here —
`fromFilename()` in `js/results.js` reads both filename shapes.

Test exports are gitignored. They are real people's bodyweight and
finger strength, and they belong in the database rather than in this
history.

## Layout

| | |
|---|---|
| `index.html` | The doorway. Picks a layout and redirects. |
| `desktop.html` · `mobile.html` | The two layouts. Same element ids where they mean the same thing. |
| `css/app.css` | Components — true at any size. |
| `css/desktop.css` · `css/mobile.css` | Everything that depends on how much room there is. |
| `js/engine.js` | The protocol, the arithmetic, the scale. Knows nothing about screens. |
| `js/analysis.js` | What the reps add up to, and the decay-curve chart. |
| `js/results.js` | A finished test as a document and as a file, and the trace normaliser. The Coach seam. |
| `js/trace.js` | One test drawn as it happened: readings, averaging windows, critical force. Sizes itself to its container. |
| `css/app.css` | Design tokens at the top — three greys, two accents, one type scale, one spacing scale. Add a tenth grey and it starts looking like a debug view. |
| `js/store.js` | Firestore: where a test goes and how it comes back. |
| `js/layout.js` | Which of the two versions you get. |
| `js/views/base.js` | Every behaviour both layouts share. |
| `js/views/desktop.js` · `mobile.js` | The wiring that says which page this is. |
| `bluetooth-scale.js` | The WH-C06 driver. |
| `tools/serve.py` | The dev server. Sends `no-cache`, so an edit never lands next to a stale module. |

`jade-arc.html` is a separate ARC timer sharing only the scale driver.
It is not part of this app and none of the above applies to it.
