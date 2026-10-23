// Boot for /faucet: the chrome's copy buttons, then the form (src/faucet/page.js).
import { initChrome } from '../chrome/behaviour/index.js';
import { init } from './page.js';

initChrome();
const root = document.querySelector('[data-faucet]');
if (root) init(root);
