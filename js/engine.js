/* ═══════════════════════════════════════════════════════════════
   engine.js — the test itself: the protocol, the arithmetic, and
   the scale.

   Everything here is what a critical-force test *is*, and none of it
   knows what a screen looks like. The two layouts share this file
   exactly, so a change to the protocol or to how a rep is averaged
   lands in both by construction rather than by being remembered
   twice.

   A layout hands itself in through setView(). Six calls, listed on
   the View shape below — the engine never reaches for an element.
   ═══════════════════════════════════════════════════════════════ */
import BluetoothScale from '../bluetooth-scale.js';

/* ── the view ───────────────────────────────────────────────
   What a layout has to provide. Anything missing is a no-op rather
   than a crash: a mobile view with no signal indicator should not
   take the test down with it. */
const NOOP = () => {};
let view = {
  render: NOOP,               /* state, rep or timer changed */
  startPhaseVisual: NOOP,     /* (phase, seconds) — a new phase began */
  updateLiveWeight: NOOP,     /* (kg) — during a hang */
  updateLiveReadingDisplay: NOOP, /* (kg, max) — the live-reading screen */
  updateScaleStatus: NOOP,    /* (connected) */
  updateSignalIndicator: NOOP /* (weak) — packets have stopped arriving */
};

export function setView(v) {
  view = Object.assign({
    render: NOOP, startPhaseVisual: NOOP, updateLiveWeight: NOOP,
    updateLiveReadingDisplay: NOOP, updateScaleStatus: NOOP,
    updateSignalIndicator: NOOP
  }, v);
}

/* ── configuration ──────────────────────────────────────── */
export const CONFIG = {
    TOTAL_REPS: 24,
    COUNTDOWN_DURATION: 10,
    HANG_DURATION: 7,
    REST_DURATION: 3,
    NOISE_THRESHOLD: 1.0,
    SIGNAL_TIMEOUT: 3000,
    CF_REPS: [21, 22, 23], // 0-indexed: reps 22, 23, 24
    WINDOW_START_MS: 2000, // Start of averaging window (2 seconds)
    WINDOW_END_MS: 6000,   // End of averaging window (6 seconds)
    MIN_VALID_READINGS: 3, // Minimum readings for reliable rep
};

export const GRIPS = {
    'half-crimp':    'Half Crimp',
    '3-finger-drag': '3 Finger Drag'
};

/* ── the protocol as a state machine ────────────────────── */
export const States = {
    IDLE: 'IDLE',
    COUNTDOWN: 'COUNTDOWN',
    HANGING: 'HANGING',
    REST: 'REST',
    COMPLETE: 'COMPLETE'
};

export class StateMachine {
    constructor() {
        this.state = States.IDLE;
        this.currentRep = 0;
        this.timeRemaining = 0;
        this.repData = [];
        this.currentReadings = [];
        this.currentFilteredReadings = [];
        this.hangStartTime = 0;
        this.currentAverage = 0;
        this.timer = null;
        // Every reading the scale emits between test start and completion,
        // regardless of phase or noise threshold.
        this.sessionStartTime = 0;
        this.allReadings = [];
    }

    transition(newState) {
        console.log(`State transition: ${this.state} → ${newState}`);
        this.state = newState;
        this.onStateChange();
    }

    onStateChange() {
        switch (this.state) {
            case States.COUNTDOWN:
                this.timeRemaining = CONFIG.COUNTDOWN_DURATION;
                this.sessionStartTime = Date.now();
                this.startTimer();
                break;
            case States.HANGING:
                this.timeRemaining = CONFIG.HANG_DURATION;
                this.hangStartTime = Date.now();
                this.currentReadings = [];
                this.currentFilteredReadings = [];
                this.currentAverage = 0;
                this.startTimer();
                audio.playHangStart();
                console.log(`Rep ${this.currentRep + 1} - HANG started at ${this.hangStartTime}`);
                break;
            case States.REST:
                this.timeRemaining = CONFIG.REST_DURATION;
                const repResult = this.calculateRepAverage();
                this.repData.push(repResult);
                this.currentRep++;
                this.startTimer();
                audio.playHangEnd();
                break;
            case States.COMPLETE:
                this.stopTimer();
                audio.playComplete();
                break;
        }
        view.startPhaseVisual(this.state);
        view.render();
    }

    calculateRepAverage() {
        const rawCount = this.currentReadings.length;

        // Filter readings within the 2-6 second window
        const windowedReadings = this.currentReadings.filter(reading => {
            const elapsed = reading.timestamp - this.hangStartTime;
            return elapsed >= CONFIG.WINDOW_START_MS && elapsed <= CONFIG.WINDOW_END_MS;
        });
        const windowCount = windowedReadings.length;

        // Further filter by noise threshold
        const validReadings = windowedReadings.filter(reading =>
            reading.weight >= CONFIG.NOISE_THRESHOLD
        );
        const filteredCount = validReadings.length;

        // Calculate average
        let average = 0;
        if (filteredCount > 0) {
            const sum = validReadings.reduce((acc, reading) => acc + reading.weight, 0);
            average = sum / filteredCount;
        }

        // Check if rep is unreliable
        const unreliable = filteredCount < CONFIG.MIN_VALID_READINGS;

        // Minimum: lowest force in the 2-6s filtered set (same set as average)
        const minimum = filteredCount > 0
            ? Math.min(...validReadings.map(r => r.weight))
            : 0;

        // Peak: highest force across all noise-filtered readings (full 7s window)
        const peak = this.currentFilteredReadings.length > 0
            ? Math.max(...this.currentFilteredReadings.map(r => r.force))
            : 0;

        // Log detailed stats
        console.log(`Rep ${this.currentRep + 1} - Statistics:`);
        console.log(`  Raw readings received: ${rawCount}`);
        console.log(`  Within 2-6s window: ${windowCount}`);
        console.log(`  After noise filter (≥${CONFIG.NOISE_THRESHOLD}kg): ${filteredCount}`);
        console.log(`  Calculated average: ${average.toFixed(2)} kg`);
        console.log(`  Minimum (window): ${minimum.toFixed(2)} kg`);
        console.log(`  Peak (full rep): ${peak.toFixed(2)} kg`);
        console.log(`  Unreliable: ${unreliable ? 'YES' : 'NO'}`);

        return {
            average,
            minimum,
            peak,
            unreliable,
            // Every reading captured during this hang, unfiltered
            rawReadings: this.currentReadings.map(r => ({
                t: r.timestamp - this.hangStartTime,
                force: r.weight
            })),
            stats: {
                rawCount,
                windowCount,
                filteredCount
            }
        };
    }

    startTimer() {
        this.stopTimer();
        this.timer = setInterval(() => {
            this.timeRemaining--;

            // Only tick audibly for the last 5s of the longer countdown
            if (this.state === States.COUNTDOWN && this.timeRemaining > 0 && this.timeRemaining <= 5) {
                audio.playCountdown();
            }

            if (this.timeRemaining <= 0) {
                this.handleTimerEnd();
            } else {
                view.render();
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    handleTimerEnd() {
        switch (this.state) {
            case States.COUNTDOWN:
                this.transition(States.HANGING);
                break;
            case States.HANGING:
                this.transition(States.REST);
                break;
            case States.REST:
                if (this.currentRep >= CONFIG.TOTAL_REPS) {
                    this.transition(States.COMPLETE);
                } else {
                    this.transition(States.HANGING);
                }
                break;
        }
    }

    recordWeight(weight) {
        const now = Date.now();

        // Log every reading for the whole test, whatever phase we're in
        if (this.sessionStartTime && this.state !== States.IDLE && this.state !== States.COMPLETE) {
            this.allReadings.push({
                t: now - this.sessionStartTime,
                weight,
                phase: this.state,
                rep: this.state === States.HANGING ? this.currentRep + 1 : null
            });
        }

        if (this.state === States.HANGING) {
            const timestamp = now;
            this.currentReadings.push({ weight, timestamp });

            if (weight >= CONFIG.NOISE_THRESHOLD) {
                this.currentFilteredReadings.push({
                    t: timestamp - this.hangStartTime,
                    force: weight
                });
            }

            // Calculate live average for display
            const elapsed = timestamp - this.hangStartTime;
            if (elapsed >= CONFIG.WINDOW_START_MS && elapsed <= CONFIG.WINDOW_END_MS) {
                const windowReadings = this.currentReadings.filter(r => {
                    const e = r.timestamp - this.hangStartTime;
                    return e >= CONFIG.WINDOW_START_MS && e <= CONFIG.WINDOW_END_MS && r.weight >= CONFIG.NOISE_THRESHOLD;
                });
                if (windowReadings.length > 0) {
                    const sum = windowReadings.reduce((acc, r) => acc + r.weight, 0);
                    this.currentAverage = sum / windowReadings.length;
                    // Live weight is repainted by the scale listener; no full re-render
                    // here so no reading is delayed behind a chart rebuild.
                }
            }
        }
    }

    reset() {
        this.stopTimer();
        this.state = States.IDLE;
        this.currentRep = 0;
        this.timeRemaining = 0;
        this.repData = [];
        this.currentReadings = [];
        this.currentFilteredReadings = [];
        this.hangStartTime = 0;
        this.currentAverage = 0;
        this.sessionStartTime = 0;
        this.allReadings = [];
    }
}

export class AudioSystem {
    constructor() {
        this.audioContext = null;
    }

    init() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
    }

    playTone(frequency, duration) {
        this.init();
        const oscillator = this.audioContext.createOscillator();
        const gainNode = this.audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(this.audioContext.destination);

        oscillator.frequency.value = frequency;
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, this.audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration / 1000);

        oscillator.start(this.audioContext.currentTime);
        oscillator.stop(this.audioContext.currentTime + duration / 1000);
    }

    playCountdown() {
        this.playTone(400, 150);
    }

    playHangStart() {
        this.playTone(600, 300);
    }

    playHangEnd() {
        this.playTone(300, 200);
    }

    playComplete() {
        this.playTone(400, 200);
        setTimeout(() => this.playTone(500, 200), 250);
        setTimeout(() => this.playTone(600, 300), 500);
    }
}

export class ScaleIntegration {
    constructor() {
        this.scale = new BluetoothScale();
        this.lastPacketTime = Date.now();
        this.signalCheckInterval = null;
    }

    async connect() {
        try {
            await this.scale.connect();
            this.setupListeners();
            return true;
        } catch (error) {
            console.error('Scale connection failed:', error);
            return false;
        }
    }

    setupListeners() {
        window.addEventListener('scale:weight', (event) => {
            this.lastPacketTime = Date.now();
            const weight = event.detail.weight;
            const max = event.detail.max;
            stateMachine.recordWeight(weight);
            view.updateLiveWeight(weight);
            view.updateLiveReadingDisplay(weight, max);
        });

        window.addEventListener('scale:disconnected', () => {
            view.updateScaleStatus(false);
        });
    }

    resetMax() {
        this.scale.resetMax();
    }

    isConnected() {
        return this.scale.isConnected();
    }

    startSignalMonitoring() {
        this.stopSignalMonitoring();
        this.lastPacketTime = Date.now();

        this.signalCheckInterval = setInterval(() => {
            const timeSinceLastPacket = Date.now() - this.lastPacketTime;
            view.updateSignalIndicator(timeSinceLastPacket > CONFIG.SIGNAL_TIMEOUT);
        }, 500);
    }

    stopSignalMonitoring() {
        if (this.signalCheckInterval) {
            clearInterval(this.signalCheckInterval);
            this.signalCheckInterval = null;
        }
        view.updateSignalIndicator(false);
    }

    prepareForTest() {
        // Increase packet timeout during active test
        BluetoothScale.PACKET_TIMEOUT_MS = 12000;
    }

    restoreDefaults() {
        // Restore default timeout after test
        BluetoothScale.PACKET_TIMEOUT_MS = 5000;
    }
}

/* ── the singletons ─────────────────────────────────────────
   One test, one scale, one set of beeps. Created here rather than in
   a layout so both layouts get the same instances and neither can
   invent a second state machine. */
export const audio = new AudioSystem();
export const stateMachine = new StateMachine();
export const scaleIntegration = new ScaleIntegration();
