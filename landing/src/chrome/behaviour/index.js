// The chrome's behaviour, wired once per page. Each piece is a no-op when its
// element is absent, so a page imports this and gets exactly what it renders.
import { initBar } from './bar.js';
import { initStubs, initSourcesSwitch } from './stubs.js';
import { initCopy } from './copy.js';
import { initPalette } from './palette.js';
import { initPrint } from './print.js';

export { createLamp } from './lamp.js';
export { setFigure } from './digits.js';

export function initChrome(root = document) {
  initBar(root);
  initStubs(root);
  const sources = initSourcesSwitch(root);
  initCopy(root);
  initPalette(root);
  initPrint(root);
  return { sources };
}
