// All records and GitHub responses below exist only in memory. No workflow runs.
import assert from "node:assert/strict";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { evidenceFingerprint, verifyObservation } from "./owner-live-workflow-verify.mjs";
import { syntheticMaterialDigests } from "./owner-live-storage-check.mjs";
const now = Date.now();
const release = "a".repeat(40);
const deployment = { deploymentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", versionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const keys = [1, 2, 3, 4].map(n => createHash("sha256").update("test-" + n).digest("base64url"));
const signingKey = createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(keys[0], "base64url")]), format: "der", type: "pkcs8" });
const publicKey = createPublicKey(signingKey).export({ format: "der", type: "spki" }).subarray(-32).toString("base64url");
const signRecord = input => {
  const { signature: ignored, ...unsigned } = input;
  return { ...unsigned, signature: sign(null, Buffer.from(JSON.stringify(unsigned)), signingKey).toString("base64url") };
};
const record = signRecord({ schema: "agent-talk-staging-observation-v1", mode: "staging-interactive", release, deployment,
  storage: { ownerRows: 1, mailboxRows: 1, groupRows: 1 }, routing: {
    agentId: "at1_" + publicKey, deviceId: "at1_" + "B".repeat(43), recipientId: "at1_" + "C".repeat(43),
    groupId: "11111111-1111-4111-8111-111111111111", offlineMessageId: "22222222-2222-4222-8222-222222222222",
    groupMessageId: "33333333-3333-4333-8333-333333333333" },
  materialDigests: syntheticMaterialDigests(["synthetic direct message", "synthetic group message"], keys),
  observedAt: new Date(now - 1000).toISOString(), productionApproval: false });
function response(mode, fingerprint) {
  return async url => {
    const path = new URL(url).pathname;
    if (path.endsWith("/git/ref/heads/main")) return Response.json({ object: { sha: mode === "changed-main" ? "f".repeat(40) : release } });
    if (path.endsWith("/approvals")) return Response.json(mode === "no-approval" ? [] : [{ state: "approved", user: { login: "maintainer", type: "User" }, environments: [{ name: "test" }] }]);
    if (path.endsWith("/permission")) return Response.json({ permission: mode === "no-maintainer" ? "write" : "admin" });
    if (path.endsWith("/jobs")) return Response.json({ jobs: [{ conclusion: "success", status: "completed", steps: [{ name: "Verify the deployed version and unauthenticated boundary", conclusion: mode === "deploy-failed" ? "failure" : "success" }] }] });
    if (path.includes("owner-portal-test.yml")) return Response.json({ workflow_runs: [{ id: 111, run_attempt: 1, head_sha: release,
      head_branch: "main", event: "workflow_dispatch", conclusion: "success", status: "completed", head_repository: { full_name: "ralphschuler/agent-talk" },
      path: ".github/workflows/owner-portal-test.yml@main", updated_at: new Date(now - 2000).toISOString() }] });
    if (path.includes("owner-portal-live-e2e.yml")) return Response.json({ workflow_runs: mode === "replay" ? [{ id: 999,
      display_title: "Owner live evidence " + fingerprint + " " + deployment.versionId + " " + deployment.deploymentId,
      head_repository: { full_name: "ralphschuler/agent-talk" }, head_branch: "main", event: "workflow_dispatch", conclusion: "success" }] : [] });
    throw new Error("Unexpected request");
  };
}
async function run(value, mode = "valid", changes = {}) {
  const hash = evidenceFingerprint(value);
  return verifyObservation({ encoded: Buffer.from(JSON.stringify(value)).toString("base64url"), expectedHash: hash, release,
    ...deployment, runId: 123, runAttempt: 1, ref: "refs/heads/main", token: "synthetic", now, fetcher: response(mode, hash), ...changes });
}
assert.equal((await run(record)).release, release);
for (const mode of ["changed-main", "no-approval", "no-maintainer", "deploy-failed", "replay"]) await assert.rejects(run(record, mode));
await assert.rejects(run(signRecord({ ...record, mode: "synthetic-fixture" })));
await assert.rejects(run(signRecord({ ...record, observedAt: new Date(now - 1_800_001).toISOString() })));
await assert.rejects(run(signRecord({ ...record, observedAt: new Date(now + 1000).toISOString() })));
await assert.rejects(run({ ...record, observedAt: new Date(now).toISOString() }), /signature/);
await assert.rejects(run({ ...record, unexpected: "private" }));
await assert.rejects(run(record, "valid", { runAttempt: 2 }));
await assert.rejects(run(record, "valid", { ref: "refs/heads/feature" }));
await assert.rejects(run(record, "valid", { expectedHash: "f".repeat(64) }));
assert.equal(evidenceFingerprint(record), evidenceFingerprint({ ...record, observedAt: new Date(now).toISOString(), materialDigests: [...record.materialDigests].reverse() }));
console.log("In-memory fixtures verify approval, exact staging provenance, freshness and replay rejection; no live evidence was created.");
