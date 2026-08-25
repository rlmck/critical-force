/* == base.js -- everything both layouts do, done once. ==========

   The desktop and mobile pages are different markup and different
   CSS, but they are not different apps: a rep is averaged the same
   way and a result is saved the same way on both. That behaviour
   lives here, and each layout supplies the elements it acts on.

   The contract is element ids. Where both layouts have an element
   for the same idea it carries the same id, and where one has
   something the other does not -- a bottom nav, a signal light --
   the lookup simply misses and the code carries on. Hence el()
   below rather than getElementById everywhere: an optional element
   is normal here, not an error.
   ============================================================== */
import {
  CONFIG, GRIPS, States,
  stateMachine, scaleIntegration, audio, setView
} from '../engine.js';
import { PALETTE, OverlayChart, computeResults } from '../analysis.js';
import { buildExport, filenameFor, toDataset, traceFor, documentFor, download, titleCase } from '../results.js';
import { store, saveTest, listTests, deleteTest, message } from '../store.js';
import { TraceChart } from '../trace.js';

/* What the setup form is currently describing. */
export const appData = {
  name: '',
  bodyweight: 0,
  hand: 'left',
  grip: 'half-crimp',
  results: null
};

const overlayChart = new OverlayChart();
const traceChart = new TraceChart();

/* Optional by design -- see the note above. */
const el = id => document.getElementById(id);

export class BaseView {
    constructor() {
        this.currentScreen = 'setup';
        this.datasets = [];
        this.fileDatasets = [];
        this.selected = [];
        this.filters = {};
        this.setupEventListeners();
        this.bindFilters();

        /* The trace is drawn at the pixel width it was given, so a
           change of width needs a redraw rather than a stretch.

           Watching the list itself rather than the window: the window
           is not the only thing that can change a card's width, and on
           a phone it changes height constantly as the address bar
           comes and goes, which is not a reason to redraw ten charts.
           Only the charts are redrawn — rebuilding the list would lose
           the scroll position. */
        /* Two sources, one handler, because they cover different
           failures. ResizeObserver catches anything that changes a
           card's width — a scrollbar appearing, a layout change — but
           its callbacks are delivered during the rendering steps, so a
           backgrounded or non-compositing page never gets them. The
           window resize event has the opposite property: it fires
           regardless, but only for the window. Between them nothing is
           missed, and the debounce means a change seen by both costs
           one redraw. */
        const onWidthChange = () => {
            const w = Math.round((el('historyList') || {}).clientWidth || 0);
            if (!w || Math.abs(w - this._lastChartW) < 16) return;
            this._lastChartW = w;
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => this.redrawCharts(), 150);
        };
        this._lastChartW = 0;
        /* Kilograms or bodyweight-shares. See renderHistory for why the
           choice matters to a shared scale. */
        this._unit = 'kg';
        window.addEventListener('resize', onWidthChange);
        if (typeof ResizeObserver === 'function') {
            this._ro = new ResizeObserver(onWidthChange);
            const list = el('historyList');
            if (list) this._ro.observe(list);
        }
    }

    /* Bind only what this layout actually has. Desktop has a drag-and
       -drop target; a phone has no cursor to drag with and no window
       to drag from, so it doesn't. Neither absence is a bug, so
       neither throws. */
    on(id, event, fn) {
        const node = el(id);
        if (node) node.addEventListener(event, fn);
        return node;
    }

    setupEventListeners() {
        // Setup screen — each toggle group drives its own appData field
        document.querySelectorAll('.toggle-group').forEach(group => {
            group.addEventListener('click', (e) => {
                const btn = e.target.closest('.toggle-btn');
                if (!btn) return;
                group.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                appData[group.dataset.field] = btn.dataset.value;
            });
        });

        this.on('athleteName', 'input', (e) => {
            appData.name = e.target.value.trim();
            this.updateBeginButton();
        });

        this.on('connectBtn', 'click', async () => {
            const btn = el('connectBtn');
            btn.disabled = true;
            btn.textContent = 'Connecting...';

            const success = await scaleIntegration.connect();

            if (success) {
                this.updateScaleStatus(true);
            } else {
                btn.disabled = false;
                btn.textContent = 'Connect Scale';
                this.updateScaleStatus(false);
                this.toast('Could not reach the scale. Chrome needs the experimental web platform features flag for this to work at all.', true);
            }
        });

        this.on('bodyweight', 'input', (e) => {
            appData.bodyweight = parseFloat(e.target.value);
            this.updateBeginButton();
        });

        this.on('beginBtn',       'click', () => this.startTest());
        this.on('liveReadingBtn', 'click', () => this.showScreen('live'));
        this.on('resetMaxBtn',    'click', () => scaleIntegration.resetMax());
        this.on('backToSetupBtn', 'click', () => this.showScreen('setup'));
        this.on('retryBtn',       'click', () => this.resetToSetup());

        /* Saving takes a round trip, and a second press would file the
           test twice under the same id. Disable it while it runs. */
        this.on('saveBtn', 'click', async () => {
            const btn = el('saveBtn');
            btn.disabled = true;
            const label = btn.textContent;
            btn.textContent = 'Saving...';
            try {
                await this.saveResults();
            } finally {
                btn.disabled = false;
                btn.textContent = label;
            }
        });

        // Nav
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', () => this.showScreen(btn.dataset.screen));
        });

        this.on('fileInput', 'change', async (e) => {
            await this.handleFileUpload(e.target.files);
            e.target.value = '';
        });

        const uploadArea = el('uploadArea');
        if (uploadArea) {
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.classList.add('drag-over');
            });
            uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
            uploadArea.addEventListener('drop', async (e) => {
                e.preventDefault();
                uploadArea.classList.remove('drag-over');
                await this.handleFileUpload(e.dataTransfer.files);
            });
        }
    }

    updateScaleStatus(connected) {
        const dot = el('connectionDot');
        if (dot) dot.style.display = connected ? 'block' : 'none';
        const connectBtn = el('connectBtn');
        if (connectBtn) {
            connectBtn.disabled = connected;
            connectBtn.textContent = connected ? 'Scale Connected' : 'Connect Scale';
        }
        this.updateBeginButton();
    }

    updateBeginButton() {
        const scaleConnected = scaleIntegration.isConnected();
        const bodyweightValid = appData.bodyweight > 0;
        const nameValid = appData.name.length > 0;
        const begin = el('beginBtn');
        if (begin) begin.disabled = !(bodyweightValid && nameValid && scaleConnected);
        const live = el('liveReadingBtn');
        if (live) live.disabled = !scaleConnected;
    }

    startTest() {
        scaleIntegration.prepareForTest();
        scaleIntegration.startSignalMonitoring();
        stateMachine.reset();
        // Screen first, so the countdown's colour sweep starts on the visible stage
        this.showScreen('test');
        stateMachine.transition(States.COUNTDOWN);
    }

    /**
     * Drives the full-screen colour + sliding fill for a phase.
     * The sheet of colour rises through a pull and drains through
     * countdown/rest, so the direction alone reads as pull vs rest.
     */
    startPhaseVisual(state) {
        const phaseClass = {
            [States.COUNTDOWN]: 'phase-countdown',
            [States.HANGING]:   'phase-hanging',
            [States.REST]:      'phase-rest'
        }[state] || '';

        document.body.className = phaseClass;

        if (!phaseClass) {
            this.animateFill(0, 0, 0.4);
            return;
        }

        if (state === States.HANGING) {
            this.animateFill(0, 100, CONFIG.HANG_DURATION);
        } else if (state === States.REST) {
            this.animateFill(100, 0, CONFIG.REST_DURATION);
        } else {
            this.animateFill(100, 0, CONFIG.COUNTDOWN_DURATION);
        }

        // Replay the label entry animation on every phase change
        const label = el('stateLabel');
        if (label) {
            label.classList.remove('enter');
            void label.offsetWidth;
            label.classList.add('enter');
        }
    }

    animateFill(fromPct, toPct, seconds) {
        const fill = el('phaseFill');
        if (!fill) return;
        fill.style.transition = 'none';
        fill.style.height = `${fromPct}%`;
        void fill.offsetHeight; // flush the jump before the timed slide
        fill.style.transition = `height ${seconds}s linear, background 0.45s ease`;
        fill.style.height = `${toPct}%`;
    }

    showScreen(screenName) {
        this.currentScreen = screenName;
        document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
        const screen = el(`${screenName}Screen`);
        if (screen) screen.classList.add('active');

        // Phase colours only belong to the test screen
        if (screenName !== 'test') document.body.className = '';

        /* A test in progress owns the whole screen. Nothing to
           navigate to while somebody is hanging off an edge. */
        const nav = el('mainNav');
        if (nav) nav.classList.toggle('visible', screenName !== 'test');
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.screen === screenName);
        });

        /* Read the history when it is opened, not on page load. It is
           a network round trip for a screen most visits never look
           at, and it should be fresh when it is. */
        if (screenName === 'history') this.loadHistory();
    }

    render() {
        if (this.currentScreen === 'test') {
            this.renderTestScreen();
        }
    }

    renderTestScreen() {
        const repEl = el('repDisplay');
        const timerEl = el('timerDisplay');
        const stateEl = el('stateLabel');

        // Update rep display
        if (repEl) {
            repEl.textContent = stateMachine.state === States.COUNTDOWN
                ? `${appData.name} · ${appData.hand} · ${GRIPS[appData.grip]}`
                : `Rep ${stateMachine.currentRep + 1} / ${CONFIG.TOTAL_REPS}`;
        }

        // Update timer
        if (timerEl) timerEl.textContent = stateMachine.timeRemaining;

        // Update state label (colour comes from the phase stage, not the label)
        if (stateEl) {
            stateEl.textContent = {
                [States.COUNTDOWN]: 'GET READY',
                [States.HANGING]:   'PULL',
                [States.REST]:      'REST'
            }[stateMachine.state] || stateEl.textContent;
        }

        // Update live weight display
        const liveWeightEl = el('liveWeight');
        if (liveWeightEl) {
            liveWeightEl.style.visibility = stateMachine.state === States.HANGING ? 'visible' : 'hidden';
        }

        // Update chart
        this.renderLiveChart();

        // If test is complete, show results
        if (stateMachine.state === States.COMPLETE) {
            scaleIntegration.stopSignalMonitoring();
            scaleIntegration.restoreDefaults();
            this.showResults();
        }
    }

    renderLiveChart() {
        const chartEl = el('liveChart');
        if (!chartEl) return;
        chartEl.replaceChildren();

        const maxForce = Math.max(...stateMachine.repData.map(r => r.average), 1);

        for (let i = 0; i < CONFIG.TOTAL_REPS; i++) {
            const bar = document.createElement('div');
            bar.className = 'bar';

            if (CONFIG.CF_REPS.includes(i)) {
                bar.classList.add('cf-rep');
            }

            if (i < stateMachine.repData.length) {
                const repData = stateMachine.repData[i];
                const height = (repData.average / maxForce) * 100;
                bar.style.height = `${height}%`;

                if (repData.unreliable) {
                    bar.classList.add('unreliable');
                }
            }

            chartEl.appendChild(bar);
        }
    }

    updateLiveReadingDisplay(weight, max) {
        if (this.currentScreen === 'live') {
            const now = el('liveCurrentWeight'), peak = el('liveMaxWeight');
            if (now)  now.textContent  = `${weight.toFixed(1)} kg`;
            if (peak) peak.textContent = `${max.toFixed(1)} kg`;
        }
    }

    updateLiveWeight(weight) {
        if (stateMachine.state === States.HANGING) {
            const liveWeightEl = el('liveWeight');
            if (!liveWeightEl) return;
            const elapsed = Date.now() - stateMachine.hangStartTime;
            if (elapsed >= CONFIG.WINDOW_START_MS && elapsed <= CONFIG.WINDOW_END_MS && stateMachine.currentAverage > 0) {
                liveWeightEl.textContent = `${weight.toFixed(1)} kg (Avg: ${stateMachine.currentAverage.toFixed(1)} kg)`;
            } else {
                liveWeightEl.textContent = `${weight.toFixed(1)} kg`;
            }
        }
    }

    updateSignalIndicator(show) {
        const indicator = el('signalIndicator');
        if (!indicator) return;
        if (show) {
            indicator.classList.add('visible');
        } else {
            indicator.classList.remove('visible');
        }
    }

    showResults() {
        this.showScreen('results');

        /* Worked out in analysis.js, not here. The same function reads
           a test back out of the database, so a result on screen
           tonight and the same result in the history next month cannot
           drift apart. */
        const r = computeResults(stateMachine.repData, appData.bodyweight);
        const handLabel = titleCase(appData.hand);

        const set = (id, text) => { const n = el(id); if (n) n.textContent = text; };
        set('resultsSubtitle',
            `${appData.name} · ${handLabel} hand · ${GRIPS[appData.grip]} · ${stateMachine.allReadings.length} readings captured`);
        set('cfDisplay', `Critical Force: ${r.cf.toFixed(1)} kg`);
        /* No bodyweight, no ratio — and an em dash says so rather than
           NaN or a confident 0.00x. */
        set('ratioValue', r.ratio == null ? '—' : `${r.ratio.toFixed(2)}x`);
        set('arcValue', `${r.arcZone.toFixed(1)} kg`);
        set('thresholdValue', r.thresholdZone);

        const warnBox = el('resultsWarning');
        if (warnBox) {
            warnBox.textContent = r.unreliableReps.length
                ? `${r.unreliableReps.length} rep(s) had fewer than ${CONFIG.MIN_VALID_READINGS} valid readings, shown in amber. Reps: ${r.unreliableReps.join(', ')}`
                : '';
            warnBox.style.display = r.unreliableReps.length ? '' : 'none';
        }

        const repBox = el('cfRepValues');
        if (repBox) {
            repBox.replaceChildren();
            r.cfRepData.forEach((repData, idx) => {
                const line = document.createElement('div');
                line.textContent = `Rep ${CONFIG.CF_REPS[idx] + 1}: ${repData.average.toFixed(1)} kg` +
                                   (repData.unreliable ? ' (unreliable)' : '');
                repBox.appendChild(line);
            });
        }

        this.renderResultsChart(r.cf);

        // Store results for saving
        appData.results = Object.assign({}, r, {
            allReps: stateMachine.repData,
            allReadings: stateMachine.allReadings
        });

        /* The trace, drawn from the same document the export would
           write — which is why the results above have to be stored
           first. It is the chart worth looking at straight after a
           test, so it is on the screen rather than behind a button. */
        const liveDoc = buildExport(appData, stateMachine, appData.results, new Date());
        traceChart.render(el('resultsTrace'), traceFor(liveDoc), {
            cf: r.cf, name: appData.name, hand: handLabel,
            cfReps: CONFIG.CF_REPS.map(i => i + 1)
        });

        const currentDataset = {
            name: appData.name,
            hand: handLabel,
            grip: GRIPS[appData.grip],
            cf: r.cf,
            cfRatio: r.ratio,
            bodyweight: appData.bodyweight,
            repData: stateMachine.repData,
            unreliableReps: r.unreliableReps
        };
        const chart = el('resultsOverlayChart');
        if (chart) {
            overlayChart.render(chart, el('resultsOverlayLegend'), [currentDataset]);
            const ratioChart = el('resultsRatioChart');
            if (ratioChart) {
                const hasRatio = overlayChart.render(ratioChart, el('resultsRatioLegend'), [currentDataset], { mode: 'ratio' });
                const rs = el('resultsRatioSection');
                if (rs) rs.style.display = hasRatio ? '' : 'none';
            }
        }

    }

    renderResultsChart(cf) {
        const chartEl = el('resultsChart');
        if (!chartEl) return;
        chartEl.replaceChildren();

        const maxForce = Math.max(...stateMachine.repData.map(r => r.average));
        const cfLinePosition = (cf / maxForce) * 100;

        // Position CF line
        const cfLine = el('cfLine');
        if (cfLine) {
            cfLine.style.bottom = `${cfLinePosition}%`;
            cfLine.replaceChildren();
            const tag = document.createElement('span');
            tag.className = 'cf-line-label';
            tag.textContent = `CF: ${cf.toFixed(1)} kg`;
            cfLine.appendChild(tag);
        }

        // Render bars
        for (let i = 0; i < stateMachine.repData.length; i++) {
            const repData = stateMachine.repData[i];
            const bar = document.createElement('div');
            bar.className = 'bar';

            if (CONFIG.CF_REPS.includes(i)) {
                bar.classList.add('cf-rep');
            }

            if (repData.unreliable) {
                bar.classList.add('unreliable');
            }

            const height = (repData.average / maxForce) * 100;
            bar.style.height = `${height}%`;

            chartEl.appendChild(bar);
        }
    }
    resetToSetup() {
        stateMachine.reset();
        scaleIntegration.stopSignalMonitoring();
        scaleIntegration.restoreDefaults();
        this.showScreen('setup');
    }

  /* -- saving ------------------------------------------------
     Two destinations, and they are not alternatives. The database is
     where the history screen reads from; the file is what gets
     uploaded into Coach, and it is also the only copy if the network
     picked this moment to go. Four minutes of hanging does not come
     round again, so the file is written whatever the database did. */
  async saveResults() {
    const now  = new Date();
    const test = { name: appData.name, hand: appData.hand, grip: appData.grip };
    const filename = filenameFor(test, now);
    const data = buildExport(appData, stateMachine, appData.results, now);

    let saved = null, saveError = null;
    if (store.available) {
      try {
        saved = await saveTest(data);
      } catch (err) {
        console.error('Failed to save test:', err);
        saveError = message(err);
      }
    }

    let downloaded = false;
    try {
      download(data, filename);
      downloaded = true;
    } catch (err) {
      console.error('Failed to download results:', err);
    }

    /* Say which of the two actually happened, rather than "saved". */
    if (saved && downloaded)  this.toast('Saved to history, and downloaded as ' + filename + '.');
    else if (saved)           this.toast('Saved to history. The download failed - see the console.');
    else if (saveError)       this.toast('Not saved to history: ' + saveError + (downloaded ? ' Downloaded as ' + filename + '.' : ''), true);
    else if (downloaded)      this.toast('Downloaded as ' + filename + '.');
    else                      this.toast('Nothing was saved. See the console.', true);

    /* The history is now one test out of date. */
    this.datasets = [];
    this.selected = [];
  }

  /* A message that does not stop the world. alert() blocks, and the
     scale keeps streaming while it does. */
  toast(text, isError) {
    const box = el('toast');
    if (!box) { console.log('[toast]', text); return; }
    box.textContent = text;
    box.classList.toggle('error', !!isError);
    box.classList.add('shown');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => box.classList.remove('shown'), 6000);
  }

  /* -- history -----------------------------------------------
     Tests out of the database, plus anything dropped on the page.
     Files are kept because a test recorded before this app had a
     database, or on somebody else's machine, is still a test worth
     laying over the top of tonight's. */
  async loadHistory() {
    const list = el('historyList');
    if (!list) return;
    if (!store.available) {
      this.datasets = (this.fileDatasets || []).slice();
      /* Say which kind of nowhere this is. "No database configured" is
         a different problem from "the database is there but refuses
         everyone", and only one of them is something you can fix. */
      return this.renderHistory(store.fatal
        ? `${message(store.fatal)} Drop result files here to read them in the meantime.`
        : 'No database configured — drop result files here to compare them.');
    }
    this.renderHistoryStatus('Loading...');
    try {
      const fromDb = await listTests();
      this.datasets = fromDb.concat(this.fileDatasets || []);
      this.renderHistory(fromDb.length ? null : 'No tests saved yet. Drop old result files here to bring them in.');
    } catch (err) {
      console.error('Failed to load history:', err);
      this.datasets = (this.fileDatasets || []).slice();
      this.renderHistory(message(err));
    }
  }

  async handleFileUpload(fileList) {
    if (!fileList || fileList.length === 0) return;
    this.fileDatasets = this.fileDatasets || [];
    const errors = [];
    let added = 0;
    for (const file of fileList) {
      try {
        const json = JSON.parse(await file.text());
        const ds = toDataset(json, 'file', file.name);
        ds.id = 'file:' + file.name;
        const at = this.fileDatasets.findIndex(d => d.id === ds.id);
        if (at >= 0) this.fileDatasets[at] = ds; else this.fileDatasets.push(ds);
        added++;
      } catch (err) {
        errors.push(file.name + ': ' + err.message);
      }
    }
    await this.loadHistory();
    if (errors.length) this.toast(errors.join(' · '), true);
    else if (added) this.toast(`Read ${added} file${added > 1 ? 's' : ''}. Use "Import to database" to keep ${added > 1 ? 'them' : 'it'}.`);
  }

  /* -- importing old tests -----------------------------------
     A file dropped on the page is readable straight away but lives
     only until the tab closes. This is what makes it permanent.

     The document id is built from the test's own timestamp, so
     importing the same file twice corrects the record rather than
     doubling it, and a half-finished import can simply be run again. */
  async importFiles() {
    const pending = (this.fileDatasets || []).filter(d => !d.imported);
    if (!pending.length) return this.toast('Nothing to import — drop result files here first.');
    if (!store.available) return this.toast('No database configured, so there is nowhere to import to.', true);

    const btn = el('importBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }

    let ok = 0;
    const failed = [];
    for (const ds of pending) {
      try {
        await saveTest(documentFor(ds));
        ds.imported = true;
        ok++;
      } catch (err) {
        console.error('Import failed for', ds.id, err);
        failed.push(`${ds.name} ${ds.hand}: ${message(err)}`);
      }
    }

    if (btn) { btn.disabled = false; btn.textContent = 'Import to database'; }

    /* Imported tests now exist twice in the list — once as a file and
       once out of the database. Drop the file copies and re-read. */
    if (ok) {
      this.fileDatasets = (this.fileDatasets || []).filter(d => !d.imported);
      this.selected = [];
      await this.loadHistory();
    }

    if (ok && !failed.length) this.toast(`Imported ${ok} test${ok > 1 ? 's' : ''}.`);
    else if (ok) this.toast(`Imported ${ok}, failed ${failed.length}: ${failed[0]}`, true);
    else this.toast(`Import failed: ${failed[0]}`, true);
  }

  /* -- filters -----------------------------------------------
     Options come from the tests actually present rather than a fixed
     vocabulary: the grips on record are the authority, not the two
     this app happens to offer today. */
  filtered() {
    const f = this.filters || {};
    const now = Date.now();
    return (this.datasets || []).filter(ds => {
      if (f.athlete && ds.name !== f.athlete) return false;
      if (f.grip && ds.grip !== f.grip) return false;
      if (f.hand && ds.hand !== f.hand) return false;
      if (f.days) {
        if (!ds.date) return false;
        if (now - ds.date.getTime() > f.days * 86400000) return false;
      }
      return true;
    });
  }

  refreshFilterOptions() {
    const distinct = key => [...new Set((this.datasets || []).map(d => d[key]).filter(Boolean))].sort();
    const fill = (id, values, current) => {
      const sel = el(id);
      if (!sel) return;
      sel.replaceChildren();
      const any = document.createElement('option');
      any.value = '';
      any.textContent = sel.dataset.anyLabel || 'All';
      sel.appendChild(any);
      values.forEach(v => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v;
        sel.appendChild(o);
      });
      /* Keep a chosen value that is still on offer; drop one that is
         not, so a filter can never hide everything with no way back. */
      sel.value = values.includes(current) ? current : '';
    };
    this.filters = this.filters || {};
    fill('filterAthlete', distinct('name'), this.filters.athlete);
    fill('filterGrip',    distinct('grip'), this.filters.grip);
    fill('filterHand',    distinct('hand'), this.filters.hand);
    this.filters.athlete = el('filterAthlete') ? el('filterAthlete').value : '';
    this.filters.grip    = el('filterGrip')    ? el('filterGrip').value    : '';
    this.filters.hand    = el('filterHand')    ? el('filterHand').value    : '';
  }

  bindFilters() {
    this.filters = this.filters || {};
    ['filterAthlete', 'filterGrip', 'filterHand'].forEach(id => {
      this.on(id, 'change', () => {
        this.filters.athlete = el('filterAthlete') ? el('filterAthlete').value : '';
        this.filters.grip    = el('filterGrip')    ? el('filterGrip').value    : '';
        this.filters.hand    = el('filterHand')    ? el('filterHand').value    : '';
        this.renderHistory();
      });
    });
    this.on('filterDate', 'change', e => {
      this.filters.days = e.target.value ? Number(e.target.value) : null;
      this.renderHistory();
    });
    this.on('filterClear', 'click', () => {
      this.filters = {};
      ['filterAthlete', 'filterGrip', 'filterHand', 'filterDate'].forEach(id => {
        const n = el(id); if (n) n.value = '';
      });
      this.renderHistory();
    });
    this.on('importBtn', 'click', () => this.importFiles());
    /* The drop zone no longer takes up the top of the screen, so the
       browse affordance moved to the header beside it. */
    this.on('addFilesBtn', 'click', () => { const i = el('fileInput'); if (i) i.click(); });

    /* Kilograms or bodyweight-shares, redrawn in place. */
    document.querySelectorAll('[data-unit]').forEach(btn => {
      btn.addEventListener('click', () => {
        this._unit = btn.dataset.unit;
        document.querySelectorAll('[data-unit]').forEach(b =>
          b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'));
        this.renderHistory();
      });
    });
  }

  renderHistoryStatus(text) {
    const list = el('historyList');
    if (!list) return;
    list.replaceChildren();
    const p = document.createElement('div');
    p.className = 'history-empty';
    p.textContent = text;
    list.appendChild(p);
  }

  /* Selection drives the chart: at most PALETTE.length tests
     overlaid, because a fifth line stops being a comparison and
     starts being a thicket. */
  toggleSelected(id) {
    this.selected = this.selected || [];
    const at = this.selected.indexOf(id);
    if (at >= 0) this.selected.splice(at, 1);
    else {
      if (this.selected.length >= PALETTE.length) this.selected.shift();
      this.selected.push(id);
    }
    this.renderHistory();
  }

  /* -- the history, as charts -------------------------------
     A list of names with a link to a graph is a list of promises.
     Every test on this screen draws its own trace, in place, because
     the trace is the thing you came to look at. */
  renderHistory(status) {
    const list = el('historyList');
    if (!list) return;
    this.datasets = this.datasets || [];

    if (status && !this.datasets.length) {
      this.refreshFilterOptions();
      this.updateFilterSummary(0, 0);
      return this.renderHistoryStatus(status);
    }

    this.refreshFilterOptions();
    const shown = this.filtered();
    this.updateFilterSummary(shown.length, this.datasets.length);

    this.selected = this.selected || [];
    /* A selection only survives while its test is on screen, or the
       overlay plots a line the page no longer shows. */
    this.selected = this.selected.filter(id => shown.some(d => d.id === id));

    const importable = (this.fileDatasets || []).length;
    const importBtn = el('importBtn');
    if (importBtn) {
      importBtn.style.display = importable ? '' : 'none';
      importBtn.textContent = `Import ${importable} file${importable > 1 ? 's' : ''} to database`;
    }

    list.replaceChildren();
    if (!shown.length) {
      const p = document.createElement('div');
      p.className = 'history-empty';
      p.textContent = 'No tests match these filters.';
      list.appendChild(p);
      return this.renderOverlay();
    }

    /* One y-scale across the whole screen. Stacked charts imply they
       can be compared, and scaling each to its own maximum destroys
       that — a 10 kg critical force and a 25 kg one would sit at the
       same height on two cards an inch apart.

       In kilograms, though, the heaviest athlete sets the ceiling for
       everyone: a 60 kg scale leaves a 12 kg critical force using a
       fifth of its plot. Per bodyweight they all land in the same
       range, which is also the comparison worth making between people
       of different mass — hence the toggle. */
    const ratio = this._unit === 'bw';
    const per = d => (ratio && d.bodyweight > 0 ? d.bodyweight : 1);
    const peak = Math.max(...shown.map(d => Math.max(
      (d.cf || 0) / per(d),
      ...(d.repData || []).map(r => (r.average || 0) / per(d))
    )), ratio ? 0.05 : 1);
    const yMax = ratio
      ? Math.ceil(peak / 0.1) * 0.1
      : Math.ceil(peak / 10) * 10;

    /* Two passes on purpose. The chart measures the width it has been
       given, and a card that is not in the document yet has none — so
       every card is inserted first and the charts drawn second. */
    const pending = shown.map(ds => {
      const card = this.testCard(ds, yMax, ratio ? per(ds) : 1);
      list.appendChild(card);
      return card;
    });
    this._cards = pending;
    this._lastChartW = Math.round(list.clientWidth || 0);
    pending.forEach(card => card._drawChart && card._drawChart());
    this.renderOverlay();
  }

  /* One test: who, the numbers, and its trace. */
  testCard(ds, yMax, divisor) {
    const idx = (this.selected || []).indexOf(ds.id);
    const card = document.createElement('article');
    card.className = 'test-card' + (idx >= 0 ? ' selected' : '');
    if (idx >= 0) card.style.setProperty('--dot', PALETTE[idx % PALETTE.length]);

    // ── head ──────────────────────────────────────────────
    const head = document.createElement('header');
    head.className = 'test-head';

    const id = document.createElement('div');
    id.className = 'test-id';
    const who = document.createElement('h3');
    who.className = 'test-who';
    who.textContent = `${ds.name} · ${ds.hand}`;
    const meta = document.createElement('p');
    meta.className = 'test-meta';
    meta.textContent = [
      ds.date ? ds.date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : 'Date unknown',
      ds.grip,
      ds.bodyweight ? `${ds.bodyweight} kg` : null,
      ds.source === 'file' ? 'not imported' : null
    ].filter(Boolean).join(' · ');
    id.append(who, meta);

    const nums = document.createElement('div');
    nums.className = 'test-nums';
    const cf = document.createElement('span');
    cf.className = 'test-cf';
    cf.innerHTML = '';
    cf.textContent = `${ds.cf.toFixed(1)} kg`;
    const cfLab = document.createElement('span');
    cfLab.className = 'test-cf-label';
    cfLab.textContent = ds.cfRatio ? `critical force · ${ds.cfRatio.toFixed(2)}× bodyweight` : 'critical force';
    nums.append(cf, cfLab);

    // ── actions ───────────────────────────────────────────
    const actions = document.createElement('div');
    actions.className = 'test-actions';

    const cmp = document.createElement('button');
    cmp.type = 'button';
    cmp.className = 'test-cmp';
    cmp.setAttribute('aria-pressed', idx >= 0 ? 'true' : 'false');
    cmp.textContent = idx >= 0 ? 'Comparing' : 'Compare';
    cmp.addEventListener('click', () => this.toggleSelected(ds.id));

    /* Two presses, and the second one says what it is about to do. A
       test takes four minutes and cannot be repeated, so a stray press
       and an extra press do not cost the same. */
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'test-del';
    del.textContent = 'Delete';
    del.addEventListener('click', () => this.pressDelete(del, ds));

    actions.append(cmp, del);
    head.append(id, nums, actions);
    card.appendChild(head);

    // ── the chart ─────────────────────────────────────────
    const chartBox = document.createElement('div');
    /* The same class the results screen uses, so the chart is styled
       and positioned by one rule rather than two that can drift. The
       CF label is positioned against this box, so it must be the one
       carrying position:relative. */
    chartBox.className = 'trace-container';
    card.appendChild(chartBox);

    const trace = traceFor(ds.raw || {});

    if (this._unit === 'bw' && !(ds.bodyweight > 0)) {
      const chip = document.createElement('span');
      chip.className = 'test-chip';
      chip.textContent = 'no bodyweight';
      chip.title = 'This test recorded no bodyweight, so it cannot be shown per bodyweight. The chart below is in kilograms.';
      who.appendChild(chip);
    }

    /* Say which of the three kinds of record this is, so a sparser
       chart does not read as a worse test. */
    if (trace.kind !== 'session') {
      const chip = document.createElement('span');
      chip.className = 'test-chip';
      chip.textContent = trace.kind === 'reps' ? 'hangs only' : 'averages only';
      chip.title = trace.kind === 'reps'
        ? 'This export kept each hang but nothing from the rests, so the reps sit at their nominal spacing — exact in force, approximate in time.'
        : 'This export kept no raw readings, only the per-rep averages. The orange marks are the whole record.';
      who.appendChild(chip);
    }


    card._drawChart = () => traceChart.render(chartBox, trace, {
      cf: ds.cf, name: ds.name, hand: ds.hand, yMax,
      divisor: divisor || 1,
      cfReps: CONFIG.CF_REPS.map(i => i + 1)
    });

    return card;
  }

  /* -- deleting ---------------------------------------------- */
  async pressDelete(btn, ds) {
    if (this._armed && this._armed !== btn) this.disarm(this._armed);

    if (!btn.dataset.armed) {
      btn.dataset.armed = '1';
      btn.textContent = 'Really delete?';
      btn.classList.add('armed');
      this._armed = btn;
      clearTimeout(this._armTimer);
      /* Disarms itself, so a half-pressed delete is not left waiting
         to catch the next tap. */
      this._armTimer = setTimeout(() => this.disarm(btn), 5000);
      return;
    }

    this.disarm(btn);

    if (ds.source === 'file') {
      this.fileDatasets = (this.fileDatasets || []).filter(d => d.id !== ds.id);
      await this.loadHistory();
      return this.toast(`Removed ${ds.name} ${ds.hand} from this session. The file itself is untouched.`);
    }

    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      await deleteTest(ds.id);
      this.datasets = (this.datasets || []).filter(d => d.id !== ds.id);
      this.selected = (this.selected || []).filter(x => x !== ds.id);
      await this.loadHistory();
      this.toast(`Deleted ${ds.name} · ${ds.hand} hand, ${ds.date ? ds.date.toLocaleDateString() : 'undated'}.`);
    } catch (err) {
      console.error('Delete failed:', err);
      btn.disabled = false;
      btn.textContent = 'Delete';
      this.toast(`Could not delete that test: ${message(err)}`, true);
    }
  }

  disarm(btn) {
    clearTimeout(this._armTimer);
    if (this._armed === btn) this._armed = null;
    if (!btn) return;
    delete btn.dataset.armed;
    btn.classList.remove('armed');
    btn.textContent = 'Delete';
  }

  /* Redraw every visible chart at the width it now has, without
     touching the rest of the DOM. */
  redrawCharts() {
    (this._cards || []).forEach(card => {
      if (card.isConnected && card._drawChart) card._drawChart();
    });
  }

  updateFilterSummary(shown, total) {
    const n = el('filterCount');
    if (n) n.textContent = shown === total ? `${total} test${total === 1 ? '' : 's'}` : `${shown} of ${total} tests`;
    const clear = el('filterClear');
    const f = this.filters || {};
    if (clear) clear.style.display = (f.athlete || f.grip || f.hand || f.days) ? '' : 'none';
  }

  /* -- comparing ----------------------------------------------
     The decay curves of the chosen tests, laid over each other. This
     is the one chart that is about several tests rather than one, so
     it sits above the list rather than inside it. */
  renderOverlay() {
    const chart = el('historyChart');
    if (!chart) return;
    const chosen = (this.datasets || []).filter(d => (this.selected || []).includes(d.id));
    const section = el('historyChartSection');
    if (section) section.style.display = chosen.length >= 1 ? 'block' : 'none';
    if (!chosen.length) return;

    overlayChart.render(chart, el('historyLegend'), chosen, { mode: 'force' });

    const ratioChart = el('historyRatioChart');
    if (ratioChart) {
      const hasRatio = overlayChart.render(ratioChart, el('historyRatioLegend'), chosen, { mode: 'ratio' });
      const rs = el('historyRatioSection');
      if (rs) rs.style.display = hasRatio ? 'block' : 'none';
    }
  }
}
