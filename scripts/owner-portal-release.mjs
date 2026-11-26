// Release helper. It never logs credentials or reads owner messages.
import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import { verifyDeploymentReceipt } from "./verify-deployment-receipt.mjs";

const [action, target] = process.argv.slice(2);
assert.ok(["test", "production"].includes(target));
const name = target === "test" ? "agent-talk-owner-test" : "agent-talk-owner";
const origin = "https://" + name + ".ralph-cfd.workers.dev";
const project = "ralphschuler/agent-talk:owner-" + target;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
const release = process.env.EXPECTED_RELEASE;
assert.match(account ?? "", /^[a-f0-9]{32}$/i, "Cloudflare account ID is missing.");
assert.ok(token, "Cloudflare API token is missing.");
assert.match(release ?? "", /^[a-f0-9]{40}$/, "A full release SHA is required.");
const base = "https://api.cloudflare.com/client/v4/accounts/" + account + "/workers";

async function api(path, options = {}) {
  const response = await fetch(base + path, {
    method: options.method ?? "GET", redirect: "error",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json();
  assert.ok(response.ok && data.success, "Cloudflare request failed with HTTP " + response.status);
  return data;
}

async function owned() {
  const settings = (await api("/scripts/" + name + "/settings")).result;
  const bindings = settings.bindings ?? [];
  assert.ok(bindings.some(item => item.name === "PROJECT_OWNER" && item.type === "plain_text" && item.text === project),
    "Existing Worker ownership marker does not match.");
  assert.ok(bindings.some(item => item.name === "PORTAL_ORIGIN" && item.type === "plain_text" && item.text === origin),
    "Existing Worker origin does not match.");
  const store = bindings.find(item => item.name === "PORTAL_STORE" && item.type === "durable_object_namespace");
  assert.ok(store?.namespace_id, "Existing Worker has no owner storage namespace.");
  let page = 1;
  const matches = [];
  const otherMatches = [];
  const otherName = target === "test" ? "agent-talk-owner" : "agent-talk-owner-test";
  for (;;) {
    const result = await api("/durable_objects/namespaces?per_page=100&page=" + page);
    matches.push(...result.result.filter(item => item.script === name && item.class === "PortalStore"));
    otherMatches.push(...result.result.filter(item => item.script === otherName && item.class === "PortalStore"));
    if (page >= (result.result_info?.total_pages ?? 1)) break;
    page++;
  }
  assert.equal(matches.length, 1, "Expected one owner storage namespace.");
  assert.equal(matches[0].id, store.namespace_id, "Owner storage belongs to another namespace.");
  assert.equal(matches[0].use_sqlite, true, "Owner storage must use SQLite.");
  assert.ok(otherMatches.every(item => item.id !== matches[0].id), "Test and production cannot share owner storage.");
}

if (action === "reserve") {
  const built = JSON.parse(await readFile("portal/.cloudflare/output/v1/workers/default/worker.config.json", "utf8"));
  assert.equal(built.name, name);
  assert.equal(built.env.PROJECT_OWNER.value, project);
  assert.equal(built.env.RELEASE_SHA.value, release);
  assert.equal(built.env.PORTAL_ORIGIN.value, origin);
  assert.equal(built.env.PORTAL_STORE.worker, name);
  assert.equal(built.env.PORTAL_STORE.exportName, "PortalStore");
  assert.equal(built.exports.PortalStore.storage, "sqlite");
  assert.equal((await api("/subdomain")).result.subdomain, "ralph-cfd", "Unexpected workers.dev account suffix.");
  const names = new Set();
  let page = 1;
  for (;;) {
    const result = await api("/scripts?per_page=100&page=" + page);
    for (const item of result.result) names.add(item.id);
    if (page >= (result.result_info?.total_pages ?? 1)) break;
    page++;
  }
  let initial = false;
  if (names.has(name)) {
    await owned();
  } else {
    // POST is create-only. A competing creation must fail instead of replacing it.
    const created = (await api("/workers", { method: "POST", body: {
      name, tags: ["agent-talk-owner-" + target], observability: { enabled: false },
    } })).result;
    assert.equal(created.name, name, "Cloudflare reserved a different Worker.");
    assert.match(created.id ?? "", /^[a-f0-9]{32}$/i, "Cloudflare did not return a Worker ID.");
    initial = true;
  }
  assert.ok(process.env.GITHUB_OUTPUT, "GitHub output path is required.");
  await appendFile(process.env.GITHUB_OUTPUT, "initial=" + initial + "\n");
  console.log(initial ? "Reserved a new Worker." : "Verified an existing owned Worker.");
} else if (action === "activate") {
  await owned();
  const receipt = await readFile(process.env.WRANGLER_OUTPUT_FILE_PATH, "utf8");
  const uploads = receipt.trim().split("\n").map(line => JSON.parse(line)).filter(item => item.type === "version-upload");
  assert.equal(uploads.length, 1, "Expected one version upload receipt.");
  const uploaded = uploads[0];
  assert.equal(uploaded.worker_name, name);
  assert.match(uploaded.version_id ?? "", /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i);
  const version = (await api("/scripts/" + name + "/versions/" + uploaded.version_id)).result;
  assert.equal(version.annotations?.["workers/message"], release, "Uploaded version is not the verified commit.");
  const created = (await api("/scripts/" + name + "/deployments", {
    method: "POST", body: { strategy: "percentage", versions: [{ version_id: uploaded.version_id, percentage: 100 }] },
  })).result;
  await verifyDeploymentReceipt(created, uploaded.version_id, async id => (await api("/scripts/" + name + "/deployments/" + id)).result);
  console.log("Verified activation of the uploaded version.");
} else if (action === "verify") {
  await owned();
  let healthy = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const health = await fetch(origin + "/healthz", { redirect: "error", signal: AbortSignal.timeout(5_000) });
      healthy = health.ok && (await health.json()).release === release;
      if (healthy) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  assert.ok(healthy, "The exact release did not become healthy.");
  const page = await fetch(origin + "/", { redirect: "error" });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/i);
  const accountResponse = await fetch(origin + "/auth/account", { redirect: "error" });
  assert.equal(accountResponse.status, 401);
  const login = await fetch(origin + "/auth/login", { method: "POST", headers: { origin }, redirect: "error" });
  assert.equal(login.status, 200);
  const authorize = new URL((await login.json()).url);
  assert.equal(authorize.origin, "https://github.com");
  assert.equal(authorize.searchParams.get("redirect_uri"), origin + "/auth/callback");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorize.searchParams.get("client_id") === process.env.OWNER_OAUTH_CLIENT_ID, "OAuth client configuration does not match.");
  console.log("Verified live release, page, unauthenticated denial and OAuth initiation.");
} else {
  throw new Error("Unknown release action.");
}
