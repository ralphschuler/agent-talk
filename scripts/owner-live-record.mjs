// A local observation, not production approval. Only whitelisted synthetic
// metadata is serialized; no plaintext, keys, OAuth material or cookies.
import assert from "node:assert/strict";
import { createPrivateKey, createPublicKey, randomBytes, sign } from "node:crypto";
import { link, open, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export async function writeSanitizedObservation({ path, release, deployment, startedAt, routing, materialDigests, signingSecretKey, mode = "staging-interactive" }) {
  assert.ok(typeof path === "string" && path.length > 0, "An output path is required.");
  assert.match(release ?? "", /^[a-f0-9]{40}$/, "An exact release is required.");
  assert.ok(["staging-interactive", "synthetic-fixture"].includes(mode), "Invalid observation mode.");
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.ok(deployment && (uuid.test(deployment.deploymentId ?? "") || /^[a-f0-9]{32}$/i.test(deployment.deploymentId ?? "")) &&
    uuid.test(deployment.versionId ?? ""), "An exact deployment and version are required.");
  const started = Date.parse(startedAt);
  assert.ok(Number.isFinite(started) && new Date(started).toISOString() === startedAt && started <= Date.now() &&
    Date.now() - started <= 2 * 60 * 60_000, "A fresh staging start time is required.");
  const agent = /^at1_[A-Za-z0-9_-]{43}$/;
  for (const name of ["agentId", "deviceId", "recipientId"]) assert.match(routing?.[name] ?? "", agent, "Invalid synthetic routing identity.");
  for (const name of ["groupId", "offlineMessageId", "groupMessageId"]) assert.match(routing?.[name] ?? "", uuid, "Invalid synthetic routing identifier.");
  assert.ok(Array.isArray(materialDigests) && materialDigests.length >= 18 && materialDigests.length <= 64 &&
    materialDigests.every(item => item && ["message", "key"].includes(item.kind) && Number.isInteger(item.length) &&
      item.length >= 16 && item.length <= 256 && /^[a-f0-9]{64}$/.test(item.sha256)) &&
    materialDigests.filter(item => item.kind === "message").length >= 2 &&
    materialDigests.filter(item => item.kind === "key").length >= 16 &&
    new Set(materialDigests.map(item => item.kind + ":" + item.length + ":" + item.sha256)).size === materialDigests.length,
  "Invalid synthetic material digests.");
  assert.match(signingSecretKey ?? "", /^[A-Za-z0-9_-]{43}$/, "A disposable agent signing key is required.");
  const seed = Buffer.from(signingSecretKey, "base64url");
  assert.ok(seed.length === 32 && seed.toString("base64url") === signingSecretKey);
  const privateKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
  assert.equal("at1_" + publicKey, routing.agentId, "Signing key does not match the synthetic sender.");
  const unsigned = { schema: "agent-talk-staging-observation-v2", mode, release,
    deployment: { deploymentId: deployment.deploymentId, versionId: deployment.versionId },
    storage: { status: "pending" }, startedAt,
    routing: Object.fromEntries(["agentId", "deviceId", "recipientId", "groupId", "offlineMessageId", "groupMessageId"].map(name => [name, routing[name]])),
    materialDigests: materialDigests.map(({ kind, length, sha256 }) => ({ kind, length, sha256 })),
    observedAt: new Date().toISOString(),
    productionApproval: false };
  const record = { ...unsigned, signature: sign(null, Buffer.from(JSON.stringify(unsigned)), privateKey).toString("base64url") };
  const temporary = join(dirname(path), "." + basename(path) + "." + randomBytes(16).toString("hex") + ".tmp");
  let file;
  let created = false;
  try {
    file = await open(temporary, "wx", 0o600);
    created = true;
    await file.writeFile(JSON.stringify(record) + "\n");
    await file.sync();
    await file.close();
    file = undefined;
    // link() publishes atomically and refuses to overwrite an existing record.
    await link(temporary, path);
  } finally {
    if (file) await file.close();
    if (created) await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  return record;
}
