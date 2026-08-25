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
import { store, saveTest, listTests, message } from '../store.js';
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

        // Store results for saving
        appData.results = Object.assign({}, r, {
            allReps: stateMachine.repData,
            allReadings: stateMachine.allReadings
        });

        /* The moment you most want the trace is straight after the
           test, before it has been saved anywhere. Build the same
           document the export would produce so the detail view has
           something to draw right now. */
        const now = new Date();
        this.lastTest = {
            id: 'live',
            name: appData.name,
            hand: handLabel,
            grip: GRIPS[appData.grip],
            date: now,
            cf: r.cf,
            cfRatio: r.ratio,
            bodyweight: appData.bodyweight,
            arcZone: r.arcZone,
            thresholdZone: r.thresholdZone,
            repData: stateMachine.repData,
            unreliableReps: r.unreliableReps,
            source: 'live',
            raw: buildExport(appData, stateMachine, appData.results, now)
        };
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
    this.on('viewReadingsBtn', 'click', () => this.showDetail('live'));
    /* Back goes where you came from, not always to the history — a
       test you have just finished is not in the history yet. */
    this.on('detailBack', 'click', () => this.showScreen(this.detailFrom === 'results' ? 'results' : 'history'));
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
    /* A selection only survives while its test is still on screen —
       otherwise the chart plots a line the list no longer shows. */
    this.selected = this.selected.filter(id => shown.some(d => d.id === id));
    /* Nothing chosen yet: show the most recent couple rather than an
       empty chart and a prompt. */
    if (!this.selected.length && shown.length) {
      this.selected = shown.slice(0, Math.min(2, shown.length)).map(d => d.id);
    }

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
      return this.renderHistoryChart();
    }

    shown.forEach(ds => {
      const idx = this.selected.indexOf(ds.id);
      const row = document.createElement('div');
      row.className = 'history-row' + (idx >= 0 ? ' selected' : '');
      if (idx >= 0) row.style.setProperty('--dot', PALETTE[idx % PALETTE.length]);

      /* Opening a test is the main thing you do to a row, so the row
         is the target for it. Adding one to the comparison chart is
         the narrower intention and gets its own small control — the
         first arrangement had these the other way round and the
         detail view was effectively hidden behind a chevron. */
      const cmp = document.createElement('button');
      cmp.type = 'button';
      cmp.className = 'history-cmp';
      cmp.setAttribute('aria-pressed', idx >= 0 ? 'true' : 'false');
      cmp.setAttribute('aria-label', `${idx >= 0 ? 'Remove' : 'Add'} ${ds.name} ${ds.hand} hand ${idx >= 0 ? 'from' : 'to'} the comparison chart`);
      cmp.title = 'Show on the comparison chart';
      cmp.addEventListener('click', () => this.toggleSelected(ds.id));

      const dot = document.createElement('span');
      dot.className = 'history-dot';
      cmp.appendChild(dot);

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'history-open';
      open.setAttribute('aria-label', `View every reading from ${ds.name}, ${ds.hand} hand`);
      open.addEventListener('click', () => this.showDetail(ds.id));

      const main = document.createElement('span');
      main.className = 'history-main';
      const who = document.createElement('span');
      who.className = 'history-who';
      who.textContent = ds.name + ' · ' + ds.hand;
      const when = document.createElement('span');
      when.className = 'history-when';
      when.textContent = [
        ds.date ? ds.date.toLocaleDateString() : '—',
        ds.grip,
        ds.source === 'file' ? 'not imported' : null
      ].filter(Boolean).join(' · ');
      main.append(who, when);

      const cf = document.createElement('span');
      cf.className = 'history-cf';
      cf.textContent = ds.cf.toFixed(1) + ' kg';

      const ratio = document.createElement('span');
      ratio.className = 'history-ratio';
      ratio.textContent = ds.cfRatio ? ds.cfRatio.toFixed(2) + 'x' : '—';

      /* Says what it does. A bare chevron is a promise the reader has
         to guess at, and this is the feature the screen exists for. */
      const go = document.createElement('span');
      go.className = 'history-go';
      go.textContent = 'View readings ›';

      open.append(main, cf, ratio, go);
      row.append(cmp, open);
      list.appendChild(row);
    });

    this.renderHistoryChart();
  }

  updateFilterSummary(shown, total) {
    const n = el('filterCount');
    if (n) n.textContent = shown === total ? `${total} test${total === 1 ? '' : 's'}` : `${shown} of ${total} tests`;
    const clear = el('filterClear');
    const f = this.filters || {};
    const active = !!(f.athlete || f.grip || f.hand || f.days);
    if (clear) clear.style.display = active ? '' : 'none';
  }

  renderHistoryChart() {
    const chart = el('historyChart');
    if (!chart) return;
    const chosen = (this.datasets || []).filter(d => (this.selected || []).includes(d.id));
    const section = el('historyChartSection');
    if (section) section.style.display = chosen.length ? 'block' : 'none';
    if (!chosen.length) return;

    overlayChart.render(chart, el('historyLegend'), chosen, { mode: 'force' });

    const ratioChart = el('historyRatioChart');
    if (ratioChart) {
      const hasRatio = overlayChart.render(ratioChart, el('historyRatioLegend'), chosen, { mode: 'ratio' });
      const rs = el('historyRatioSection');
      if (rs) rs.style.display = hasRatio ? 'block' : 'none';
    }
  }

  /* -- one test, close up ------------------------------------
     The history screen compares tests; this explains one. The chart
     is the raw trace with each rep's averaging window drawn on top of
     it, so the headline number stops being something you take on
     trust and becomes something you can see being measured. */
  /* Reachable from two places: a row in the history, and the results
     screen of a test that has only just finished and may not be in
     the history yet. */
  showDetail(id) {
    const ds = id === 'live'
      ? this.lastTest
      : (this.datasets || []).find(d => d.id === id);
    if (!ds) return;
    this.detail = ds;
    this.detailFrom = id === 'live' ? 'results' : 'history';
    this.showScreen('detail');
    const back = el('detailBack');
    if (back) back.textContent = this.detailFrom === 'results' ? '‹ Back to result' : '‹ Back to history';

    const set = (elId, text) => { const n = el(elId); if (n) n.textContent = text; };
    set('detailTitle', `${ds.name} · ${ds.hand} hand`);
    set('detailSubtitle', [
      ds.date ? ds.date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date unknown',
      ds.grip,
      ds.bodyweight ? `${ds.bodyweight} kg bodyweight` : null
    ].filter(Boolean).join(' · '));
    set('detailCf', `${ds.cf.toFixed(1)} kg`);
    set('detailRatio', ds.cfRatio ? `${ds.cfRatio.toFixed(2)}x` : '—');
    set('detailArc', ds.arcZone != null ? `${ds.arcZone.toFixed(1)} kg` : '—');
    set('detailThreshold', ds.thresholdZone ||
      (ds.arcZone != null ? `${ds.arcZone.toFixed(1)} - ${ds.cf.toFixed(1)} kg` : '—'));

    const trace = traceFor(ds.raw || {});
    const kind = traceChart.render(el('detailTrace'), trace, {
      cf: ds.cf, name: ds.name, hand: ds.hand, grip: ds.grip
    });

    /* Say which of the three kinds of record this is, rather than
       leaving a sparser chart looking like a worse test. */
    const note = el('detailNote');
    if (note) {
      note.textContent =
        kind === 'session' ? 'Every reading of the whole test, rests included. The orange bars are the 2–6s slice of each hang that the average is taken from.'
      : kind === 'reps'    ? 'This export kept each hang’s readings but nothing from the rests, so the reps are laid out in order at their nominal spacing — exact in force, approximate in time.'
      :                      'Recorded before the app kept raw readings.';
      note.style.display = '';
    }

    this.renderDetailReps(ds);
  }

  renderDetailReps(ds) {
    const host = el('detailReps');
    if (!host) return;
    host.replaceChildren();

    const reps = ds.repData || [];
    const max = Math.max(...reps.map(r => r.average || 0), 1);
    const cfReps = new Set(CONFIG.CF_REPS.map(i => i + 1));

    reps.forEach((r, i) => {
      const n = r.rep != null ? r.rep : i + 1;
      const row = document.createElement('div');
      row.className = 'rep-row'
        + (cfReps.has(n) ? ' cf-rep' : '')
        + (r.unreliable ? ' unreliable' : '');

      const label = document.createElement('span');
      label.className = 'rep-n';
      label.textContent = n;

      const track = document.createElement('span');
      track.className = 'rep-track';
      const fill = document.createElement('span');
      fill.className = 'rep-fill';
      /* A rep that averaged zero is missing data, not a rep at zero
         force — draw nothing rather than a bar on the floor. */
      fill.style.width = r.average > 0 ? `${(r.average / max) * 100}%` : '0';
      track.appendChild(fill);

      const val = document.createElement('span');
      val.className = 'rep-val';
      val.textContent = r.average > 0 ? `${r.average.toFixed(1)} kg` : 'no data';

      row.append(label, track, val);
      host.appendChild(row);
    });
  }
}
