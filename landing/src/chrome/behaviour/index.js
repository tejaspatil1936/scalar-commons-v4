// The chrome's behaviour, wired once per page that ships a script.
import { initCopy } from './copy.js';

export function initChrome(root = document) {
  initCopy(root);
}
