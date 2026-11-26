import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { liveSettings } from "./owner-live-e2e.mjs";

const valid = { OWNER_LIVE_RELEASE: "a".repeat(40), OWNER_TEST_ACCOUNT_A_ID: "12345",
  OWNER_TEST_ACCOUNT_B_ID: "67890", OPENCLAW_PACKAGE_DIR: "/synthetic/openclaw" };
assert.deepEqual(liveSettings(valid, true), { release: valid.OWNER_LIVE_RELEASE, accountA: "12345", accountB: "67890" });
assert.throws(() => liveSettings(valid, false), /interactive/);
for (const changes of [{ OWNER_LIVE_RELEASE: "bad" }, { OWNER_TEST_ACCOUNT_A_ID: "0" },
  { OWNER_TEST_ACCOUNT_B_ID: "12345" }, { OPENCLAW_PACKAGE_DIR: "" }]) {
  assert.throws(() => liveSettings({ ...valid, ...changes }, true));
}
const nonInteractive = spawnSync(process.execPath, ["scripts/owner-live-e2e.mjs"], {
  env: { ...process.env, ...valid }, encoding: "utf8", timeout: 10_000,
});
assert.equal(nonInteractive.status, 1);
assert.match(nonInteractive.stderr, /interactive local terminal/);
assert.doesNotMatch(nonInteractive.stdout, /evidence|passed/);
console.log("The staging entry point rejects noninteractive and invalid account or release settings before network access.");
