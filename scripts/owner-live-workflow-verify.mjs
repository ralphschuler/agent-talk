// Validate a maintainer-attested local observation. This process never performs
// the interactive browser test; repository and environment approval are trust boundaries.
import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { pathToFileURL } from "node:url";

const repo = "ralphschuler/agent-talk";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const agent = /^at1_[A-Za-z0-9_-]{43}$/;
const maxAge = 30 * 60_000;

export function evidenceFingerprint(record) {
  const route = record.routing;
  const material = record.materialDigests.map(item => [item.kind, item.length, item.sha256].join(":" )).sort();
  return createHash("sha256").update(JSON.stringify([record.release, record.deployment.deploymentId, record.deployment.versionId,
    route.agentId, route.deviceId, route.recipientId, route.groupId, route.offlineMessageId, route.groupMessageId, material])).digest("hex");
}

export function parseObservation({ encoded, expectedHash, release, deploymentId, versionId, now = Date.now() }) {
  assert.ok(typeof encoded === "string" && encoded.length <= 32000 && /^[A-Za-z0-9_-]+$/.test(encoded), "Invalid evidence encoding.");
  const bytes = Buffer.from(encoded, "base64url");
  assert.equal(bytes.toString("base64url"), encoded, "Evidence encoding is not canonical.");
  const record = JSON.parse(bytes.toString("utf8"));
  assert.ok(record && Object.getPrototypeOf(record) === Object.prototype);
  assert.deepEqual(Object.keys(record).sort(), ["deployment", "materialDigests", "mode", "observedAt", "productionApproval", "release", "routing", "schema", "signature", "startedAt", "storage"]);
  assert.equal(record.schema, "agent-talk-staging-observation-v2");
  assert.equal(record.mode, "staging-interactive", "Offline fixtures cannot authorize production.");
  assert.equal(record.productionApproval, false);
  assert.equal(record.release, release);
  assert.deepEqual(record.deployment, { deploymentId, versionId });
  assert.deepEqual(record.storage, { status: "pending" });
  const time = Date.parse(record.observedAt);
  assert.ok(Number.isFinite(time) && new Date(time).toISOString() === record.observedAt && time <= now && now - time <= maxAge,
    "The observation is stale or has a future timestamp.");
  const started = Date.parse(record.startedAt);
  assert.ok(Number.isFinite(started) && new Date(started).toISOString() === record.startedAt &&
    started <= time && time - started <= 2 * 60 * 60_000, "Invalid observation window.");
  const routeNames = ["agentId", "deviceId", "recipientId", "groupId", "offlineMessageId", "groupMessageId"];
  assert.deepEqual(Object.keys(record.routing ?? {}).sort(), [...routeNames].sort());
  for (const name of routeNames.slice(0, 3)) assert.match(record.routing[name], agent);
  for (const name of routeNames.slice(3)) assert.match(record.routing[name], uuid);
  assert.match(record.signature ?? "", /^[A-Za-z0-9_-]{86}$/);
  const signature = Buffer.from(record.signature, "base64url");
  const publicBytes = Buffer.from(record.routing.agentId.slice(4), "base64url");
  assert.ok(signature.length === 64 && signature.toString("base64url") === record.signature && publicBytes.length === 32 &&
    publicBytes.toString("base64url") === record.routing.agentId.slice(4), "Invalid synthetic signature encoding.");
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicBytes]), format: "der", type: "spki" });
  const { signature: _signature, ...unsigned } = record;
  assert.ok(verify(null, Buffer.from(JSON.stringify(unsigned)), publicKey, signature), "Invalid synthetic observation signature.");
  const digests = record.materialDigests;
  assert.ok(Array.isArray(digests) && digests.length >= 18 && digests.length <= 64 && digests.every(item => item &&
    JSON.stringify(Object.keys(item).sort()) === JSON.stringify(["kind", "length", "sha256"]) &&
    ["message", "key"].includes(item.kind) && Number.isInteger(item.length) && item.length >= 16 && item.length <= 256 &&
    /^[a-f0-9]{64}$/.test(item.sha256)) && digests.filter(item => item.kind === "message").length >= 2 &&
    digests.filter(item => item.kind === "key").length >= 16 &&
    new Set(digests.map(item => item.kind + ":" + item.length + ":" + item.sha256)).size === digests.length);
  assert.equal(evidenceFingerprint(record), expectedHash, "Evidence fingerprint mismatch.");
  return record;
}

export async function verifyObservation({ encoded, expectedHash, release, deploymentId, versionId, runId, runAttempt,
  ref, token, now = Date.now(), fetcher = fetch }) {
  assert.equal(ref, "refs/heads/main", "Only the protected main release is eligible.");
  assert.match(release ?? "", /^[a-f0-9]{40}$/);
  assert.match(expectedHash ?? "", /^[a-f0-9]{64}$/);
  assert.ok(uuid.test(deploymentId ?? "") || /^[a-f0-9]{32}$/i.test(deploymentId ?? ""));
  assert.match(versionId ?? "", uuid);
  assert.ok(Number.isSafeInteger(runId) && runId > 0 && runAttempt === 1, "Rerun attempts cannot approve evidence.");
  assert.ok(token, "GitHub Actions read token is required.");
  const record = parseObservation({ encoded, expectedHash, release, deploymentId, versionId, now });
  const time = Date.parse(record.startedAt);
  async function api(path) {
    const response = await fetcher("https://api.github.com/repos/" + repo + path, { redirect: "error",
      headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "user-agent": "agent-talk-live-verifier" },
      signal: AbortSignal.timeout(20_000) });
    assert.ok(response.ok, "GitHub provenance verification failed: HTTP " + response.status);
    return response.json();
  }
  assert.equal((await api("/git/ref/heads/main")).object.sha, release, "Main changed after the staging test.");
  const approvals = await api("/actions/runs/" + runId + "/approvals");
  const approved = approvals.filter(item => item.state === "approved" && item.user?.type === "User" &&
    item.environments?.some(environment => environment.name === "test"));
  assert.ok(approved.length > 0, "A recorded test-environment maintainer approval is required.");
  let maintainer = false;
  for (const item of approved) {
    if (!/^[A-Za-z0-9-]{1,39}$/.test(item.user.login ?? "")) continue;
    const permission = await api("/collaborators/" + encodeURIComponent(item.user.login) + "/permission");
    if (["admin", "maintain"].includes(permission.permission)) { maintainer = true; break; }
  }
  assert.ok(maintainer, "The recorded reviewer is not a current maintainer.");
  async function runs(workflow, predicate) {
    for (let page = 1; page <= 10; page++) {
      const result = await api("/actions/workflows/" + workflow + "/runs?head_sha=" + release + "&status=success&per_page=100&page=" + page);
      assert.ok(Array.isArray(result.workflow_runs));
      for (const run of result.workflow_runs) if (await predicate(run)) return true;
      if (result.workflow_runs.length < 100) return false;
    }
    throw new Error("GitHub run history exceeds the verification limit.");
  }
  const official = await runs("owner-portal-test.yml", async run => {
    if (run.head_sha !== release || run.head_branch !== "main" || run.event !== "workflow_dispatch" ||
        run.conclusion !== "success" || run.status !== "completed" || run.head_repository?.full_name !== repo ||
        run.path?.split("@")[0] !== ".github/workflows/owner-portal-test.yml" ||
        !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || !Number.isFinite(Date.parse(run.updated_at)) ||
        Date.parse(run.updated_at) > time) return false;
    const result = await api("/actions/runs/" + run.id + "/attempts/" + run.run_attempt + "/jobs?per_page=100");
    return (result.jobs ?? []).some(job => job.conclusion === "success" && job.status === "completed" &&
      (job.steps ?? []).some(step => step.name === "Verify the deployed version and unauthenticated boundary" && step.conclusion === "success"));
  });
  assert.ok(official, "No successful official staging deployment precedes this observation.");
  const title = "Owner live evidence " + expectedHash + " " + versionId + " " + deploymentId;
  const replay = await runs("owner-portal-live-e2e.yml", async run => run.id !== runId && run.display_title === title &&
    run.head_repository?.full_name === repo && run.head_branch === "main" && run.event === "workflow_dispatch" && run.conclusion === "success");
  assert.equal(replay, false, "This evidence was already accepted.");
  return record;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await verifyObservation({ encoded: process.env.OWNER_LIVE_OBSERVATION, expectedHash: process.env.OWNER_LIVE_HASH,
      release: process.env.GITHUB_SHA, deploymentId: process.env.OWNER_LIVE_DEPLOYMENT, versionId: process.env.OWNER_LIVE_VERSION,
      runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), ref: process.env.GITHUB_REF,
      token: process.env.GH_TOKEN });
    console.log("Validated a maintainer-approved local observation and official staging provenance; this job did not run the browser test.");
  } catch {
    console.error("Live observation verification failed; production remains gated.");
    process.exitCode = 1;
  }
}
