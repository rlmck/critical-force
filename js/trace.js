/* == trace.js -- one test, drawn as it happened. ===============

   The chart the app exists to show. Every reading the load cell
   emitted, in order, with each rep's averaging window drawn across
   the 2-6s slice it was taken from and the critical force running
   underneath the lot.

   Three marks and the whole point is how they relate: you can see the
   average ignore the grab and the drop-off, and you can see the last
   few reps settle onto the red line.

   It fits the width it is given. A whole test is 24 reps and all 24
   belong on screen at once — a chart you have to scroll sideways is a
   chart you cannot read the shape of, which is the only reason to
   draw it. Nothing here computes a force; every number is one the
   device already recorded.
   ============================================================== */

const NS = 'http://www.w3.org/2000/svg';
const el = (t, attrs) => {
  const n = document.createElementNS(NS, t);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
};

/* The viewBox is the container's own pixel size, so one user unit is
   one screen pixel. That is worth the re-render on resize: with a
   fixed viewBox scaled to fit, every margin and every label shrinks
   with the box, and an 11px tick renders at 3px on a phone.

   Height is chosen for the width. Wide and shallow reads a decay
   across 24 reps; the same proportion on a phone is 270 by 80, which
   is not a chart. Every rep is on it either way — a chart you have to
   scroll sideways is one you cannot read the shape of. */
const MT = 14, MR = 10, MB = 22;

function heightFor(width) {
  if (width < 420) return 190;
  if (width < 700) return 210;
  return 240;
}

export class TraceChart {
  /**
   * @param {Element} host   where the svg goes
   * @param {object}  trace  from results.traceFor()
   * @param {object}  opts   { cf, arcZone, name, hand, compact }
   * @returns {string} the trace kind actually drawn
   */
  render(host, trace, opts = {}) {
    if (!host) return 'none';
    host.replaceChildren();

    if (!trace || !trace.bars.length) {
      const p = document.createElement('p');
      p.className = 'trace-empty';
      p.textContent = 'Nothing was recorded for this test.';
      host.appendChild(p);
      return 'none';
    }

    /* Measured, not assumed: the same chart is drawn into a card on a
       1280px desktop and a 375px phone. */
    const VW = Math.round(host.clientWidth || host.getBoundingClientRect().width || 700);
    const VH = heightFor(VW);

    const pts  = trace.segments.flatMap(s => s.points);
    /* The bars are part of the extent, not decoration over it: a last
       rep whose readings stop before its window closes would otherwise
       run off the right edge. */
    const tMax = Math.max(...pts.map(p => p.t), ...trace.bars.map(b => b.to), 1);
    const fMax = Math.max(...pts.map(p => p.f), opts.cf || 0, 1);

    /* One scale across every card on the screen, chosen by the caller.
       Stacked charts imply comparability and per-card scaling destroys
       it: a 10 kg critical force and a 25 kg one would otherwise sit at
       the same height on two cards an inch apart. */
    const top  = opts.yMax || fMax;
    const step = top > 60 ? 20 : top > 25 ? 10 : 5;
    const yTop = opts.yMax || Math.ceil(fMax / step) * step;

    /* Widest label decides the left margin. Guessing it clips "100"
       and nobody notices until the numbers get big. */
    const ML = 14 + String(yTop).length * 9;

    const sx = t => ML + (t / tMax) * (VW - ML - MR);
    const sy = f => VH - MB - (f / yTop) * (VH - MT - MB);

    const svg = el('svg', {
      viewBox: `0 0 ${VW} ${VH}`,
      preserveAspectRatio: 'xMidYMid meet',
      style: `aspect-ratio: ${VW} / ${VH}`,
      class: 'trace-svg',
      role: 'img',
      'aria-label': `Force through the whole test for ${opts.name || 'this test'}` +
                    (opts.hand ? `, ${opts.hand} hand` : '')
    });

    /* ── grid ────────────────────────────────────────────────
       Behind everything, and quiet. Labels sit in the left margin so
       no gridline has to break for them. */
    const grid = el('g', { class: 'trace-grid-g' });
    for (let f = 0; f <= yTop; f += step) {
      grid.appendChild(el('line', {
        x1: ML, x2: VW - MR, y1: sy(f), y2: sy(f),
        class: f === 0 ? 'trace-axis' : 'trace-grid'
      }));
      const label = el('text', { x: ML - 6, y: sy(f) + 3.5, class: 'trace-tick' });
      label.textContent = String(f);
      grid.appendChild(label);
    }
    svg.appendChild(grid);

    /* ── the reps the answer comes from ─────────────────────
       A quiet band behind the closing reps. The headline is the mean of
       those three and nothing else on the chart says so. */
    if (opts.cfReps && trace.bars.length) {
      const first = trace.bars.find(b => opts.cfReps.includes(b.rep));
      const last  = [...trace.bars].reverse().find(b => opts.cfReps.includes(b.rep));
      if (first && last) {
        const x1 = sx(first.from - trace.winStart);
        const x2 = Math.min(sx(last.to + trace.winStart), VW - MR);
        svg.appendChild(el('rect', {
          x: x1, y: MT, width: Math.max(0, x2 - x1), height: VH - MT - MB,
          class: 'trace-cfband'
        }));
      }
    }

    /* ── critical force ──────────────────────────────────────
       Under the trace, so the readings cross it rather than it
       cutting through them. */
    if (opts.cf > 0) {
      const y = sy(opts.cf);
      svg.appendChild(el('line', { x1: ML, x2: VW - MR, y1: y, y2: y, class: 'trace-cf' }));
    }

    /* ── the trace ───────────────────────────────────────── */
    /* A hang with two or three readings in it has no shape to draw.
       Joining them makes a near-vertical slash from the floor to the
       peak and back, which reads as a rendering fault rather than what
       it is: a rep the radio mostly missed. Those get their readings
       as dots and no line. */
    const SPARSE = 6;
    const lines = el('g', { class: 'trace-lines' });
    const loose = [];
    trace.segments.forEach(seg => {
      if (seg.points.length >= SPARSE) {
        lines.appendChild(el('polyline', {
          points: seg.points.map(p => `${sx(p.t).toFixed(1)},${sy(p.f).toFixed(1)}`).join(' '),
          class: 'trace-line'
        }));
      } else {
        loose.push(...seg.points);
      }
    });
    svg.appendChild(lines);

    /* One dot per reading, but only where they would not merge into a
       bar of ink. At 24 reps across one screen they usually would, so
       usually there are none — the line is already every reading. */
    const spacing = (VW - ML - MR) / Math.max(pts.length, 1);
    const dotted = spacing > 4 ? pts : loose;
    if (dotted.length) {
      const dots = el('g', { class: 'trace-dots' });
      dotted.forEach(p => dots.appendChild(el('circle', {
        cx: sx(p.t).toFixed(1), cy: sy(p.f).toFixed(1), r: 1.4
      })));
      svg.appendChild(dots);
    }

    /* ── the averaging windows ───────────────────────────────
       On top of everything: this is the answer, and the trace is the
       working behind it. */
    const bars = el('g', { class: 'trace-windows' });
    trace.bars.forEach(b => {
      if (!(b.average > 0)) {
        /* A rep that averaged zero recorded nothing usable. That is
           missing data, not a rep at zero force, so it is marked on the
           floor rather than silently skipped -- which would leave a gap
           in the row that nobody could account for. */
        bars.appendChild(el('line', {
          x1: sx(b.from), x2: sx(b.to), y1: VH - MB, y2: VH - MB,
          class: 'trace-window missing'
        }));
        return;
      }
      bars.appendChild(el('line', {
        x1: sx(b.from), x2: sx(b.to), y1: sy(b.average), y2: sy(b.average),
        class: 'trace-window' + (b.unreliable ? ' unreliable' : '')
      }));
    });
    svg.appendChild(bars);

    /* ── which rep is which ──────────────────────────────
       Without these you cannot say which rep a dip belongs to. Every
       sixth, plus the first and last. */
    const ticks = el('g', { class: 'trace-reps' });
    const lastRep = trace.bars[trace.bars.length - 1].rep;
    trace.bars.forEach(b => {
      if (b.rep !== 1 && b.rep !== lastRep && b.rep % 6 !== 0) return;
      const t = el('text', {
        x: (sx(b.from) + sx(b.to)) / 2, y: VH - MB + 14, class: 'trace-rep-n'
      });
      t.textContent = b.rep;
      ticks.appendChild(t);
    });
    svg.appendChild(ticks);

    host.appendChild(svg);

    /* The critical-force value belongs beside its line, but text in a
       non-uniformly scaled svg stretches with it. So it is an HTML
       label positioned over the chart instead. */
    if (opts.cf > 0) {
      const tag = document.createElement('span');
      tag.className = 'trace-cf-tag';
      tag.style.top = `${(sy(opts.cf) / VH) * 100}%`;
      tag.textContent = `CF ${opts.cf.toFixed(1)} kg`;
      host.appendChild(tag);
    }

    return trace.kind;
  }
}
