// Runs only inside a disposable synthetic adapter started by smoke-conversations.
// Interrupt the HTTP ACK after the adapter has durably saved the expected group message.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const original = globalThis.fetch;
globalThis.fetch = async function (url, options) {
  const path = new URL(url).pathname;
  const gate = process.env.SMOKE_GROUP_RACE_DIR;
  if (
    gate &&
    path === "/v1/group/submit" &&
    options?.method === "POST" &&
    existsSync(join(gate, "race"))
  ) {
    const { op } = JSON.parse(options.body);
    if (op.kind === "add" && readFileSync(join(gate, "race"), "utf8") === op.groupId) {
      // Both owners must have already approved and persisted a genuine MLS Commit for the same epoch.
      writeFileSync(join(gate, process.env.SMOKE_GROUP_ACTOR + "-ready"), String(op.epoch), {
        mode: 0o600,
      });
      const until = Date.now() + 12_000;
      while (!existsSync(join(gate, "release"))) {
        if (Date.now() > until) throw new Error("Synthetic membership race timed out.");
        await delay(25);
      }
    }
  }
  if (process.env.SMOKE_GROUP_MESSAGE && path === "/v1/group/ack" && options?.method === "POST") {
    const snapshot = readFileSync(process.env.SMOKE_PROFILE_PATH, "utf8");
    if (snapshot.includes(process.env.SMOKE_GROUP_MESSAGE)) {
      writeFileSync(process.env.SMOKE_GROUP_MARKER, options.body, { mode: 0o600 });
      process.exit(73);
    }
  }
  return original.call(this, url, options);
};
