// Submit only the sanitized output of the interactive runner. No browser state,
// keys, message text, OAuth values or Cloudflare credentials are passed to GitHub.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { evidenceFingerprint, parseObservation } from "./owner-live-workflow-verify.mjs";
try {
  assert.equal(process.argv.length, 3, "Pass the path of the runner's sanitized observation.");
  const data = await readFile(process.argv[2]);
  assert.ok(data.length > 0 && data.length <= 24_000, "Invalid observation size.");
  const record = JSON.parse(data.toString("utf8"));
  assert.equal(record.schema, "agent-talk-staging-observation-v1");
  assert.equal(record.mode, "staging-interactive", "Local fixture records cannot be submitted.");
  assert.equal(record.productionApproval, false);
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.match(head, /^[a-f0-9]{40}$/);
  assert.equal(head, record.release, "The checkout does not match the observed release.");
  const hash = evidenceFingerprint(record);
  parseObservation({ encoded: data.toString("base64url"), expectedHash: hash, release: head,
    deploymentId: record.deployment.deploymentId, versionId: record.deployment.versionId });
  const args = ["workflow", "run", "owner-portal-live-e2e.yml", "--repo", "ralphschuler/agent-talk", "--ref", "main",
    "-f", "observation=" + data.toString("base64url"), "-f", "evidence_sha256=" + hash,
    "-f", "version_id=" + record.deployment.versionId, "-f", "deployment_id=" + record.deployment.deploymentId];
  const result = spawnSync("gh", args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error("Unable to submit the private GitHub workflow; verify existing gh access.");
  console.log("Submitted sanitized observation for protected review. Submission is not a successful live test or production approval.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Observation submission failed.");
  process.exitCode = 1;
}
