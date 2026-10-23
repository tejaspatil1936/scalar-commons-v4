// The lamp: an 8 px ink dot and one line of label text (block n · fin k), lit only while the
// socket is open and the last block is under 30 s old. Fed by the page's
// head/finalized events; this module composes the words and the state.
const fmt = new Intl.NumberFormat('en-US');
const utc = (ms) => new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');

export function createLamp(el, { rpc = 'wss://rpc.scalarnet.io', staleMs = 30_000 } = {}) {
  const text = el.querySelector('.nw-lamp-text');
  const state = { open: false, block: null, finalized: null, lastBlockAt: null, indexBehind: 0 };
  let tickTimer = null;
  const render = () => {
    const now = Date.now();
    const age = state.lastBlockAt ? now - state.lastBlockAt : Infinity;
    const lag = state.block !== null && state.finalized !== null ? state.block - state.finalized : null;
    let mode = 'normal';
    if (!state.open || state.block === null) mode = 'connecting';
    else if (age > staleMs) mode = 'stalled';
    else if (state.indexBehind > 0) mode = 'behind';
    else if (lag !== null && lag > 3) mode = 'lagging';
    const lit = state.open && age <= staleMs;
    el.setAttribute('data-state', mode);
    el.setAttribute('data-lit', String(lit));
    const finality = lag === null ? '—' : fmt.format(lag);
    let words;
    if (mode === 'connecting') words = `connecting · ${rpc}`;
    else if (mode === 'stalled') words = `last block ${utc(state.lastBlockAt)} · ${Math.round(age / 60_000)} min ago · <span class="nw-alarm">stalled</span>`;
    else if (mode === 'behind') words = `block ${fmt.format(state.block)} · fin ${finality} · <span class="nw-alarm">index −${fmt.format(state.indexBehind)}</span>`;
    else if (mode === 'lagging') words = `block ${fmt.format(state.block)} · fin <span class="nw-alarm">${finality}</span>`;
    else words = `block ${fmt.format(state.block)} · fin ${finality}`;
    text.innerHTML = words;
  };
  const tick = () => {
    el.classList.add('is-ticking');
    clearTimeout(tickTimer);
    tickTimer = setTimeout(() => el.classList.remove('is-ticking'), 1800);
  };
  const staleWatch = setInterval(render, 5_000);
  return {
    update(patch) {
      const hadBlock = state.block;
      Object.assign(state, patch);
      if (patch.block !== undefined && patch.block !== hadBlock) {
        state.lastBlockAt = patch.lastBlockAt ?? Date.now();
        tick();
      }
      render();
    },
    stop() {
      clearInterval(staleWatch);
      clearTimeout(tickTimer);
    },
  };
}
