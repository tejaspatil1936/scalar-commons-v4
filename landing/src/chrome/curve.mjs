// Build-time Curves: d3-shape computes the line and the pooled light's area
// for a set of points, and templates.curve draws them. Pure: points in, path
// strings out; the page decides what the points mean and names their source.
import { area, line, curveMonotoneX, curveStepAfter } from 'd3-shape';

/**
 * `points`: [[x, y], …] in data space; `width`/`height` the SVG box; `yMax`
 * the top of the plot (defaults to the max y); `step` for a staircase.
 * Returns { pathLine, pathArea, end: [x, y] of the last point in SVG space }.
 */
export function curvePaths(points, { width, height, yMax = null, step = false, padTop = 12 }) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const top = yMax ?? Math.max(...ys);
  const sx = (x) => (x1 === x0 ? 0 : ((x - x0) / (x1 - x0)) * width);
  const sy = (y) => height - (top === 0 ? 0 : (y / top) * (height - padTop));
  const kind = step ? curveStepAfter : curveMonotoneX;
  const pathLine = line().x((p) => sx(p[0])).y((p) => sy(p[1])).curve(kind)(points);
  const pathArea = area().x((p) => sx(p[0])).y0(height).y1((p) => sy(p[1])).curve(kind)(points);
  const last = points[points.length - 1];
  return { pathLine, pathArea, end: [Number(sx(last[0]).toFixed(2)), Number(sy(last[1]).toFixed(2))] };
}

/** n evenly spaced samples of f on [a, b]. */
export const sample = (f, a, b, n = 48) => Array.from({ length: n + 1 }, (_, i) => {
  const x = a + ((b - a) * i) / n;
  return [x, f(x)];
});
