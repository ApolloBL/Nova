import {
  createTrieNode,
  insertIntoTrie,
  isStaticPattern,
  matchTrie,
  parsePattern,
  splitPath,
  walkTrieTerminals,
  type TrieNode,
} from "./match.js";
import type { Method, RouteEntry, RouteMatch } from "./types.js";

const EMPTY_PARAMS: Readonly<Record<string, string>> = Object.freeze({});

/**
 * Hybrid router: an O(1) map for fully-static routes plus a per-method
 * trie for routes containing `:param` placeholders. Static routes always
 * win — `/users/me` beats `/users/:id` for the request `GET /users/me`.
 *
 * Generic over the handler type so `@novats/core` can specialize without
 * coupling the router to the framework.
 */
export class Router<H> {
  private readonly staticRoutes = new Map<Method, Map<string, H>>();
  private readonly trieRoutes = new Map<Method, TrieNode<H>>();

  /**
   * Registers a handler.
   *
   * @throws if `method` + `path` is already registered, if `:name?` is used
   * anywhere but the final segment, if the parameter name is invalid, or
   * if a parametric position disagrees with an existing one at the same
   * depth.
   */
  add(method: Method, path: string, handler: H): void {
    const segments = parsePattern(path);
    const label = `${method} ${path}`;

    if (isStaticPattern(segments)) {
      let byPath = this.staticRoutes.get(method);
      if (byPath === undefined) {
        byPath = new Map<string, H>();
        this.staticRoutes.set(method, byPath);
      }
      if (byPath.has(path)) {
        throw new Error(`Route already registered: ${label}`);
      }
      byPath.set(path, handler);
      return;
    }

    let trie = this.trieRoutes.get(method);
    if (trie === undefined) {
      trie = createTrieNode<H>();
      this.trieRoutes.set(method, trie);
    }
    insertIntoTrie(trie, segments, handler, label, path);
  }

  /**
   * Yields every registered route — static routes first (insertion order
   * per method), then parametric ones from a depth-first trie walk. Not on
   * the matching hot path; intended for introspection tooling.
   */
  *entries(): Generator<RouteEntry<H>> {
    for (const [method, byPath] of this.staticRoutes) {
      for (const [path, value] of byPath) {
        yield { method, path, value };
      }
    }
    for (const [method, root] of this.trieRoutes) {
      for (const { path, handler } of walkTrieTerminals(root)) {
        yield { method, path, value: handler };
      }
    }
  }

  /**
   * Looks up a handler. Static and method comparisons are exact (`/foo`
   * and `/foo/` are distinct; the caller must uppercase the method).
   * Static matches return a frozen empty `params` object.
   */
  find(method: Method, path: string): RouteMatch<H> | undefined {
    const byPath = this.staticRoutes.get(method);
    if (byPath !== undefined) {
      const handler = byPath.get(path);
      if (handler !== undefined) {
        return { handler, params: EMPTY_PARAMS };
      }
    }

    const trie = this.trieRoutes.get(method);
    if (trie === undefined) return undefined;

    return matchTrie(trie, splitPath(path));
  }
}
