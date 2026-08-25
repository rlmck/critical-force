import BluetoothScale from './bluetooth-scale.js';

// ── State ─────────────────────────────────────────────────────────────────────
const scale = new BluetoothScale();

const SESSION_S = 20 * 60;

let targetWeight         = 8;
let liveWeight           = 0;
let connected            = false;
let running              = false;
let phase                = 'idle';   // 'idle' | 'precount' | 'hang' | 'rest'
let reps                 = 0;
let elapsedStart         = null;
let elapsedTimer         = null;
let countdownTimer       = null;
let audioCtx             = null;
let phaseRemaining       = 0;
let sessionPaused        = false;
let userPaused           = false;
let hasLiveData          = false;
let pausedElapsedMs      = 0;
let pausedPhaseRemaining = 0;
let pausedPhase          = null;

const HANG_S = 7;
const REST_S = 3;

// ── DOM ───────────────────────────────────────────────────────────────────────
const connectBtn          = document.getElementById('connect-btn');
const elapsedEl           = document.getElementById('elapsed');
const weightNumberEl      = document.getElementById('weight-number');
const countdownEl         = document.getElementById('countdown');
const targetDisplayEl     = document.getElementById('target-display');
const repValEl            = document.getElementById('rep-val');
const startStopBtn        = document.getElementById('start-stop-btn');
const sessionControls     = document.getElementById('session-controls');
const pauseBtn            = document.getElementById('pause-btn');
const progressFill        = document.getElementById('progress-fill');
const gaugeFill           = document.getElementById('gauge-fill');
const markerUpper         = document.getElementById('marker-upper');
const markerTarget        = document.getElementById('marker-target');
const markerLower         = document.getElementById('marker-lower');
const mlabelUpper         = document.getElementById('mlabel-upper');
const mlabelTarget        = document.getElementById('mlabel-target');
const mlabelLower         = document.getElementById('mlabel-lower');
const disconnectOverlay   = document.getElementById('disconnect-overlay');
const disconnectMsg       = document.getElementById('disconnect-msg');
const disconnectSub       = document.getElementById('disconnect-sub');
const disconnectReconnect = document.getElementById('disconnect-reconnect');
const intervalLabelEl     = document.getElementById('interval-label');

// ── Audio ─────────────────────────────────────────────────────────────────────
function ctx() {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
}

function beep(freq, dur = 0.3) {
    const ac   = ctx();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.45, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.start();
    osc.stop(ac.currentTime + dur);
}

// ── Scale events ──────────────────────────────────────────────────────────────
window.addEventListener('scale:connected', () => {
    connected = true;
    connectBtn.textContent = 'Disconnect';
    connectBtn.classList.add('connected');
    connectBtn.disabled = false;
    if (sessionPaused) resumeAfterReconnect();
});

window.addEventListener('scale:disconnected', () => {
    connected = false;
    hasLiveData = false;
    liveWeight = 0;
    weightNumberEl.textContent = '--.-';
    gaugeFill.style.width = '0%';
    gaugeFill.style.background = 'rgba(255,255,255,0.2)';
    connectBtn.textContent = 'Connect Scale';
    connectBtn.classList.remove('connected');
    connectBtn.disabled = false;
    startStopBtn.disabled = true;
    if (running && !sessionPaused) pauseSession();
});

window.addEventListener('scale:weight', (e) => {
    liveWeight = e.detail.weight;
    if (!hasLiveData) {
        hasLiveData = true;
        if (!running) startStopBtn.disabled = false;
    }
    renderWeight();
});

window.addEventListener('scale:error', () => {
    connectBtn.disabled = false;
    if (sessionPaused) {
        disconnectMsg.textContent = 'Scale disconnected';
        disconnectSub.textContent = 'Tap to reconnect';
    }
});

// ── Gauge ─────────────────────────────────────────────────────────────────────
function fmtLabel(v) {
    // toFixed(1) when exact at 1dp, toFixed(2) for .25/.75 values
    return Math.round(v * 10) === v * 10 ? v.toFixed(1) : v.toFixed(2);
}

function updateGauge() {
    const maxKg   = targetWeight * 2;
    const fillPct = Math.min(100, Math.max(0, (liveWeight / maxKg) * 100));
    gaugeFill.style.width = `${fillPct}%`;

    const diff = liveWeight - targetWeight;
    if (connected && liveWeight > 0) {
        if (Math.abs(diff) <= 1)  gaugeFill.style.background = 'var(--green)';
        else if (diff < -1)       gaugeFill.style.background = 'var(--yellow)';
        else                      gaugeFill.style.background = 'var(--red)';
    } else {
        gaugeFill.style.background = 'rgba(255,255,255,0.2)';
    }

    // Marker positions from left (target is always 50%)
    const upperPct = Math.min(100, ((targetWeight + 1) / maxKg) * 100);
    const lowerPct = Math.max(0,   ((targetWeight - 1) / maxKg) * 100);
    markerUpper.style.left  = `${upperPct}%`;
    markerTarget.style.left = '50%';
    markerLower.style.left  = `${lowerPct}%`;

    mlabelUpper.textContent  = fmtLabel(targetWeight + 1);
    mlabelTarget.textContent = fmtLabel(targetWeight);
    mlabelLower.textContent  = fmtLabel(Math.max(0, targetWeight - 1));
}

// ── Weight display ────────────────────────────────────────────────────────────
function renderWeight() {
    weightNumberEl.textContent = liveWeight.toFixed(1);
    updateGauge();
}

// ── Target weight (0.25 kg steps) ────────────────────────────────────────────
document.getElementById('target-minus').addEventListener('click', () => {
    if (targetWeight > 0.25) {
        targetWeight = Math.round((targetWeight - 0.25) * 100) / 100;
        targetDisplayEl.textContent = targetWeight.toFixed(2);
        updateGauge();
    }
});
document.getElementById('target-plus').addEventListener('click', () => {
    targetWeight = Math.round((targetWeight + 0.25) * 100) / 100;
    targetDisplayEl.textContent = targetWeight.toFixed(2);
    updateGauge();
});

// ── Connect / Disconnect ──────────────────────────────────────────────────────
connectBtn.addEventListener('click', async () => {
    if (connected) {
        scale.disconnect();
    } else {
        connectBtn.textContent = 'Connecting…';
        connectBtn.disabled = true;
        scale.connect();
    }
});

// ── Start / Stop ──────────────────────────────────────────────────────────────
startStopBtn.addEventListener('click', () => startSession());

function startSession() {
    running = true;
    reps = 0;
    repValEl.textContent = '0';
    elapsedStart = null;
    startStopBtn.style.display = 'none';
    sessionControls.style.display = 'flex';
    beginPrecount();
}

function stopSession() {
    running = false;
    sessionPaused = false;
    userPaused = false;
    clearInterval(countdownTimer);
    clearInterval(elapsedTimer);
    disconnectOverlay.classList.remove('visible');
    setPhase('idle');
    startStopBtn.style.display = '';
    sessionControls.style.display = 'none';
    pauseBtn.textContent = 'Pause';
    countdownEl.textContent = '';
    intervalLabelEl.textContent = '';
    progressFill.style.width = '0%';
    if (audioCtx) audioCtx.resume();
}

// ── Phase transitions ─────────────────────────────────────────────────────────
function beginPrecount() {
    setPhase('precount');
    intervalLabelEl.textContent = 'GET READY';
    let remaining = 5;
    phaseRemaining = remaining;
    countdownEl.textContent = remaining;
    beep(880);
    countdownTimer = setInterval(() => {
        remaining--;
        phaseRemaining = remaining;
        if (remaining <= 0) {
            clearInterval(countdownTimer);
            elapsedStart = Date.now();
            elapsedTimer = setInterval(tickElapsed, 500);
            beginHang();
        } else {
            countdownEl.textContent = remaining;
            beep(880);
        }
    }, 1000);
}

function beginHang() {
    setPhase('hang');
    intervalLabelEl.textContent = 'HANG';
    beep(880);
    countdown(HANG_S, () => {
        reps++;
        repValEl.textContent = reps;
        beginRest();
    });
}

function beginRest() {
    setPhase('rest');
    intervalLabelEl.textContent = 'REST';
    beep(440);
    countdown(REST_S, () => beginHang());
}

function setPhase(p) {
    phase = p;
    document.body.className = `state-${p}`;
}

// ── Countdown ─────────────────────────────────────────────────────────────────
function countdown(seconds, onComplete) {
    clearInterval(countdownTimer);
    let remaining = seconds;
    phaseRemaining = remaining;
    countdownEl.textContent = remaining;

    countdownTimer = setInterval(() => {
        remaining--;
        phaseRemaining = remaining;
        countdownEl.textContent = remaining;
        if (remaining <= 0) {
            clearInterval(countdownTimer);
            onComplete();
        }
    }, 1000);
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────
function tickElapsed() {
    const secs = Math.floor((Date.now() - elapsedStart) / 1000);
    if (secs >= SESSION_S) {
        elapsedEl.textContent = '20:00';
        progressFill.style.width = '100%';
        stopSession();
        return;
    }
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    elapsedEl.textContent = `${m}:${s}`;
    progressFill.style.width = `${(secs / SESSION_S) * 100}%`;
}

// ── User pause / resume ───────────────────────────────────────────────────────
function userPause() {
    userPaused = true;
    clearInterval(countdownTimer);
    clearInterval(elapsedTimer);
    pausedElapsedMs      = elapsedStart ? Date.now() - elapsedStart : 0;
    pausedPhaseRemaining = phaseRemaining;
    pausedPhase          = phase;
    if (audioCtx) audioCtx.suspend();
    pauseBtn.textContent = 'Resume';
}

function userResume() {
    userPaused = false;
    if (audioCtx) audioCtx.resume();
    elapsedStart = Date.now() - pausedElapsedMs;
    elapsedTimer = setInterval(tickElapsed, 500);
    resumePhase();
    pauseBtn.textContent = 'Pause';
}

pauseBtn.addEventListener('click', () => {
    if (userPaused) userResume();
    else userPause();
});

document.getElementById('exit-btn').addEventListener('click', () => stopSession());

// ── Pause / Resume (BLE disconnect mid-session) ───────────────────────────────
function pauseSession() {
    sessionPaused = true;
    clearInterval(countdownTimer);
    clearInterval(elapsedTimer);
    // If user-paused, elapsed/phase state is already saved — don't overwrite
    if (!userPaused) {
        pausedElapsedMs      = elapsedStart ? Date.now() - elapsedStart : 0;
        pausedPhaseRemaining = phaseRemaining;
        pausedPhase          = phase;
    }
    userPaused = false;
    pauseBtn.textContent = 'Pause';
    disconnectOverlay.classList.add('visible');
}

function resumeAfterReconnect() {
    disconnectOverlay.classList.remove('visible');
    setPhase('precount');
    intervalLabelEl.textContent = 'GET READY';
    let remaining = 3;
    phaseRemaining = remaining;
    countdownEl.textContent = remaining;
    beep(880);
    countdownTimer = setInterval(() => {
        remaining--;
        phaseRemaining = remaining;
        if (remaining <= 0) {
            clearInterval(countdownTimer);
            sessionPaused = false;
            elapsedStart  = Date.now() - pausedElapsedMs;
            elapsedTimer  = setInterval(tickElapsed, 500);
            resumePhase();
        } else {
            countdownEl.textContent = remaining;
            beep(880);
        }
    }, 1000);
}

function resumePhase() {
    const resumeRemaining = Math.max(1, pausedPhaseRemaining);
    if (pausedPhase === 'rest') {
        setPhase('rest');
        intervalLabelEl.textContent = 'REST';
        beep(440);
        countdown(resumeRemaining, () => beginHang());
    } else {
        // hang or precount — resume as hang
        setPhase('hang');
        intervalLabelEl.textContent = 'HANG';
        beep(880);
        countdown(resumeRemaining, () => {
            reps++;
            repValEl.textContent = reps;
            beginRest();
        });
    }
}

// ── Disconnect overlay actions ────────────────────────────────────────────────
disconnectReconnect.addEventListener('click', () => {
    disconnectMsg.textContent = 'Connecting…';
    disconnectSub.textContent = '';
    scale.connect();
});

document.getElementById('disconnect-stop').addEventListener('click', () => {
    stopSession();
});

// ── Init ──────────────────────────────────────────────────────────────────────
updateGauge(); // position markers for default target weight
