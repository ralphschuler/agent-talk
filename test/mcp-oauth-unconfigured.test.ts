import { SELF } from "cloudflare:test";
import { expect, it } from "vite-plus/test";

it("never falls back to anonymous MCP when OAuth is unconfigured", async () => {
  const response = await SELF.fetch("https://agent-talk.test/mcp", { method: "POST", headers: {
    "content-type": "application/json", accept: "application/json, text/event-stream",
  }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
  expect(response.status).toBe(503);
  expect((await SELF.fetch("https://agent-talk.test/healthz")).status).toBe(200);
});
