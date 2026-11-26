// Runs in the selected GitHub Environment; credentials stay on its runner.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifyDeploymentReceipt } from "./verify-deployment-receipt.mjs";
const [command, mode] = process.argv.slice(2);
assert.ok(["test","production"].includes(mode));
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
assert.ok(/^[a-f0-9]{32}$/i.test(account ?? "") && token, "Missing Cloudflare Environment secrets");
const accountPath = "/accounts/" + account;
const script = mode === "test" ? "agent-talk-test" : "agent-talk";
const worker = accountPath + "/workers/scripts/" + script;
const hostname = "agent-talk.nyphon.de";
const project = "ralphschuler/agent-talk:" + mode;

async function api(label, path, {method="GET", body}={}) {
  const response = await fetch("https://api.cloudflare.com/client/v4" + path, {
    method, redirect: "error", signal: AbortSignal.timeout(20000),
    headers: {authorization: "Bearer " + token, "content-type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  assert.ok(response.ok && json.success, label + " HTTP " + response.status + " Cloudflare codes " + (json.errors ?? []).map(e=>e.code).join(","));
  return json;
}

async function checkDomain() {
  const zones = (await api("Zone lookup", "/zones?name=nyphon.de&account.id=" + account)).result;
  assert.equal(zones.length, 1, "Unique target zone required");
  const zone = zones[0];
  assert.ok(/^[0-9a-f]{32}$/i.test(zone.id) && zone.account?.id === account && zone.name === "nyphon.de" && zone.status === "active", "Target zone must be active in this account");
  const domains = (await api("Workers hostname lookup", accountPath + "/workers/domains?hostname=" + hostname)).result;
  assert.equal(domains.length, 1, "The existing production hostname binding is required");
  const domain = domains[0];
  assert.ok(domain.service === script && domain.hostname === hostname && domain.zone_id === zone.id &&
    domain.environment === "production" && domain.enabled !== false && (domain.zone_name === undefined || domain.zone_name === zone.name), "Production hostname belongs to a different Worker, zone or environment, or is disabled");
  console.log("Verified existing hostname " + hostname + " on " + script);
}

async function checkOwner() {
  const configured = (await api("Existing Worker settings", worker + "/settings")).result;
  assert.ok(configured.bindings?.some(b => b.name === "PROJECT_OWNER" && b.type === "plain_text" && b.text === project),
    "Required project ownership marker missing from " + script);
  if (mode === "production") await checkDomain();
}

if (command === "preflight") {
  const release = process.env.EXPECTED_RELEASE;
  assert.match(release ?? "", /^[a-f0-9]{40}$/, "Expected a complete Git commit SHA");
  const built = JSON.parse(await readFile(new URL("../.cloudflare/output/v1/workers/default/worker.config.json", import.meta.url), "utf8"));
  assert.ok(built.name === script && built.env?.PROJECT_OWNER?.value === project && built.env?.RELEASE_SHA?.value === release,
    "Prebuilt Worker targets a different environment or commit");
  for (const [binding, kind] of [["DIRECTORY", "Directory"], ["MAILBOX", "Mailbox"]]) {
    assert.ok(built.env[binding]?.worker === script && built.env[binding]?.exportName === kind, "Prebuilt storage binding targets a different Worker");
  }
}
if (command === "preflight" || command === "inspect") {
  const settings = (await api("Workers account settings", accountPath + "/workers/account-settings")).result;
  console.log("Workers account accessible. Default usage model:", settings.default_usage_model ?? "unspecified");
  await checkOwner();
  console.log("Verified existing project Worker " + script);
} else if (command === "promote") {
  // Consume the pinned CLI's structured JSONL receipt, never a version selected by recency.
  const release = process.env.EXPECTED_RELEASE;
  assert.match(release ?? "", /^[a-f0-9]{40}$/, "Expected a complete Git commit SHA");
  const receipt = await readFile(process.env.WRANGLER_OUTPUT_FILE_PATH, "utf8");
  const uploads = receipt.trim().split("\n").map(line => JSON.parse(line)).filter(row => row.type === "version-upload");
  assert.equal(uploads.length, 1, "Expected exactly one version upload receipt");
  const { worker_name: target, version_id: versionId } = uploads[0];
  assert.equal(target, script, "Version receipt targets another Worker");
  assert.match(versionId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i, "Invalid version ID");
  await checkOwner();
  const version = (await api("Uploaded version", worker + "/versions/" + versionId)).result;
  assert.ok(version.id === versionId && version.annotations?.["workers/message"] === release, "Uploaded version does not match the Git commit");
  const versions = [{ version_id: versionId, percentage: 100 }];
  const creation = (await api("Activate Worker version", worker + "/deployments", {
    method: "POST", body: { strategy: "percentage", versions },
  })).result;
  const deploymentId = await verifyDeploymentReceipt(creation, versionId, async id =>
    (await api("Read activated Worker deployment", worker + "/deployments/" + id)).result);
  console.log("Verified " + script + " deployment " + deploymentId + ", version " + versionId + " at 100% for Git commit " + release);
} else if (command === "verify-owner") {
  await checkOwner();
} else if (command === "storage") {
  const ids = new Set();
  let page = 1;
  const namespaces = [];
  while (true) {
    const batch = await api("Namespace inventory", accountPath + "/workers/durable_objects/namespaces?per_page=100&page=" + page);
    namespaces.push(...batch.result);
    if (batch.result.length < 100 || page >= batch.result_info?.total_pages) break;
    page++;
  }
  for (const service of mode === "test" ? [script] : ["agent-talk-test",script]) {
    for (const kind of ["Directory","Mailbox"]) {
      const matches = namespaces.filter(n=>n.script===service && n.class===kind);
      assert.equal(matches.length,1,"Missing namespace "+service+"/"+kind);
      assert.equal(matches[0].use_sqlite,true);
      ids.add(matches[0].id);
    }
  }
  assert.equal(ids.size,mode === "test" ? 2 : 4);
  console.log(ids.size,"distinct SQLite namespaces verified");
} else throw new Error("Unknown rollout action");
