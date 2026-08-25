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

A finished test is a JSON file holding every headline number, the per-rep
breakdown, and the raw trace of every reading the scale emitted — including
the countdown and the rests, so the whole session can be replayed.

Those files are the input to [climbing-coach](https://github.com/rlmck/climbing-coach),
which parses them in `js/cftest.js` and files them onto an athlete's record.
Its parser reads the athlete, grip and hand out of the *filename*.

Test exports are gitignored. They are real people's bodyweight and finger
strength, and they belong on an athlete's record rather than in this
history.
