// The top bar: pine-1 once the page has scrolled; the Menu under 1024 px.
export function initBar(root = document) {
  const bar = root.querySelector('[data-bar]');
  if (!bar) return () => {};
  const onScroll = () => bar.classList.toggle('is-scrolled', window.scrollY > 8);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  const menu = bar.querySelector('[data-menu]');
  menu?.addEventListener('click', () => {
    const open = bar.classList.toggle('is-open');
    menu.setAttribute('aria-expanded', String(open));
  });
  return () => window.removeEventListener('scroll', onScroll);
}
