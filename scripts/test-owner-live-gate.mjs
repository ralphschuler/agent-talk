import assert from "node:assert/strict";
import { verifyLiveGate } from "./owner-live-release-gate.mjs";

const release = "a".repeat(40);
const acceptanceSteps = ["Human GitHub sign-in", "Separate agents and accounts", "Encrypted direct and group messages", "Revocation and retry"];
const makeJob = (name, names) => ({
  name, status: "completed", conclusion: "success",
  steps: names.map(step => ({ name: step, status: "completed", conclusion: "success" })),
});
function fakeFetch(mode) {
  return async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === "agent-talk-owner-test.ralph-cfd.workers.dev") {
      assert.equal(options.headers, undefined);
      return Response.json({ ok: true, release: mode === "stale-staging" ? "b".repeat(40) : release });
    }
    assert.equal(parsed.hostname, "api.github.com");
    if (mode === "missing-workflow") return new Response("", { status: 404 });
    if (parsed.pathname.endsWith("/jobs")) {
      const jobs = [
        makeJob("Live encrypted acceptance", acceptanceSteps),
        makeJob("Read-only staging storage inspection", ["Inspect staging SQLite ciphertext"]),
      ];
      if (mode === "missing-job") jobs.pop();
      if (mode === "skipped-step") jobs[0].steps[0].conclusion = "skipped";
      if (mode === "failed-job") jobs[1].conclusion = "failure";
      return Response.json({ jobs });
    }
    return Response.json({ workflow_runs: [{
      id: 123, run_attempt: 2, head_sha: mode === "wrong-commit" ? "b".repeat(40) : release,
      head_branch: "main", event: mode === "wrong-event" ? "push" : "workflow_dispatch",
      status: "completed", conclusion: "success", path: ".github/workflows/owner-portal-live-e2e.yml@main",
      head_repository: { full_name: "ralphschuler/agent-talk" },
    }] });
  };
}

assert.deepEqual(await verifyLiveGate({ release, token: "synthetic-token", fetcher: fakeFetch("valid") }), { runId: 123 });
for (const mode of ["stale-staging", "missing-workflow", "missing-job", "skipped-step", "failed-job", "wrong-commit", "wrong-event"]) {
  await assert.rejects(verifyLiveGate({ release, token: "synthetic-token", fetcher: fakeFetch(mode) }));
}
console.log("Production gate rejects missing, stale, skipped and mismatched synthetic live-test evidence.");
