import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const repo = "ralphschuler/agent-talk";
const workflow = ".github/workflows/owner-portal-live-e2e.yml";
const requiredJobs = new Map([
  ["Live encrypted acceptance", [
    "Human GitHub sign-in",
    "Separate agents and accounts",
    "Encrypted direct and group messages",
    "Revocation and retry",
  ]],
  ["Read-only staging storage inspection", ["Inspect staging SQLite ciphertext"]],
]);

export async function verifyLiveGate({ release, token, fetcher = fetch }) {
  assert.match(release ?? "", /^[a-f0-9]{40}$/, "Expected a full release SHA.");
  assert.ok(token, "GitHub Actions read token is missing.");
  const health = await fetcher("https://agent-talk-owner-test.ralph-cfd.workers.dev/healthz", {
    redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  assert.ok(health.ok, "Staging health check failed.");
  const live = await health.json();
  assert.ok(live.ok === true && live.release === release, "Staging does not serve this release.");
  async function github(path) {
    const response = await fetcher("https://api.github.com/repos/" + repo + path, {
      headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "user-agent": "agent-talk-release-gate" },
      redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    assert.ok(response.ok, "Required GitHub live-test evidence is unavailable (HTTP " + response.status + ").");
    return response.json();
  }
  const data = await github("/actions/workflows/owner-portal-live-e2e.yml/runs?head_sha=" + release + "&status=success&per_page=100");
  for (const run of data.workflow_runs ?? []) {
    if (run.head_sha !== release || run.head_branch !== "main" || run.event !== "workflow_dispatch" ||
        run.status !== "completed" || run.conclusion !== "success" ||
        run.path?.split("@")[0] !== workflow || run.head_repository?.full_name !== repo ||
        !Number.isSafeInteger(run.id) || !Number.isSafeInteger(run.run_attempt) || run.run_attempt < 1) continue;
    const jobs = await github("/actions/runs/" + run.id + "/attempts/" + run.run_attempt + "/jobs?per_page=100");
    const verified = [...requiredJobs].every(([name, steps]) => {
      const matches = (jobs.jobs ?? []).filter(job => job.name === name);
      return matches.length === 1 && matches[0].status === "completed" && matches[0].conclusion === "success" &&
        steps.every(step => (matches[0].steps ?? []).some(item =>
          item.name === step && item.status === "completed" && item.conclusion === "success"));
    });
    if (verified) return { runId: run.id };
  }
  throw new Error("No complete live encrypted acceptance and storage-inspection run exists for this release.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const evidence = await verifyLiveGate({ release: process.env.EXPECTED_RELEASE, token: process.env.GH_TOKEN });
  console.log("Verified staging live-test run " + evidence.runId + " for the expected release.");
}
