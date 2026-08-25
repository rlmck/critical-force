/* ═══════════════════════════════════════════════════════════════
   ct-shim.js — the little of Coach that vendor/cftest.js stands on.

   The vendored parser is a verbatim copy and reaches for two things
   from the app it came out of: the grip vocabulary, and the date
   helpers. Coach's js/data.js is 46 KB of app that has no business
   here, so this supplies only those two — copied exactly, because a
   parser that rounds a date differently than Coach does files a test
   under a key Coach cannot find.

   Must load BEFORE vendor/cftest.js.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  const CT = (window.CT = window.CT || {});

  /* Verbatim from Coach's js/data.js. The device's own grip list lives
     in index.html and is a different vocabulary on purpose — this is
     the one a stored test is keyed by. */
  CT.GRIPS = [
    { id: 'tfd',  name: 'Three-Finger Drag', short: '3F drag',    edge: '20 mm' },
    { id: 'half', name: 'Half-Crimp',        short: 'Half-crimp', edge: '20 mm' }
  ];

  /* Local dates, not UTC, and that is the whole point of copying it
     rather than reaching for toISOString(). A test finished at 23:30
     BST is that day's test; toISOString() would file it under
     tomorrow, and Coach — which groups by date — would show two
     half-tests on two days instead of one test with two hands. */
  const DAY = 86400000;
  CT.dt = {
    DAY,
    today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; },
    parse(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
    iso(d) {
      return d.getFullYear() + '-' +
             String(d.getMonth() + 1).padStart(2, '0') + '-' +
             String(d.getDate()).padStart(2, '0');
    }
  };
})();
