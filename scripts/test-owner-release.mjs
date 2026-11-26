import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = await mkdtemp(join(tmpdir(), "agent-talk-release-test-"));
try {
  const outputDirectory = join(root, "portal/.cloudflare/output/v1/workers/default");
  await mkdir(outputDirectory, { recursive: true });
  const sha = "a".repeat(40);
  const config = { name: "agent-talk-owner-test", env: {
    PROJECT_OWNER: { value: "ralphschuler/agent-talk:owner-test" },
    RELEASE_SHA: { value: sha },
    PORTAL_ORIGIN: { value: "https://agent-talk-owner-test.ralph-cfd.workers.dev" },
    PORTAL_STORE: { worker: "agent-talk-owner-test", exportName: "PortalStore" },
  }, exports: { PortalStore: { storage: "sqlite" } } };
  await writeFile(join(outputDirectory, "worker.config.json"), JSON.stringify(config));
  for (const scenario of ["initial", "owned", "foreign", "shared"]) {
    const output = join(root, scenario + "-output");
    const trace = join(root, scenario + "-trace");
    await writeFile(output, "");
    const result = spawnSync(process.execPath, ["--import", resolve("scripts/owner-release-api-fixture.mjs"),
      resolve("scripts/owner-portal-release.mjs"), "reserve", "test"], {
      cwd: root, encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
        CLOUDFLARE_API_TOKEN: "synthetic-token", EXPECTED_RELEASE: sha, GITHUB_OUTPUT: output,
        OWNER_API_TRACE: trace, OWNER_FAKE_SCENARIO: scenario },
    });
    assert.equal(result.stdout.includes("synthetic-token"), false);
    assert.equal(result.stderr.includes("synthetic-token"), false);
    const requests = await readFile(trace, "utf8");
    if (scenario === "foreign" || scenario === "shared") {
      assert.notEqual(result.status, 0);
      assert.equal(requests.includes("POST "), false);
    } else {
      assert.equal(result.status, 0, result.stderr);
      assert.equal((await readFile(output, "utf8")).trim(), "initial=" + (scenario === "initial"));
      assert.equal(requests.includes("POST "), scenario === "initial");
    }
  }
  const receipt = join(root, "receipt");
  await writeFile(receipt, JSON.stringify({ type: "version-upload", worker_name: "agent-talk-owner-test",
    version_id: "11111111-1111-1111-1111-111111111111" }) + "\n");
  for (const scenario of ["owned", "wrongsha"]) {
    const trace = join(root, "activation-" + scenario);
    const result = spawnSync(process.execPath, ["--import", resolve("scripts/owner-release-api-fixture.mjs"),
      resolve("scripts/owner-portal-release.mjs"), "activate", "test"], {
      cwd: root, encoding: "utf8", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
        CLOUDFLARE_API_TOKEN: "synthetic-token", EXPECTED_RELEASE: sha,
        WRANGLER_OUTPUT_FILE_PATH: receipt, OWNER_API_TRACE: trace, OWNER_FAKE_SCENARIO: scenario },
    });
    const requests = await readFile(trace, "utf8");
    assert.equal(result.status === 0, scenario === "owned", result.stderr);
    assert.equal(requests.includes("POST "), scenario === "owned");
    assert.equal(result.stderr.includes("synthetic-token"), false);
  }
  console.log("Release preflight reserved only an absent Worker and rejected a foreign Worker.");
} finally {
  await rm(root, { recursive: true, force: true });
}
