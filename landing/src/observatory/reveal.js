// The scroll reveal: each instrument section fades in and rises twelve
// pixels, once, as it enters the viewport, on GSAP's ScrollTrigger. This
// module is its own chunk, fetched by main.js only when motion is not
// reduced and the page is not in presenter mode, so a reader who asked for
// stillness never downloads it and the ordinary bundle carries no GSAP. A
// section is hidden by the script here, never by the stylesheet, so without
// script, without this chunk, or if it fails to load, every section is
// simply visible. Each reveal runs once and clears its transform when it
// ends, so no section is left as a containing block for the presenter's
// fixed screens.

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

export const RISE_PX = 12;
export const REVEAL_S = 0.6;
/** A section begins its reveal when its top crosses this far down the viewport. */
export const START = 'top 85%';

export function start({ targets }) {
  gsap.registerPlugin(ScrollTrigger);
  const triggers = [];
  for (const el of targets) {
    gsap.set(el, { opacity: 0, y: RISE_PX });
    triggers.push(
      ScrollTrigger.create({
        trigger: el,
        start: START,
        once: true,
        onEnter: () => gsap.to(el, { opacity: 1, y: 0, duration: REVEAL_S, ease: 'power2.out', clearProps: 'transform,opacity' }),
      }),
    );
  }
  return {
    count: triggers.length,
    refresh: () => ScrollTrigger.refresh(),
    /** Shows everything at once and removes the triggers: for reduced motion arriving mid-visit. */
    stop() {
      for (const t of triggers) t.kill();
      triggers.length = 0;
      for (const el of targets) gsap.set(el, { clearProps: 'transform,opacity' });
    },
  };
}
