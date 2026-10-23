// Stubs tear open to show the receipt; the Sources switch tears every stub in
// document order (20 ms stagger, 400 ms cap) and is remembered per browser
// under the key the observatory has always used, read before first paint.
export const SOURCES_KEY = 'observatory:sources';

export function initStubs(root = document) {
  root.addEventListener('click', (event) => {
    const stub = event.target.closest('.nw-stub[data-sealed]:not([data-sealed="true"]), .nw-stub:not([data-sealed])');
    if (!stub) return;
    const reading = stub.closest('.nw-reading');
    if (!reading) return;
    const torn = reading.classList.toggle('is-torn');
    stub.setAttribute('aria-expanded', String(torn));
  });
}

export function initSourcesSwitch(root = document) {
  const switches = [...root.querySelectorAll('[data-sources-switch]')];
  const apply = (on, { remember = true } = {}) => {
    const html = document.documentElement;
    if (on) {
      const stubs = [...root.querySelectorAll('.nw-reading:not([data-sealed="true"])')];
      const step = Math.min(20, stubs.length ? 400 / stubs.length : 20);
      stubs.forEach((r, i) => setTimeout(() => r.classList.add('is-torn'), i * step));
      html.setAttribute('data-sources', '');
    } else {
      html.removeAttribute('data-sources');
      root.querySelectorAll('.nw-reading.is-torn').forEach((r) => r.classList.remove('is-torn'));
    }
    for (const s of switches) s.setAttribute('aria-checked', String(on));
    if (remember) {
      try {
        localStorage.setItem(SOURCES_KEY, on ? '1' : '0');
      } catch {
        // a browser without storage simply does not remember
      }
    }
  };
  const initial = document.documentElement.hasAttribute('data-sources');
  for (const s of switches) {
    s.setAttribute('aria-checked', String(initial));
    s.addEventListener('click', () => apply(s.getAttribute('aria-checked') !== 'true'));
  }
  return { apply, isOn: () => document.documentElement.hasAttribute('data-sources') };
}
