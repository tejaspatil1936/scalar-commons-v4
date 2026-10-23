// The docs pages the 404 page's search field looks through, read at build
// time from the docs' own sources (docs/index.md, docs/guide/*.md,
// docs/reference/*.md): each page's title, its description and its section
// headings, and the URL the docs serve it at. Built with the landing site, so
// the list is whatever the docs publish on the day of the build; nothing in it
// is typed here. Node only (it reads files); the browser half is search.js.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Markdown inline syntax → plain words: links keep their text, code and emphasis lose their marks. */
export const plain = (text) =>
  String(text ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_]/g, '')
    .replace(/\{#[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** One page's entry from its markdown source, or null when it has no title. */
export function entryFor(markdown, path, fallbackTitle = null) {
  const front = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = front?.[1] ?? '';
  const field = (name) => plain(meta.match(new RegExp(`^${name}:\\s*["']?(.*?)["']?\\s*$`, 'm'))?.[1] ?? '');
  const text = (front ? markdown.slice(front[0].length) : markdown).replace(/```[\s\S]*?```/g, '');
  const h1 = plain(text.match(/^#\s+(.+)$/m)?.[1] ?? '');
  const title = h1 || fallbackTitle || field('title');
  if (!title) return null;
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)].map((m) => plain(m[1])).filter(Boolean);
  return { title, path, description: field('description'), headings };
}

/** Every published docs page under `docsDir`, docs home first, then the guide and the reference, by file name. */
export function docsIndex(docsDir, base = '/docs/') {
  if (!existsSync(docsDir)) return [];
  const out = [];
  const home = join(docsDir, 'index.md');
  if (existsSync(home)) {
    const entry = entryFor(readFileSync(home, 'utf8'), base, 'Documentation');
    if (entry) out.push(entry);
  }
  for (const section of ['guide', 'reference']) {
    const dir = join(docsDir, section);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
      const slug = name === 'index.md' ? '' : name.replace(/\.md$/, '');
      const entry = entryFor(readFileSync(join(dir, name), 'utf8'), `${base}${section}/${slug}`);
      if (entry) out.push(entry);
    }
  }
  return out;
}
