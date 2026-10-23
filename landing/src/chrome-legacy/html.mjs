// The one escape the chrome's templates use. Content is data, never markup.
export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Attribute string from an object; `null`/`false` omit the attribute, `true` renders it bare. */
export const attrs = (object) =>
  Object.entries(object)
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escapeHtml(v)}"`))
    .join('');
