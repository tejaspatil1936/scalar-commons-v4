// The 404 page's docs search: every word of the query must appear in a page's
// title, description or section headings; a word in the title counts most.
// Pure, so the test holds it; the page's script draws the result.

const words = (text) =>
  String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** Pages matching `query`, best first, at most `limit`. */
export function searchDocs(index, query, limit = 8) {
  const terms = words(query);
  if (!terms.length) return [];
  const scored = [];
  for (const page of index) {
    const title = page.title.toLowerCase();
    const rest = `${page.description} ${page.headings.join(' ')}`.toLowerCase();
    let score = 0;
    let all = true;
    for (const term of terms) {
      if (title.includes(term)) score += 3;
      else if (rest.includes(term)) score += 1;
      else all = false;
    }
    if (all) scored.push({ page, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title))
    .slice(0, limit)
    .map((s) => s.page);
}
