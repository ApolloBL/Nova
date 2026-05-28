/**
 * Path-matching primitives. Agnostic of the surrounding `Router` class so
 * the same algorithms can be unit-tested in isolation.
 *
 * Pattern syntax:
 * - `/users` — literal segment.
 * - `/users/:id` — required parameter (any single segment).
 * - `/users/:id?` — optional parameter; only allowed as the last segment.
 *
 * The trie encodes positional structure only — parameter NAMES are stored
 * at the terminal, not on the intermediate nodes. This lets routes that
 * differ only in parameter names (`/users/:id` and `/users/:userId/posts`)
 * share the same trie path without conflict.
 *
 * At each trie level the static child is consulted before the parametric
 * one, so `/users/me` always wins over `/users/:id`.
 */

/** A single component of a parsed pattern. */
export type ParsedSegment =
  | { readonly kind: "static"; readonly value: string }
  | { readonly kind: "param"; readonly name: string; readonly optional: boolean };

const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parses a pattern string into segments. Empty patterns (`""`, `"/"`)
 * yield an empty array, which matches the root.
 *
 * @throws when `:name?` appears anywhere but the last segment, or when a
 * parameter name is empty or invalid (`[A-Za-z_][A-Za-z0-9_]*`).
 */
export function parsePattern(pattern: string): readonly ParsedSegment[] {
  const trimmed = pattern.startsWith("/") ? pattern.slice(1) : pattern;
  if (trimmed === "") return [];

  const parts = trimmed.split("/");
  const segments: ParsedSegment[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (!part.startsWith(":")) {
      segments.push({ kind: "static", value: part });
      continue;
    }

    const isLast = i === parts.length - 1;
    const optional = part.endsWith("?");
    if (optional && !isLast) {
      throw new Error(`Optional parameter must appear as the last segment: ${pattern}`);
    }

    const name = optional ? part.slice(1, -1) : part.slice(1);
    if (!PARAM_NAME.test(name)) {
      throw new Error(`Invalid parameter name in path "${pattern}": ":${name || ""}"`);
    }

    segments.push({ kind: "param", name, optional });
  }

  return segments;
}

/** Split a request path into segments using the same rules as the parser. */
export function splitPath(path: string): readonly string[] {
  const trimmed = path.startsWith("/") ? path.slice(1) : path;
  if (trimmed === "") return [];
  return trimmed.split("/");
}

/** Returns true if no segment of the pattern is parametric. */
export function isStaticPattern(segments: readonly ParsedSegment[]): boolean {
  for (const s of segments) {
    if (s.kind === "param") return false;
  }
  return true;
}

/**
 * Node of the parametric trie. One per HTTP method in the router.
 * `paramChild` is structural only — names live at the terminal as
 * `paramNames`, in the order they appear along the path.
 */
export interface TrieNode<H> {
  readonly staticChildren: Map<string, TrieNode<H>>;
  paramChild: TrieNode<H> | undefined;
  /** Terminal handler if this node ends a registered route. */
  handler: H | undefined;
  /** Parameter names in order. Empty for static routes. */
  paramNames: readonly string[];
  /** True if the terminal also matches when reached with one fewer segment. */
  optionalTerminal: boolean;
  /** Original pattern string — surfaced in conflict-error messages. */
  pattern: string | undefined;
  /** Route path without the method prefix — used by `entries()`. */
  path: string | undefined;
}

export function createTrieNode<H>(): TrieNode<H> {
  return {
    staticChildren: new Map(),
    paramChild: undefined,
    handler: undefined,
    paramNames: [],
    optionalTerminal: false,
    pattern: undefined,
    path: undefined,
  };
}

/**
 * Inserts a parsed pattern into the trie.
 *
 * @throws `Route already registered` if the exact pattern was added before,
 * or `Route conflict` if a structurally-equivalent pattern (different
 * parameter names) already terminates at the same node.
 */
export function insertIntoTrie<H>(
  root: TrieNode<H>,
  segments: readonly ParsedSegment[],
  handler: H,
  patternForError: string,
  routePath: string,
): void {
  let node = root;
  const paramNames: string[] = [];
  let lastWasOptional = false;

  for (const seg of segments) {
    if (seg.kind === "static") {
      let child = node.staticChildren.get(seg.value);
      if (child === undefined) {
        child = createTrieNode<H>();
        node.staticChildren.set(seg.value, child);
      }
      node = child;
      lastWasOptional = false;
      continue;
    }

    let child = node.paramChild;
    if (child === undefined) {
      child = createTrieNode<H>();
      node.paramChild = child;
    }
    node = child;
    paramNames.push(seg.name);
    lastWasOptional = seg.optional;
  }

  if (node.handler !== undefined) {
    if (node.pattern === patternForError) {
      throw new Error(`Route already registered: ${patternForError}`);
    }
    throw new Error(
      `Route conflict: "${patternForError}" has the same matching shape as already-registered "${node.pattern ?? "(unknown)"}"`,
    );
  }

  node.handler = handler;
  node.paramNames = paramNames;
  node.optionalTerminal = lastWasOptional;
  node.pattern = patternForError;
  node.path = routePath;
}

/** Yields `(path, handler)` for every terminal node. Off the hot path. */
export function* walkTrieTerminals<H>(node: TrieNode<H>): Generator<{ path: string; handler: H }> {
  if (node.handler !== undefined && node.path !== undefined) {
    yield { path: node.path, handler: node.handler };
  }
  for (const child of node.staticChildren.values()) {
    yield* walkTrieTerminals(child);
  }
  if (node.paramChild !== undefined) {
    yield* walkTrieTerminals(node.paramChild);
  }
}

/** Successful match. */
export interface MatchOutcome<H> {
  readonly handler: H;
  readonly params: Readonly<Record<string, string>>;
}

/**
 * Walks the trie for the given request segments. Parameter values are the
 * raw segments; URL-decoding is the caller's responsibility.
 */
export function matchTrie<H>(
  root: TrieNode<H>,
  segments: readonly string[],
): MatchOutcome<H> | undefined {
  const values: string[] = [];
  return walk(root, segments, 0, values);
}

function walk<H>(
  node: TrieNode<H>,
  segments: readonly string[],
  index: number,
  values: string[],
): MatchOutcome<H> | undefined {
  if (index >= segments.length) {
    if (node.handler !== undefined) {
      return { handler: node.handler, params: zipParams(node.paramNames, values) };
    }
    // Optional trailing parameter: `/users/:id?` matches `/users` even
    // though we never traversed the parametric child.
    const opt = node.paramChild;
    if (opt !== undefined && opt.handler !== undefined && opt.optionalTerminal) {
      return { handler: opt.handler, params: zipParams(opt.paramNames, values) };
    }
    return undefined;
  }

  const seg = segments[index] ?? "";

  const staticChild = node.staticChildren.get(seg);
  if (staticChild !== undefined) {
    const result = walk(staticChild, segments, index + 1, values);
    if (result !== undefined) return result;
  }

  // Parametric fallback. Mutate-and-revert is safe — zipParams snapshots
  // on success; failure pops what it pushed.
  const paramChild = node.paramChild;
  if (paramChild !== undefined) {
    values.push(seg);
    const result = walk(paramChild, segments, index + 1, values);
    if (result !== undefined) return result;
    values.pop();
  }

  return undefined;
}

function zipParams(
  names: readonly string[],
  values: readonly string[],
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  const n = Math.min(names.length, values.length);
  for (let i = 0; i < n; i++) {
    const key = names[i];
    const value = values[i];
    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
