// Print: the foot carries the URL and the moment of printing.
export function initPrint(root = document) {
  const foot = root.querySelector('[data-print-foot]');
  if (!foot) return;
  const stamp = () => {
    foot.setAttribute('data-url', window.location.href);
    foot.setAttribute('data-printed', new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC'));
  };
  window.addEventListener('beforeprint', stamp);
  stamp();
}
