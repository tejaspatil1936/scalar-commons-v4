// The home page's own assets as the build consumes them: its stylesheet
// (inlined in the page under the chrome's styles.css) and its one script
// (copied to dist/refresh.js as it is — no bundling).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (name) => fileURLToPath(new URL(`./${name}`, import.meta.url));

/** home.css, unminified. */
export const homeCss = () => readFileSync(here('home.css'), 'utf8');
/** The path of refresh.js, for the build to copy. */
export const REFRESH_SCRIPT = here('refresh.js');
