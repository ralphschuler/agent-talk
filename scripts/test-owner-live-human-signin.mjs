import assert from "node:assert/strict";
import { waitForHumanSignIn } from "./owner-live-human-signin.mjs";

function fakePage(mode) {
  const handlers = new Map();
  const frame = {};
  return {
    mainFrame: () => frame,
    on: (event, callback) => handlers.set(event, callback),
    off: event => handlers.delete(event),
    url: () => mode === "wrong-origin" ? "https://unexpected.example/" : "https://agent-talk-owner-test.ralph-cfd.workers.dev/",
    async waitForFunction(_condition, expected) {
      if (expected !== "12345") throw new Error("Wrong test account");
      if (mode !== "no-navigation") handlers.get("request")?.({
        url: () => "https://github.com/login/oauth/authorize?state=synthetic",
        isNavigationRequest: () => true, frame: () => frame,
      });
    },
    handlers,
  };
}

const valid = fakePage("valid");
await waitForHumanSignIn(valid, "12345");
assert.equal(valid.handlers.size, 0);
for (const mode of ["no-navigation", "wrong-origin"]) {
  const page = fakePage(mode);
  await assert.rejects(waitForHumanSignIn(page, "12345"));
  assert.equal(page.handlers.size, 0);
}
await assert.rejects(waitForHumanSignIn(fakePage("valid"), "invalid"));
console.log("Interactive identity preflight rejects missing GitHub navigation and a wrong return origin.");
