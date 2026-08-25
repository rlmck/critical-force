/* ══════════════════════════════════════════════════════════════
   analysis.js — what the reps add up to, and how it draws.

   Shared by both layouts and by the history screen, so a test read
   back out of the database is measured exactly as it was the day it
   was run. Nothing here reads the DOM except through elements handed
   to it.
   ══════════════════════════════════════════════════════════════ */
import { CONFIG } from './engine.js';

/* Four, because a fifth line on one chart stops being a comparison
   and starts being a thicket. */
export const PALETTE = ['#a855f7', '#2dd4bf', '#fb7185', '#fbbf24'];

/* ── the headline numbers ─────────────────────────────
   Critical force is the mean of the closing reps named in CONFIG.
   CF_REPS. It is computed in one place because a test on screen and
   the same test read back from the database have to agree — and the
   quickest way to make them disagree is to work it out twice. */
export function computeResults(repData, bodyweight) {
  const cfRepData = CONFIG.CF_REPS.map(i => repData[i]);
  const cfValues  = cfRepData.map(r => r.average);
  const cf        = cfValues.reduce((sum, v) => sum + v, 0) / cfValues.length;
  const cfMin     = Math.min(...cfRepData.map(r => r.minimum));
  /* Bodyweight is optional in a stored test, and 0 would make this
     Infinity rather than "unknown". */
  const ratio     = bodyweight > 0 ? cf / bodyweight : null;
  const arcZone   = cf * 0.8;

  return {
    cf, cfMin, ratio, arcZone,
    thresholdZone: `${arcZone.toFixed(1)} - ${cf.toFixed(1)} kg`,
    cfValues, cfRepData,
    /* 1-indexed, because these are shown to a person */
    unreliableReps: repData
      .map((r, i) => (r.unreliable ? i + 1 : null))
      .filter(n => n !== null)
  };
}

export class OverlayChart {
    fitCurve(repData, unreliableReps) {
        const excluded = new Set(unreliableReps);
        const points = repData
            .map((r, i) => ({ x: i + 1, y: r.average }))
            .filter((p, i) => !excluded.has(i + 1) && p.y > 0);

        if (points.length < 3) return null;

        const ys = points.map(p => p.y);
        let a = Math.max(...ys) - Math.min(...ys);
        let b = 0.1;
        let c = Math.min(...ys);
        const n = points.length;

        for (let iter = 0; iter < 8000; iter++) {
            let ga = 0, gb = 0, gc = 0;
            for (const { x, y } of points) {
                const e = Math.exp(-b * x);
                const err = a * e + c - y;
                ga += err * e;
                gb += err * (-a * x * e);
                gc += err;
            }
            a -= (2 / n) * 0.0001  * ga;
            b -= (2 / n) * 0.000001 * gb;
            c -= (2 / n) * 0.0001  * gc;
        }

        return { a, b, c, points };
    }

    eval(a, b, c, x) {
        return a * Math.exp(-b * x) + c;
    }

    /**
     * Bodyweight for a dataset: the stored value, or backed out of the
     * CF:BW ratio for files saved without it.
     */
    bodyweightOf(ds) {
        if (ds.bodyweight > 0) return ds.bodyweight;
        if (ds.cfRatio > 0 && ds.cf > 0) return ds.cf / ds.cfRatio;
        return 0;
    }

    /** Restates every force as a multiple of that athlete's bodyweight. */
    toBodyweightSeries(datasets) {
        return datasets.map((ds, i) => {
            const bw = this.bodyweightOf(ds);
            if (!bw) return null;
            return {
                ...ds,
                colorIndex: i,
                bodyweight: bw,
                cf: ds.cf / bw,
                repData: ds.repData.map(r => ({ ...r, average: r.average / bw }))
            };
        }).filter(Boolean);
    }

    /**
     * @param {Object} [options] - options.mode 'force' (kg, default) or
     *   'ratio' (× bodyweight)
     * @returns {boolean} False when there is nothing to draw
     */
    render(chartEl, legendEl, inputDatasets, options = {}) {
        const mode = options.mode === 'ratio' ? 'ratio' : 'force';
        chartEl.innerHTML = '';
        legendEl.innerHTML = '';
        if (!inputDatasets || inputDatasets.length === 0) return false;

        // Colours stay tied to the original order so a dataset keeps the
        // same colour in both charts, even if it's missing from one.
        const datasets = mode === 'ratio'
            ? this.toBodyweightSeries(inputDatasets)
            : inputDatasets.map((ds, i) => ({ ...ds, colorIndex: i }));
        if (datasets.length === 0) return false;

        const fits = datasets.map(ds => this.fitCurve(ds.repData, ds.unreliableReps || []));

        // Collect Y range
        let yVals = [];
        datasets.forEach(ds => ds.repData.forEach(r => { if (r.average > 0) yVals.push(r.average); }));
        fits.forEach(fit => {
            if (!fit) return;
            for (let x = 1; x <= 24; x++) yVals.push(this.eval(fit.a, fit.b, fit.c, x));
        });
        datasets.forEach(ds => yVals.push(ds.cf));
        if (yVals.length === 0) return false;

        const rawMin = Math.min(...yVals);
        const rawMax = Math.max(...yVals);
        const pad = (rawMax - rawMin) * 0.1 || 2;
        const yMin = rawMin - pad, yMax = rawMax + pad;

        const VW = 700, VH = 280, ML = 54, MR = 16, MT = 16, MB = 44;
        const CW = VW - ML - MR, CH = VH - MT - MB;
        const sx = x => ML + ((x - 1) / 23) * CW;
        const sy = y => MT + CH - ((y - yMin) / (yMax - yMin)) * CH;
        const ns = t => document.createElementNS('http://www.w3.org/2000/svg', t);

        const svg = ns('svg');
        svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
        svg.setAttribute('width', '100%');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

        // Grid + Y labels
        for (let i = 0; i <= 5; i++) {
            const yv = yMin + (yMax - yMin) * (i / 5);
            const gy = sy(yv);
            const g = ns('line');
            g.setAttribute('x1', ML); g.setAttribute('y1', gy);
            g.setAttribute('x2', ML + CW); g.setAttribute('y2', gy);
            g.setAttribute('stroke', '#2d2d2d'); g.setAttribute('stroke-width', '1');
            svg.appendChild(g);
            const t = ns('text');
            t.setAttribute('x', ML - 6); t.setAttribute('y', gy + 4);
            t.setAttribute('text-anchor', 'end'); t.setAttribute('fill', '#666');
            t.setAttribute('font-size', '11'); t.setAttribute('font-family', 'sans-serif');
            t.textContent = mode === 'ratio' ? yv.toFixed(2) : yv.toFixed(0);
            svg.appendChild(t);
        }

        // Y axis label
        const yl = ns('text');
        yl.setAttribute('transform', `rotate(-90)`);
        yl.setAttribute('x', -(MT + CH / 2)); yl.setAttribute('y', 13);
        yl.setAttribute('text-anchor', 'middle'); yl.setAttribute('fill', '#555');
        yl.setAttribute('font-size', '11'); yl.setAttribute('font-family', 'sans-serif');
        yl.textContent = mode === 'ratio' ? 'Force (× bodyweight)' : 'Force (kg)';
        svg.appendChild(yl);

        // X ticks + labels
        for (let rep = 1; rep <= 24; rep += 4) {
            const gx = sx(rep);
            const tk = ns('line');
            tk.setAttribute('x1', gx); tk.setAttribute('y1', MT + CH);
            tk.setAttribute('x2', gx); tk.setAttribute('y2', MT + CH + 5);
            tk.setAttribute('stroke', '#444'); tk.setAttribute('stroke-width', '1');
            svg.appendChild(tk);
            const lt = ns('text');
            lt.setAttribute('x', gx); lt.setAttribute('y', MT + CH + 18);
            lt.setAttribute('text-anchor', 'middle'); lt.setAttribute('fill', '#666');
            lt.setAttribute('font-size', '11'); lt.setAttribute('font-family', 'sans-serif');
            lt.textContent = rep;
            svg.appendChild(lt);
        }

        // X axis label
        const xl = ns('text');
        xl.setAttribute('x', ML + CW / 2); xl.setAttribute('y', VH - 4);
        xl.setAttribute('text-anchor', 'middle'); xl.setAttribute('fill', '#555');
        xl.setAttribute('font-size', '11'); xl.setAttribute('font-family', 'sans-serif');
        xl.textContent = 'Rep';
        svg.appendChild(xl);

        // Axis borders
        for (const [x1,y1,x2,y2] of [[ML,MT,ML,MT+CH],[ML,MT+CH,ML+CW,MT+CH]]) {
            const ax = ns('line');
            ax.setAttribute('x1',x1); ax.setAttribute('y1',y1);
            ax.setAttribute('x2',x2); ax.setAttribute('y2',y2);
            ax.setAttribute('stroke', '#444'); ax.setAttribute('stroke-width', '1');
            svg.appendChild(ax);
        }

        // Per dataset
        datasets.forEach((ds, i) => {
            const color = PALETTE[(ds.colorIndex ?? i) % PALETTE.length];
            const fit = fits[i];

            // Faded raw dots
            ds.repData.forEach((r, ri) => {
                if (r.average <= 0) return;
                const c = ns('circle');
                c.setAttribute('cx', sx(ri + 1)); c.setAttribute('cy', sy(r.average));
                c.setAttribute('r', '3'); c.setAttribute('fill', color);
                c.setAttribute('opacity', '0.25');
                svg.appendChild(c);
            });

            // CF dashed reference line
            const cy = sy(ds.cf);
            const cl = ns('line');
            cl.setAttribute('x1', ML); cl.setAttribute('y1', cy);
            cl.setAttribute('x2', ML + CW); cl.setAttribute('y2', cy);
            cl.setAttribute('stroke', color); cl.setAttribute('stroke-width', '1.5');
            cl.setAttribute('stroke-dasharray', '6,4'); cl.setAttribute('opacity', '0.6');
            svg.appendChild(cl);

            // Fitted curve
            if (fit) {
                let d = '';
                for (let x = 1; x <= 24; x += 0.25) {
                    const px = sx(x).toFixed(2), py = sy(this.eval(fit.a, fit.b, fit.c, x)).toFixed(2);
                    d += (x === 1 ? 'M' : 'L') + `${px},${py} `;
                }
                const path = ns('path');
                path.setAttribute('d', d.trim());
                path.setAttribute('stroke', color); path.setAttribute('stroke-width', '2.5');
                path.setAttribute('fill', 'none');
                svg.appendChild(path);
            }
        });

        chartEl.appendChild(svg);

        // HTML legend
        legendEl.innerHTML = datasets.map((ds, i) => {
            const color = PALETTE[(ds.colorIndex ?? i) % PALETTE.length];
            const cfText = mode === 'ratio'
                ? `CF ${ds.cf.toFixed(2)}× BW (${ds.bodyweight.toFixed(1)} kg)`
                : `CF ${ds.cf.toFixed(1)} kg`;
            return `<div class="legend-item">
                <span class="legend-swatch" style="background:${color}"></span>
                <span class="legend-label">${ds.name} · ${ds.hand}${ds.grip ? ' · ' + ds.grip : ''} · ${cfText}</span>
            </div>`;
        }).join('');

        return true;
    }
}
