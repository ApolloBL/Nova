/**
 * Playground server.
 *
 * Run with `pnpm --filter @novajs/playground dev` (auto-reloads on save) or
 * `pnpm --filter @novajs/playground start` (single run).
 *
 * This file is not part of any published package. Use it to poke at Nova
 * during development.
 */
import { Nova } from "@novajs/core";

const app = new Nova();

app.get("/", () => ({ hello: "world" }));

app.get("/health", () => "ok");

app.get("/users", () => ({
  users: [
    { id: 1, name: "Apollo" },
    { id: 2, name: "Bernard" },
  ],
}));

app.get("/headers", (ctx) => {
  ctx.status(200).header("x-trace", "playground").json({ ok: true });
});

app.get("/boom", () => {
  throw new Error("demo: handler crashed on purpose");
});

const port = Number(process.env["PORT"] ?? 3000);
const { address, port: boundPort, close } = await app.listen(port);

console.log(`[playground] Nova listening on http://${address}:${boundPort}`);
console.log("[playground] try:");
console.log(`  curl http://${address}:${boundPort}/`);
console.log(`  curl http://${address}:${boundPort}/health`);
console.log(`  curl http://${address}:${boundPort}/users`);
console.log(`  curl -i http://${address}:${boundPort}/headers`);
console.log(`  curl -i http://${address}:${boundPort}/boom    # 500`);
console.log(`  curl -i http://${address}:${boundPort}/nope    # 404`);

const shutdown = async (signal: string): Promise<void> => {
  console.log(`\n[playground] received ${signal}, shutting down…`);
  await close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
