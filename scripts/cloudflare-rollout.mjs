// Runs in the selected GitHub Environment; credentials stay on its runner.
import assert from "node:assert/strict";
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

async function api(label, path, {method="GET", body, absent=false}={}) {
  const response = await fetch("https://api.cloudflare.com/client/v4" + path, {
    method, redirect: "error", signal: AbortSignal.timeout(20000),
    headers: {authorization: "Bearer " + token, "content-type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (absent && response.status === 404 && json.errors?.some(e=>[10007,10090].includes(e.code))) return null;
  assert.ok(response.ok && json.success, label + " HTTP " + response.status + " Cloudflare codes " + (json.errors ?? []).map(e=>e.code).join(","));
  return json;
}

async function checkDomain() {
  const zones = (await api("Zone lookup", "/zones?name=nyphon.de&account.id=" + account)).result;
  assert.equal(zones.length, 1, "Unique target zone required");
  const zone = zones[0];
  assert.ok(zone.account?.id === account && zone.name === "nyphon.de" && zone.status === "active", "Target zone must be active in this account");
  const domains = (await api("Workers hostname lookup", accountPath + "/workers/domains?hostname=" + hostname)).result;
  const records = (await api("Exact DNS lookup", "/zones/" + zone.id + "/dns_records?name=" + hostname)).result;
  const owned = domains.length === 1 && domains[0].service === script && domains[0].hostname === hostname && domains[0].zone_id === zone.id;
  assert.ok(owned || (domains.length === 0 && records.length === 0), "Hostname or DNS record already in use");
  return {zone, owned};
}

if (command === "preflight" || command === "inspect") {
  const settings = (await api("Workers account settings", accountPath + "/workers/account-settings")).result;
  console.log("Workers account accessible. Default usage model:", settings.default_usage_model ?? "unspecified");
  // The owner approved this account's existing Workers Paid subscription.
  const scripts = (await api("Worker name check", accountPath + "/workers/scripts")).result;
  assert.ok(Array.isArray(scripts));
  const current = scripts.find(s => s.id === script);
  if (current) {
    const configured = (await api("Worker identity", worker + "/settings")).result;
    if (!configured.bindings?.some(b => b.name === "PROJECT_OWNER" && b.text === project)) {
      assert.equal(mode, "test", "Existing Worker ownership unverified");
      const deployments = (await api("Pilot ownership", worker + "/deployments")).result;
      const latest = (deployments.deployments ?? deployments).toSorted((a,b)=>Date.parse(b.created_on)-Date.parse(a.created_on))[0];
      assert.ok(latest?.versions?.length === 1 && latest.versions[0].version_id === "ff408d02-e2c3-4cb3-9ec0-937dcf715bd8", "Unexpected pilot version");
    }
  }
  console.log("Worker name:", script, current ? "(same project)" : "(available)");
  if (mode === "production") await checkDomain();
} else if (command === "bind" && mode === "production") {
  const {zone, owned} = await checkDomain();
  if (!owned) {
    await api("Guarded hostname attachment", worker + "/domains/records", {method:"PUT", body:{
      override_scope:false, override_existing_origin:false, override_existing_dns_record:false,
      origins:[{hostname, zone_id:zone.id}],
    }});
  }
  assert.ok((await checkDomain()).owned, "Hostname binding not confirmed");
  console.log("Custom domain attached to", script);
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
