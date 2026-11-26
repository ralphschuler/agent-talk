import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSanitizedObservation } from "./owner-live-record.mjs";
import { syntheticMaterialDigests } from "./owner-live-storage-check.mjs";
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
const dir = await mkdtemp(join(tmpdir(), "agent-talk-record-test-"));
const path = join(dir, "observation.json");
const deployment = { deploymentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", versionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", secret: "synthetic-private-key" };
const storage = { ownerRows: 1, mailboxRows: 1, groupRows: 1, deployment, plaintext: "synthetic-private-message" };
const keys = [1, 2, 3, 4].map(value => createHash("sha256").update("synthetic-key-" + value).digest("base64url"));
const signingKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keys[0], "base64url")]), format: "der", type: "pkcs8" });
const publicKey = createPublicKey(signingKey).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const routing = { agentId: "at1_" + publicKey, deviceId: "at1_" + "B".repeat(43), recipientId: "at1_" + "C".repeat(43),
  groupId: "11111111-1111-4111-8111-111111111111", offlineMessageId: "22222222-2222-4222-8222-222222222222",
  groupMessageId: "33333333-3333-4333-8333-333333333333", secret: "synthetic-private-key" };
const materialDigests = syntheticMaterialDigests(["synthetic-private-message", "synthetic group marker"], keys);
materialDigests[0].secret = "synthetic-private-message";
const input = { path, mode: "synthetic-fixture", release: "d".repeat(40), deployment, startedAt: new Date().toISOString(), routing, materialDigests, signingSecretKey: keys[0] };
try {
  const result = await writeSanitizedObservation(input);
  const contents = await readFile(path, "utf8");
  assert.deepEqual(JSON.parse(contents), result);
  assert.equal(result.productionApproval, false);
  assert.equal(result.mode, "synthetic-fixture");
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.ok(!contents.includes("synthetic-private"));
  for (const key of keys) assert.ok(!contents.includes(key));
  await assert.rejects(writeSanitizedObservation(input), { code: "EEXIST" });
  await assert.rejects(writeSanitizedObservation({ ...input, path: join(dir, "invalid"), release: "bad" }));
  await assert.rejects(writeSanitizedObservation({ ...input, path: join(dir, "invalid"), startedAt: "invalid" }));
  await assert.rejects(writeSanitizedObservation({ ...input, path: join(dir, "invalid"), materialDigests: [] }));
  await assert.rejects(writeSanitizedObservation({ ...input, path: join(dir, "invalid"), deployment: { ...deployment, versionId: "invalid" } }));
  assert.deepEqual(await readdir(dir), ["observation.json"]);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log("Synthetic-only observations are sanitized, atomically published, and reject incomplete or mismatched evidence.");
