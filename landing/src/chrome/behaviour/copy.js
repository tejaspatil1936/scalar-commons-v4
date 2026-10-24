// Copy buttons: [data-copy] puts its value on the clipboard and says "Copied"
// for a moment. The one behaviour every surface shares; the header menu is a
// native <details> and needs none.
export function initCopy(root = document) {
  root.addEventListener('click', async (event) => {
    const btn = event.target.closest?.('[data-copy]');
    if (!btn) return;
    try {
      await navigator.clipboard.writeText(btn.getAttribute('data-copy'));
      const word = btn.querySelector('span');
      if (word) {
        word.textContent = 'Copied';
        setTimeout(() => (word.textContent = 'Copy'), 1200);
      }
    } catch {
      // Clipboard refused (insecure origin or permissions): the value stays visible in the title.
    }
  });
}
