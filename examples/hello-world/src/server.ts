import { Nova } from "@novats/core";

const app = new Nova();

app.get("/", () => ({ hello: "world" }));

const { port } = await app.listen(3000);

console.log(`Hello-world server listening on http://127.0.0.1:${port}`);
