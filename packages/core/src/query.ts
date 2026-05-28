/** A query value: either the raw string, or all occurrences in order. */
export type QueryValue = string | readonly string[];

/** Frozen, null-prototype shape of `ctx.query`. */
export type QueryRecord = Readonly<Record<string, QueryValue>>;

/** Reused for every request whose URL has no query string — zero allocation. */
const EMPTY_QUERY: QueryRecord = Object.freeze(Object.create(null) as Record<string, QueryValue>);

/**
 * Maximum distinct keys accepted from a single query string.
 *
 * Once exceeded, subsequent new keys are dropped; repeated keys still
 * accumulate into their existing array. Bounds memory against a
 * `?a=1&b=1&c=1…` DoS.
 */
export const MAX_QUERY_KEYS = 1000;

const CC_QUESTION = 0x3f; // '?'
const CC_PCT = 0x25; // '%'
const CC_PLUS = 0x2b; // '+'

/**
 * URL-decodes a query-string piece. Fast-paths inputs with no `%` or `+`
 * (the common case) and returns the raw piece if decoding fails.
 */
function decodePiece(s: string): string {
  if (s.length === 0) return s;

  let needsDecode = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === CC_PCT || c === CC_PLUS) {
      needsDecode = true;
      break;
    }
  }
  if (!needsDecode) return s;

  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/**
 * Parses a URL query string into a {@link QueryRecord}.
 *
 * Accepts the search portion with or without the leading `?`. Repeated
 * keys collapse into an ordered array. `+` decodes to a space
 * (form-urlencoded rules). Empty pairs (`?&&`) are dropped per WHATWG.
 *
 * `__proto__`, `constructor`, and `prototype` are silently skipped; a
 * handler that needs them can read `ctx.raw.req.url` directly.
 */
export function parseQueryString(search: string): QueryRecord {
  if (search === "" || search === "?") return EMPTY_QUERY;

  const start = search.charCodeAt(0) === CC_QUESTION ? 1 : 0;
  const end = search.length;
  if (start === end) return EMPTY_QUERY;

  const result = Object.create(null) as Record<string, string | string[]>;
  let distinctKeyCount = 0;

  let cursor = start;
  while (cursor < end) {
    let ampIndex = search.indexOf("&", cursor);
    if (ampIndex === -1 || ampIndex > end) ampIndex = end;

    if (ampIndex === cursor) {
      cursor = ampIndex + 1;
      continue;
    }

    let eqIndex = search.indexOf("=", cursor);
    if (eqIndex === -1 || eqIndex >= ampIndex) eqIndex = -1;

    const key =
      eqIndex === -1
        ? decodePiece(search.slice(cursor, ampIndex))
        : decodePiece(search.slice(cursor, eqIndex));
    const value = eqIndex === -1 ? "" : decodePiece(search.slice(eqIndex + 1, ampIndex));

    if (key !== "__proto__" && key !== "constructor" && key !== "prototype") {
      const existing = result[key];
      if (existing === undefined) {
        if (distinctKeyCount < MAX_QUERY_KEYS) {
          result[key] = value;
          distinctKeyCount += 1;
        }
      } else if (typeof existing === "string") {
        result[key] = [existing, value];
      } else {
        existing.push(value);
      }
    }

    cursor = ampIndex + 1;
  }

  return Object.freeze(result) as QueryRecord;
}
