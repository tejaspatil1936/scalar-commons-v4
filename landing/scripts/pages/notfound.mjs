// /404: the page and its one script.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderNotFound } from '../../src/notfound.mjs';

export default async function ({ outDir, here, facts, chromeCss, build, common }) {
  writeFileSync(join(outDir, '404.html'), renderNotFound({ facts, css: chromeCss }));
  await build({ ...common, entryPoints: [here('../src/notfound/main.js')], outfile: join(outDir, '404.js') });
}
