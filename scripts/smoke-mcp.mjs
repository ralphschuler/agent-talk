// Usage: npm run smoke:mcp -- https://<explicit-test-or-main-relay>
// Each run creates independent identities. Only the private temporary directory
// created by this invocation is removed. No real keys, contacts or invites.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const relay = new URL(process.argv[2]).origin;
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = new URL("./smoke-ack-fixture.mjs", import.meta.url).href;
const dir = await mkdtemp(join(tmpdir(), "agent-talk-smoke-"));
const running = new Set();
const question = "Ist die Dev-Vorschau bereit zum Review?";
const reply = "Ja, die Dev-Vorschau ist bereit.";

async function until(label, probe) {
  const end = Date.now() + 20000;
  do {
    const value = await probe();
    if (value) return value;
    await delay(100);
  } while (Date.now() < end);
  throw new Error("Timed out: " + label);
}

async function start(name, options = {}) {
  const state = join(dir, name + ".json");
  const client = new Client({ name: "synthetic-owner-" + name, version: "1" }, { capabilities: { elicitation: { form: {} } } });
  const transport = new StdioClientTransport({
    command: "npm", args: ["--silent", "run", "mcp", "--", "--relay", relay, "--state", state],
    cwd: root, stderr: "pipe", env: options.env ?? {}
  });
  transport.stderr.resume();
  const agent = {
    approve: false, client, transport,
    async call(tool, args = {}) {
      const r = await client.callTool({ name: tool, arguments: args });
      if (r.isError) throw new Error("MCP " + tool + ": " + r.content[0].text);
      return JSON.parse(r.content[0].text);
    },
    async close() { await client.close(); running.delete(agent); }
  };
  running.add(agent);
  client.setRequestHandler(ElicitRequestSchema, async () => agent.approve
    ? { action: "accept", content: { approve: true } }
    : { action: "decline" });
  await client.connect(transport, { timeout: 20000 });
  if (!options.interrupt) {
    await until("signed socket upgrade", async () => (await agent.call("adapter_status")).socket === "connected");
  }
  return agent;
}

async function requestApproval(agent, invite) {
  const args = { invite: JSON.stringify(invite) };
  const preview = await agent.call("contact_preview", args);
  assert.equal(preview.agentId, invite.issuer.agentId);
  assert.match(preview.fingerprint, /^[0-9a-f]{64}$/);
  await assert.rejects(() => agent.call("contact_confirm", args), /Owner approval required/);
  agent.approve = true;
  try { await agent.call("contact_confirm", args); } finally { agent.approve = false; }
}

function instrumentation(id, marker, interrupt) {
  return { NODE_OPTIONS: "--import=" + fixture, SMOKE_MESSAGE_ID: id, SMOKE_ACK_MARKER: join(dir, marker), SMOKE_INTERRUPT: interrupt ? "yes" : "no" };
}

async function marker(name, id) {
  await until("recipient ACK at " + name, async () => {
    try { return (await readFile(join(dir, name), "utf8")) === id; }
    catch (error) { if (error.code !== "ENOENT") throw error; return false; }
  });
}

try {
  const landing = await fetch(relay, { signal: AbortSignal.timeout(15000) });
  assert.equal(landing.status, 200);
  assert.equal(landing.headers.get("content-type")?.split(";")[0], "text/html");
  assert.match(await landing.text(), /Agent Talk/);
  const health = await fetch(relay + "/healthz", { signal: AbortSignal.timeout(15000) });
  assert.equal((await health.json()).ok, true);
  assert.equal((await fetch(relay + "/v1/socket", { signal: AbortSignal.timeout(15000) })).status, 426);
  const a = await start("A");
  let b = await start("B");
  const aInvite = await a.call("profile_export_invite", { displayName: "Pilot A", expiresInMinutes: 10 });
  const bInvite = await b.call("profile_export_invite", { displayName: "Pilot B", expiresInMinutes: 10 });
  await requestApproval(a, bInvite);
  const sendQuestion = () => a.call("message_send", { recipientId: bInvite.issuer.agentId, text: question });
  await assert.rejects(sendQuestion, /403/);
  await requestApproval(b, aInvite);
  await b.close();

  const q = await sendQuestion();
  const beforeAck = start("B", { env: instrumentation(q.id, "before-ack", true), interrupt: true });
  // The crash can happen during the MCP handshake or after it.
  const interrupted = beforeAck.then(agent => agent, () => null);
  await marker("before-ack", q.id);
  const crashed = await interrupted;
  if (crashed) await crashed.close();
  const statePath = join(dir, "B.json");
  assert.equal((await stat(statePath)).mode & 0o077, 0);
  const disk = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(disk.inbox.filter(m => m.id === q.id && m.senderId === aInvite.issuer.agentId && m.text === question).length, 1);
  b = await start("B", { env: instrumentation(q.id, "replayed", false) });
  await marker("replayed", q.id);
  assert.equal((await b.call("inbox_list")).length, 1);
  const answer = await b.call("message_send", { recipientId: aInvite.issuer.agentId, text: reply });
  const live = await until("live reply in A's inbox", async () => {
    const rows = await a.call("inbox_list");
    return rows.length === 1 && rows[0];
  });
  assert.equal(live.id, answer.id);
  assert.equal(live.senderId, bInvite.issuer.agentId);
  assert.equal(live.text, reply);
  b.approve = true;
  await b.call("contact_block", { agentId: aInvite.issuer.agentId });
  await assert.rejects(sendQuestion, /403/);
  assert.equal((await b.call("inbox_list")).length, 1);
  console.log("PASS " + relay + " — static HTML, health, 426; signed WebSocket; real stdio MCP; owner decline and mutual approval; offline encrypted question; durable write, interrupted ACK, observed replay, one inbox row; one manual live reply; block.");
} finally {
  await Promise.allSettled(Array.from(running, agent => agent.close()));
  await rm(dir, { recursive: true, force: true });
}
