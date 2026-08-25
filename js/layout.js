/* == layout.js -- which of the two versions you get. ===========

   Two real layouts rather than one that stretches, so something has
   to choose. The order is: what you asked for in the URL, then what
   you chose last time, then a guess.

   The guess is deliberately conservative — it only says "phone" when
   the screen is narrow *and* the pointer is coarse. A narrow window
   on a laptop is still a laptop, and being dropped into the phone
   layout for dragging a window too small is worse than being left on
   desktop.

   Whatever it picks, the choice is one tap to undo and it sticks.
   ============================================================== */
const KEY = 'cf-layout';

export const DESKTOP = 'desktop.html';
export const MOBILE  = 'mobile.html';

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'd' || v === 'm' ? v : null;
  } catch (err) {
    /* Private mode, or storage disabled. Not a reason to fail. */
    return null;
  }
}

function remember(which) {
  try { localStorage.setItem(KEY, which); } catch (err) { /* see above */ }
}

/* Coarse pointer and a narrow screen. `screen.width` rather than the
   window, because a phone's window is the screen and a laptop's
   might have been dragged narrow. */
export function guess() {
  const narrow = Math.min(screen.width || 9999, screen.height || 9999) < 820;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return narrow && coarse ? 'm' : 'd';
}

/* An explicit ?layout=m wins and is remembered — it is how you get a
   phone layout onto a desktop for a look, and how a bookmark pins
   the choice. */
export function preferred() {
  const asked = new URLSearchParams(location.search).get('layout');
  if (asked === 'm' || asked === 'd') { remember(asked); return asked; }
  return stored() || guess();
}

export function pathFor(which) {
  return which === 'm' ? MOBILE : DESKTOP;
}

export function switchTo(which) {
  remember(which);
  location.href = pathFor(which);
}

/* The link at the foot of each layout. Built here so both pages
   agree about where it goes and what it says. */
export function mountSwitch(current) {
  const other = current === 'm' ? 'd' : 'm';
  document.querySelectorAll('[data-layout-switch]').forEach(node => {
    node.textContent = other === 'm' ? 'Switch to the mobile version' : 'Switch to the desktop version';
    node.href = pathFor(other);
    node.addEventListener('click', e => {
      e.preventDefault();
      switchTo(other);
    });
  });
}
