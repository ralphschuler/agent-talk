// Loaded only into disposable MCP test processes. It never modifies a Worker or
// relay: while the local flag exists, only owner-copy publication is interrupted.
import { existsSync } from "node:fs";
const portal = process.env.OWNER_TEST_PORTAL_ORIGIN;
const flag = process.env.OWNER_TEST_BLOCK_FILE;
if (!(["https://agent-talk-owner-test.ralph-cfd.workers.dev", "http://localhost:5174"].includes(portal) ||
  /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(portal ?? "")) || !flag) {
  throw new Error("Invalid isolated portal outage configuration.");
}
const original = globalThis.fetch;
globalThis.fetch = function (input, options) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin === portal && url.pathname === "/copy/publish" && existsSync(flag)) {
    return Promise.reject(new Error("Synthetic client-local portal interruption"));
  }
  return original.call(this, input, options);
};
