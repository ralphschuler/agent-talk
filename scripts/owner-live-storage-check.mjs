// Read only synthetic staging records. Plaintext markers and keys remain in the
// caller process; the Cloudflare SQL requests contain public routing IDs only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const API = "https://api.cloudflare.com/client/v4/accounts/";
const agentPattern = /^at1_[A-Za-z0-9_-]{43}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function inspect(value, markers) {
  if (typeof value === "string") {
    const bytes = Buffer.from(value);
    assert.ok(markers.every(marker => !bytes.includes(marker)), "Private test material appeared in remote storage.");
    if (/^[A-Za-z0-9_-]+$/.test(value)) {
      const decoded = Buffer.from(value, "base64url");
      assert.ok(markers.every(marker => !decoded.includes(marker)), "Private test material appeared in remote storage.");
    } else if (value.startsWith("{") || value.startsWith("[")) {
      let parsed;
      try { parsed = JSON.parse(value); } catch { return; }
      inspect(parsed, markers);
    }
  } else if (Array.isArray(value)) {
    if (value.length && value.every(entry => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
      const bytes = Buffer.from(value);
      assert.ok(markers.every(marker => !bytes.includes(marker)), "Private test material appeared in remote storage.");
    }
    for (const entry of value) inspect(entry, markers);
  } else if (value && typeof value === "object") {
    for (const entry of Object.values(value)) inspect(entry, markers);
  }
}

export async function checkLiveStorage({ account, token, release, agentId, deviceId, recipientId, groupId,
  offlineMessageId, groupMessageId, messageMarkers, privateKeys, fetcher = fetch }) {
  assert.ok(typeof account === "string" && /^[a-f0-9]{32}$/i.test(account), "Invalid Cloudflare account ID.");
  assert.ok(typeof token === "string" && token.length > 0);
  assert.ok(typeof release === "string" && /^[a-f0-9]{40}$/.test(release), "Invalid staging release.");
  for (const id of [agentId, deviceId, recipientId]) assert.ok(typeof id === "string" && agentPattern.test(id), "Invalid synthetic public identity.");
  for (const id of [groupId, offlineMessageId, groupMessageId]) assert.ok(typeof id === "string" && uuidPattern.test(id), "Invalid synthetic message identifier.");
  const ownerCopyId = createHash("sha256").update(JSON.stringify([agentId, offlineMessageId])).digest("hex");
  assert.ok(Array.isArray(messageMarkers) && messageMarkers.length >= 2 &&
    messageMarkers.every(value => typeof value === "string" && value.length >= 16), "Direct and group test markers are required.");
  assert.ok(Array.isArray(privateKeys) && privateKeys.length >= 4 && new Set(privateKeys).size === privateKeys.length &&
    privateKeys.every(value => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) &&
      Buffer.from(value, "base64url").length === 32 && Buffer.from(value, "base64url").toString("base64url") === value),
  "Distinct synthetic endpoint private keys are required.");
  const needles = [...messageMarkers, ...privateKeys].flatMap(value => {
    const values = [Buffer.from(value)];
    if (/^[A-Za-z0-9_-]{43}$/.test(value)) {
      const key = Buffer.from(value, "base64url");
      if (key.length === 32) values.push(key, Buffer.from(key.toString("base64")), Buffer.from(key.toString("hex")));
    }
    return values;
  });
  const base = API + account + "/workers";
  async function request(path, body) {
    const response = await fetcher(base + path, {
      method: body ? "POST" : "GET", redirect: "error",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      ...(body && { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
    });
    assert.ok(response.ok, "Cloudflare storage inspection failed with HTTP " + response.status);
    const data = await response.json();
    assert.equal(data.success, true, "Cloudflare storage inspection was unsuccessful.");
    return data;
  }
  async function exactRelease() {
    const response = await fetcher("https://agent-talk-owner-test.ralph-cfd.workers.dev/healthz",
      { redirect: "error", signal: AbortSignal.timeout(20_000) });
    assert.ok(response.ok, "Staging health check failed.");
    const health = await response.json();
    assert.ok(health.ok === true && health.release === release, "Staging is not running the expected release.");
  }
  await exactRelease();
  const settings = (await request("/scripts/agent-talk-owner-test/settings")).result;
  assert.ok(settings.bindings?.some(item => item.name === "PROJECT_OWNER" && item.type === "plain_text" &&
    item.text === "ralphschuler/agent-talk:owner-test"), "Staging ownership marker does not match.");
  async function activeDeployment() {
    const deployments = [];
    for (let page = 1; ; page++) {
      const data = await request("/scripts/agent-talk-owner-test/deployments?per_page=100&page=" + page);
      assert.ok(Array.isArray(data.result?.deployments), "Staging deployment inventory is invalid.");
      deployments.push(...data.result.deployments);
      if (page >= (data.result_info?.total_pages ?? 1)) break;
    }
    assert.ok(deployments.length > 0 && deployments.every(item => Number.isFinite(Date.parse(item.created_on))),
      "Staging has no valid deployment.");
    deployments.sort((left, right) => Date.parse(right.created_on) - Date.parse(left.created_on));
    if (deployments.length > 1) assert.notEqual(deployments[0].created_on, deployments[1].created_on, "Staging deployment order is ambiguous.");
    const active = deployments[0];
    assert.ok(Array.isArray(active.versions) && active.versions.length === 1 && active.versions[0].percentage === 100 &&
      (uuidPattern.test(active.id ?? "") || /^[a-f0-9]{32}$/i.test(active.id ?? "")) &&
      uuidPattern.test(active.versions[0].version_id ?? ""), "Staging must serve one complete version.");
    const versionId = active.versions[0].version_id;
    const version = (await request("/scripts/agent-talk-owner-test/versions/" + encodeURIComponent(versionId))).result;
    assert.ok(version.id === versionId && version.annotations?.["workers/message"] === release,
      "The active staging version is not the expected commit.");
    return { deploymentId: active.id, versionId };
  }
  const before = await activeDeployment();
  const namespaces = [];
  for (let page = 1; ; page++) {
    const data = await request("/durable_objects/namespaces?per_page=100&page=" + page);
    namespaces.push(...data.result);
    if (page >= (data.result_info?.total_pages ?? 1)) break;
  }
  function namespace(script, className) {
    const found = namespaces.filter(item => item.script === script && item.class === className && item.use_sqlite === true);
    assert.equal(found.length, 1, "Expected one isolated staging SQLite namespace.");
    return found[0].id;
  }
  const owner = namespace("agent-talk-owner-test", "PortalStore");
  const mailbox = namespace("agent-talk-test", "Mailbox");
  const directory = namespace("agent-talk-test", "Directory");
  assert.equal(new Set([owner, mailbox, directory]).size, 3, "Staging namespaces must be distinct.");
  async function query(namespaceId, objectName, sql, params) {
    const data = await request("/durable_objects/namespaces/" + encodeURIComponent(namespaceId) + "/query/v2", {
      durable_object_name: objectName, jurisdiction: "none", queries: [{ sql, params }],
    });
    assert.ok(!data.result.error, "Cloudflare rejected a read-only test query.");
    const rows = data.result.results?.[0]?.rows;
    assert.ok(Array.isArray(rows), "Cloudflare returned no test rows.");
    return rows;
  }
  const ownerRows = await query(owner, "owner-portal",
    "SELECT envelope_json FROM owner_copies WHERE agent_id = ? AND device_id = ? AND message_id = ?", [agentId, deviceId, ownerCopyId]);
  const mailboxRows = await query(mailbox, recipientId, "SELECT envelope FROM queue WHERE sender = ? AND id = ?", [agentId, offlineMessageId]);
  const groupRows = await query(directory, "directory",
    "SELECT payload, welcome FROM g_log WHERE gid = ? AND opid = ? AND kind = ?", [groupId, groupMessageId, "app"]);
  assert.ok(ownerRows.length === 1 && mailboxRows.length === 1 && groupRows.length === 1,
    "Expected the exact synthetic owner, offline mailbox and group records.");
  for (const rows of [ownerRows, mailboxRows, groupRows]) inspect(rows, needles);
  function decodeJson(value) {
    assert.equal(typeof value, "string", "A test ciphertext record is missing.");
    let parsed;
    try { parsed = JSON.parse(value); } catch { throw new Error("A test ciphertext record is invalid."); }
    assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed), "A test ciphertext record is invalid.");
    return parsed;
  }
  function canonicalBytes(value, min, max = min) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
    const bytes = Buffer.from(value, "base64url");
    return bytes.length >= min && bytes.length <= max && bytes.toString("base64url") === value;
  }
  function envelope(row, id, recipient, ownerCopy) {
    const value = decodeJson(row[0]);
    assert.ok(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["ciphertext", "createdAt", "enc", "id", "recipientId", "senderId", "version"]), "Invalid test envelope fields.");
    assert.ok((value.version === 1 || (!ownerCopy && value.version === 2)) && value.id === id &&
      value.senderId === agentId && value.recipientId === recipient && Number.isSafeInteger(value.createdAt) &&
      canonicalBytes(value.enc, 32) && canonicalBytes(value.ciphertext, 16, ownerCopy ? 90_016 : 48_016),
      "A test envelope does not match its route or ciphertext format.");
  }
  envelope(ownerRows[0], ownerCopyId, deviceId, true);
  envelope(mailboxRows[0], offlineMessageId, recipientId, false);
  const group = decodeJson(groupRows[0][0]);
  assert.ok(JSON.stringify(Object.keys(group).sort()) === JSON.stringify(["actor", "epoch", "groupId", "id", "kind", "relay", "signature", "wire"]), "Invalid test group fields.");
  assert.ok(group.kind === "app" && group.id === groupMessageId && group.groupId === groupId &&
    group.actor === agentId && group.relay === "https://agent-talk-test.ralph-cfd.workers.dev" &&
    Number.isSafeInteger(group.epoch) && group.epoch >= 0 && canonicalBytes(group.signature, 64) &&
    canonicalBytes(group.wire, 16, 65_536), "The test group record does not contain the expected encrypted application.");
  await exactRelease();
  const after = await activeDeployment();
  assert.deepEqual(after, before, "Staging deployment changed during inspection.");
  return { ownerRows: ownerRows.length, mailboxRows: mailboxRows.length, groupRows: groupRows.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += chunk.length;
      if (size > 64_000) throw new Error("Input too large.");
      chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    await checkLiveStorage({ ...input, account: process.env.CLOUDFLARE_ACCOUNT_ID, token: process.env.CLOUDFLARE_API_TOKEN });
    console.log("Synthetic staging storage passed the read-only private-material check.");
  } catch {
    console.error("Staging storage check failed. No release evidence was recorded.");
    process.exitCode = 1;
  }
}
