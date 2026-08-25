/* == mobile.js -- booting the mobile layout. ===================

   Same engine, same behaviour, two things the desktop has no need
   for: keeping the screen awake through a four-minute test, and
   telling the phone not to zoom the whole page when a number field
   is focused.
   ============================================================== */
import { setView, States, stateMachine } from '../engine.js';
import { BaseView } from './base.js';
import { mountSwitch } from '../layout.js';

class MobileView extends BaseView {
  constructor() {
    super();
    this.wakeLock = null;
  }

  /* A phone locks itself after 30 seconds of not being touched, and
     nothing touches it during a hang. Without this the screen goes
     dark somewhere around rep 3 — the test keeps running, but the
     person on the edge cannot see the timer.

     Best-effort: the API is unavailable over plain HTTP and on some
     browsers, and a test that runs with the screen dimming is still
     a test. */
  async holdScreenAwake() {
    if (!('wakeLock' in navigator) || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => { this.wakeLock = null; });
    } catch (err) {
      console.warn('[mobile] wake lock refused:', err && err.message);
    }
  }

  releaseScreen() {
    if (!this.wakeLock) return;
    this.wakeLock.release().catch(() => {});
    this.wakeLock = null;
  }

  startTest() {
    this.holdScreenAwake();
    super.startTest();
  }

  resetToSetup() {
    this.releaseScreen();
    super.resetToSetup();
  }

  showResults() {
    this.releaseScreen();
    super.showResults();
  }
}

const view = new MobileView();
setView(view);

/* Switching away and back drops a wake lock. Take it again if a test
   is still running. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const mid = stateMachine.state === States.COUNTDOWN ||
              stateMachine.state === States.HANGING ||
              stateMachine.state === States.REST;
  if (mid) view.holdScreenAwake();
});

view.showScreen('setup');
mountSwitch('m');

console.log('Critical Force — mobile layout ready');
