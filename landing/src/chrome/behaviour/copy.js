// Copy: "Copy" revealed on hover, "Copied" in filament for 1.2 s.
export function initCopy(root = document) {
  root.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.getAttribute('data-copy'));
      button.textContent = 'Copied';
      button.classList.add('is-copied');
      setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('is-copied');
      }, 1200);
    } catch {
      button.textContent = 'Select and copy';
    }
  });
}
