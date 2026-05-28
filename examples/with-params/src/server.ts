/**
 * Route parameters in Nova.
 *
 * `ctx.params` is typed from the path pattern at the call site — no manual
 * annotation. Hover any `ctx.params.*` access in your editor: the shape
 * matches the placeholders in the path string exactly.
 */
import { Nova } from "@novajs/core";

const app = new Nova();

// A static route. Wins over `/users/:id` when the literal request is `/users/me`.
app.get("/users/me", () => ({ kind: "static", who: "the current user" }));

// A single required parameter.
app.get("/users/:id", (ctx) => {
  //                          ↑ ctx.params.id: string
  return { kind: "param", id: ctx.params.id };
});

// Multiple parameters.
app.get("/users/:userId/posts/:postId", (ctx) => ({
  userId: ctx.params.userId, // string
  postId: ctx.params.postId, // string
}));

// Optional trailing parameter. `/files` and `/files/report.pdf` both match.
app.get("/files/:name?", (ctx) => {
  //                            ↑ ctx.params.name: string | undefined
  return ctx.params.name === undefined
    ? { kind: "index" }
    : { kind: "file", name: ctx.params.name };
});

const { port } = await app.listen(3000);
console.log(`with-params example listening on http://127.0.0.1:${port}`);
console.log("Try:");
console.log(`  curl http://127.0.0.1:${port}/users/me        # static wins`);
console.log(`  curl http://127.0.0.1:${port}/users/42        # parametric`);
console.log(`  curl http://127.0.0.1:${port}/users/7/posts/13`);
console.log(`  curl http://127.0.0.1:${port}/files           # optional absent`);
console.log(`  curl http://127.0.0.1:${port}/files/report.pdf`);
