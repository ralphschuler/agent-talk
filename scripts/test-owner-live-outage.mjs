import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir = await mkdtemp(join(tmpdir(), "agent-talk-outage-test-"));
const flag = join(dir, "blocked");
const calls = [];
const original = globalThis.fetch;
globalThis.fetch = async input => { calls.push(String(input)); return new Response("ok"); };
process.env.OWNER_TEST_PORTAL_ORIGIN = "http://localhost:5174";
process.env.OWNER_TEST_BLOCK_FILE = flag;
try {
  await import("./owner-live-portal-outage.mjs");
  await writeFile(flag, "", { mode: 0o600 });
  await assert.rejects(fetch("http://localhost:5174/copy/publish"), /client-local portal interruption/);
  assert.equal((await fetch("http://localhost:5174/healthz")).status, 200);
  assert.equal((await fetch("https://agent-talk-test.ralph-cfd.workers.dev/copy/publish")).status, 200);
  assert.equal(calls.length, 2);
  await unlink(flag);
  assert.equal((await fetch("http://localhost:5174/copy/publish")).status, 200);
  assert.equal(calls.length, 3);
} finally {
  globalThis.fetch = original;
  await rm(dir, { recursive: true, force: true });
}
console.log("Client-local outage affects only synthetic owner-copy publication and recovers after the flag is removed.");
