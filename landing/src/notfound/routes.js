// The closest built route to a path, by edit distance; pure, so the test can hold it.
/** Levenshtein distance, small inputs. */
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[m][n];
}

/** The nearest route, or null when none is close (more than half the path away). */
export function closestRoute(path, routes) {
  const clean = path.replace(/\/+$/, '') || '/';
  let best = null;
  for (const route of routes) {
    const candidate = route.replace(/\/+$/, '') || '/';
    const distance = editDistance(clean.toLowerCase(), candidate.toLowerCase());
    if (best === null || distance < best.distance) best = { route, distance };
  }
  return best && best.distance <= Math.max(2, Math.floor(clean.length / 2)) ? best.route : null;
}

