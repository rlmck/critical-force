/* == desktop.js -- booting the desktop layout. =================

   Thin on purpose. Everything this does is in base.js; what is here
   is the wiring that says "this page is the desktop one".
   ============================================================== */
import { setView } from '../engine.js';
import { BaseView, appData } from './base.js';
import { mountSwitch } from '../layout.js';

class DesktopView extends BaseView {}

const view = new DesktopView();

/* The engine talks to the layout through this and nothing else. */
setView(view);

view.showScreen('setup');
mountSwitch('d');

console.log('Critical Force — desktop layout ready');
