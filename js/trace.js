/* == trace.js -- one test, drawn as it happened. ===============

   The overlay chart in analysis.js answers "how did the reps decay?"
   by plotting 24 averages. This answers a different question: what did
   the load cell actually see, second by second, and where inside each
   hang did the average come from?

   Three marks, and the whole point is how they relate:

     · the trace   -- every reading, in order. Rises as the hand loads
                      the edge, wanders through the hang, drops to the
                      floor through the rest.
     · the windows -- one flat bar per rep, drawn only across the 2-6s
                      slice that counts, at that rep's average. Sitting
                      it *on* the squiggle is the explanation: you can
                      see the bar ignore the grab and the drop-off.
     · critical force -- one line across everything. Where the curve
                      flattens out to.

   Nothing here computes a force. Every number drawn is one the device
   already recorded.
   ============================================================== */

const NS = 'http://www.w3.org/2000/svg';
const el = (t, attrs) => {
  const n = document.createElementNS(NS, t);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/* Room for the axis labels. The left margin is the widest y-label plus
   its tick, measured rather than guessed at, further down. */
const VW = 1000, VH = 460, MT = 18, MR = 20, MB = 46;

export class TraceChart {
  /**
   * @param {Element} host      where the svg goes
   * @param {object}  trace     from results.traceFor()
   * @param {object}  opts      { cf, arcZone, hand, name, grip }
   * @returns {string} the trace kind actually drawn
   */
  render(host, trace, opts = {}) {
    if (!host) return 'none';
    host.replaceChildren();

    if (!trace || trace.kind === 'none' || !trace.segments.length) {
      const p = document.createElement('div');
      p.className = 'trace-empty';
      p.textContent = 'This test recorded how many readings each rep had, but not the readings themselves — there is no curve to draw. The per-rep averages are below.';
      host.appendChild(p);
      return 'none';
    }

    const pts = trace.segments.flatMap(s => s.points);
    /* The window bars are part of the extent, not decoration laid over
       it. A last rep whose readings stop before its window closes
       leaves the bar running past the end of the trace, and scaling to
       the readings alone clips it off the right edge. */
    const tMax = Math.max(...pts.map(p => p.t), ...trace.bars.map(b => b.to), 1);
    const fMax = Math.max(...pts.map(p => p.f), opts.cf || 0, 1);

    /* Round the top out to a tick so the axis reads in whole steps. */
    const step  = fMax > 60 ? 20 : fMax > 25 ? 10 : 5;
    const yTop  = Math.ceil(fMax / step) * step;

    /* Widest label decides the left margin — a chart that guesses this
       clips "100" and nobody notices until the numbers get big. */
    const ML = 26 + String(yTop).length * 11;

    const sx = t => ML + (t / tMax) * (VW - ML - MR);
    const sy = f => VH - MB - (f / yTop) * (VH - MT - MB);

    const svg = el('svg', {
      viewBox: `0 0 ${VW} ${VH}`,
      preserveAspectRatio: 'xMidYMid meet',
      class: 'trace-svg',
      role: 'img',
      'aria-label': `Force over time for ${opts.name || 'this test'}, ${opts.hand || ''} hand`
    });

    /* ── grid and y axis ─────────────────────────────────── */
    for (let f = 0; f <= yTop; f += step) {
      svg.appendChild(el('line', {
        x1: ML, x2: VW - MR, y1: sy(f), y2: sy(f),
        class: f === 0 ? 'trace-axis' : 'trace-grid'
      }));
      const label = el('text', { x: ML - 12, y: sy(f) + 5, class: 'trace-tick' });
      label.textContent = String(f);
      svg.appendChild(label);
    }

    /* ── the trace ───────────────────────────────────────── */
    trace.segments.forEach(seg => {
      if (seg.points.length < 2) return;
      svg.appendChild(el('polyline', {
        points: seg.points.map(p => `${sx(p.t).toFixed(1)},${sy(p.f).toFixed(1)}`).join(' '),
        class: 'trace-line'
      }));
    });

    /* ── the averaging windows ───────────────────────────── */
    trace.bars.forEach(b => {
      if (!(b.average > 0)) return;
      svg.appendChild(el('line', {
        x1: sx(b.from), x2: sx(b.to), y1: sy(b.average), y2: sy(b.average),
        class: 'trace-window' + (b.unreliable ? ' unreliable' : '')
      }));
    });

    /* ── critical force ──────────────────────────────────── */
    if (opts.cf > 0) {
      const y = sy(opts.cf);
      svg.appendChild(el('line', { x1: ML, x2: VW - MR, y1: y, y2: y, class: 'trace-cf' }));
      const tag = el('text', { x: ML + 14, y: y - 12, class: 'trace-cf-label' });
      tag.textContent = `Critical Force · ${opts.cf.toFixed(1)} kg`;
      svg.appendChild(tag);
    }

    /* ── x axis ──────────────────────────────────────────── */
    const xLabel = el('text', { x: (ML + VW - MR) / 2, y: VH - 8, class: 'trace-axis-label' });
    xLabel.textContent = trace.kind === 'session'
      ? `Time → (${Math.round(tMax / 1000)}s)`
      : 'Time → (reps in order; rests not recorded)';
    svg.appendChild(xLabel);

    const yLabel = el('text', {
      x: 0, y: 0, class: 'trace-axis-label',
      transform: `translate(14 ${(MT + VH - MB) / 2}) rotate(-90)`
    });
    yLabel.textContent = 'Force (kg) →';
    svg.appendChild(yLabel);

    host.appendChild(svg);
    return trace.kind;
  }
}
