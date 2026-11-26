// Usage: node scripts/smoke-upgrade.mjs http://127.0.0.1:<test-relay-port>
// The released adapter writes the v1 state and invitation. Only the recipient is upgraded.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const baseline = "4db86011a5afbfe20528faa366a7e1c11df270b9";
const root = fileURLToPath(new URL("../", import.meta.url));
const url = new URL(process.argv[2]);
if (
  url.protocol !== "http:" ||
  !["127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.href !== url.origin + "/"
) {
  throw new Error("Pass the HTTP origin of the local test relay on a loopback IP.");
}
const relay = url.origin;
const dir = await mkdtemp(join(tmpdir(), "agent-talk-upgrade-"));
const old = join(dir, "release");
const clients = new Set();
const git = promisify(execFile);

async function extractRelease() {
  const files = [
    "package.json",
    "adapter/mcp-adapter.ts",
    "src/auth.ts",
    "src/crypto.ts",
    "src/protocol.ts",
    "src/validation.ts",
  ];
  for (const file of files) {
    const { stdout } = await git("git", ["show", baseline + ":" + file], {
      cwd: root,
      encoding: "buffer",
    });
    await mkdir(dirname(join(old, file)), { recursive: true, mode: 0o700 });
    await writeFile(join(old, file), stdout, { mode: 0o600 });
  }
  await symlink(join(root, "node_modules"), join(old, "node_modules"), "dir");
}

async function until(label, probe) {
  const deadline = Date.now() + 20_000;
  do {
    if (await probe()) return;
    await delay(60);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for " + label);
}

function profile(name) {
  return join(dir, name + ".json");
}
async function snapshot(name) {
  return JSON.parse(await readFile(profile(name), "utf8"));
}

async function start(checkout, name, replay) {
  const env = { TSX_DISABLE_CACHE: "1" };
  if (replay)
    Object.assign(env, {
      NODE_OPTIONS: "--import=" + new URL("./smoke-ack-fixture.mjs", import.meta.url).href,
      SMOKE_MESSAGE_ID: replay.id,
      SMOKE_ACK_MARKER: join(dir, replay.marker),
      SMOKE_INTERRUPT: replay.interrupt ? "yes" : "no",
    });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", relay, "--state", profile(name)],
    cwd: checkout,
    env,
    stderr: "ignore",
  });
  const client = new Client(
    { name: "synthetic-upgrade-" + name, version: "1" },
    { capabilities: { elicitation: { form: {} } } },
  );
  let expectedOwnerPrompt;
  client.setRequestHandler(ElicitRequestSchema, ({ params }) => {
    const approve = params.requestedSchema?.properties?.approve;
    if (
      !expectedOwnerPrompt ||
      params.message !== expectedOwnerPrompt ||
      approve?.title !== params.message ||
      approve.default !== false
    ) {
      return { action: "decline" };
    }
    expectedOwnerPrompt = undefined;
    return { action: "accept", content: { approve: true } };
  });
  const agent = {
    async raw(tool, args = {}) {
      const reply = await client.callTool({ name: tool, arguments: args });
      if (reply.isError) throw new Error(tool + " failed: " + reply.content[0].text);
      return reply.content[0].text;
    },
    async call(tool, args = {}) {
      return JSON.parse(await this.raw(tool, args));
    },
    async approve(invite, issuer) {
      const preview = await this.call("contact_preview", { invite });
      assert.equal(preview.agentId, issuer.agentId);
      assert.equal(preview.fingerprint, issuer.fingerprint);
      assert.equal(preview.relay, relay);
      expectedOwnerPrompt = `Confirm contact ${issuer.agentId} at ${relay}? Compare this fingerprint privately: ${issuer.fingerprint}`;
      try {
        await this.call("contact_confirm", { invite });
        assert.equal(
          expectedOwnerPrompt,
          undefined,
          "contact_confirm must elicit the expected owner decision",
        );
      } finally {
        expectedOwnerPrompt = undefined;
      }
    },
    async close() {
      await client.close();
      clients.delete(this);
    },
  };
  clients.add(agent);
  try {
    await client.connect(transport, { timeout: 20_000 });
    if (!replay?.interrupt)
      await until(
        "adapter WebSocket",
        async () => (await agent.call("adapter_status")).socket === "connected",
      );
    return agent;
  } catch (error) {
    await agent.close();
    throw error;
  }
}

async function sawAck(marker, id) {
  await until(marker, async () => {
    try {
      return (await readFile(join(dir, marker), "utf8")) === id;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  });
}

async function received(agent, id, senderId, text) {
  await until("sender-scoped inbox entry " + id, async () => {
    const rows = (await agent.call("inbox_list")).filter(
      (row) => row.id === id && row.senderId === senderId,
    );
    if (!rows.length) return false;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].text, text);
    return true;
  });
}

try {
  await extractRelease();
  const a = await start(old, "A");
  const b = await start(old, "B");
  const c = await start(old, "C");
  const aStatus = await a.call("adapter_status");
  const bStatus = await b.call("adapter_status");
  const cStatus = await c.call("adapter_status");
  const invite = (agent) =>
    agent.raw("profile_export_invite", {
      displayName: "Synthetic upgrade test",
      expiresInMinutes: 10,
    });
  // Keep C's original serialized MCP text untouched until after B's upgrade.
  const unusedOldInvite = await invite(c);
  await b.approve(await invite(a), aStatus);
  await a.approve(await invite(b), bStatus);
  await b.close();

  const question = "Is the old inbox still readable after the upgrade?";
  const queued = await a.call("message_send", { recipientId: bStatus.agentId, text: question });
  const crash = { id: queued.id, marker: "old-before-ack", interrupt: true };
  // The released process can exit during the stdio handshake or immediately after it.
  const stopped = start(old, "B", crash).then(
    (agent) => agent,
    () => undefined,
  );
  await sawAck(crash.marker, queued.id);
  await (await stopped)?.close();
  const before = await snapshot("B");
  const seen = `${aStatus.agentId}:${queued.id}`;
  assert.equal(before.version, 1);
  assert.equal(before.seen[seen], true);
  assert.equal(before.inbox.length, 1);
  assert.equal(before.inbox[0].text, question);
  assert.ok(
    before.identity.signingSecretKey && before.identity.encryptionSecretKey,
    "expected synthetic v1 private keys",
  );

  const upgraded = await start(root, "B", { id: queued.id, marker: "upgraded-replay" });
  await sawAck("upgraded-replay", queued.id);
  await received(upgraded, queued.id, aStatus.agentId, question);
  const migrated = await snapshot("B");
  assert.equal(migrated.version, 2);
  // Compare secrets as booleans so assertion failures can never print key material.
  for (const key of [
    "agentId",
    "signingPublicKey",
    "signingSecretKey",
    "encryptionPublicKey",
    "encryptionSecretKey",
  ]) {
    assert.ok(migrated.identity[key] === before.identity[key], "v1 identity field changed: " + key);
  }
  assert.deepEqual(migrated.seen, before.seen);
  assert.deepEqual(migrated.inbox, before.inbox);
  assert.deepEqual(migrated.consumedInviteIds, before.consumedInviteIds);
  const migratedStatus = await upgraded.call("adapter_status");
  assert.equal(migratedStatus.agentId, bStatus.agentId);
  assert.equal(migratedStatus.fingerprint, bStatus.fingerprint);
  assert.equal(migratedStatus.contacts, 1);

  await upgraded.approve(unusedOldInvite, cStatus);
  assert.equal((await upgraded.call("adapter_status")).contacts, 2);
  const looksLikeCommand = `/contact block ${aStatus.agentId}`;
  const commandText = await a.call("message_send", {
    recipientId: bStatus.agentId,
    text: looksLikeCommand,
  });
  await received(upgraded, commandText.id, aStatus.agentId, looksLikeCommand);
  assert.equal((await upgraded.call("adapter_status")).contacts, 2);
  const answer = "The upgraded adapter can reply using our original contact keys.";
  const delivered = await upgraded.call("message_send", {
    recipientId: aStatus.agentId,
    text: answer,
  });
  await received(a, delivered.id, bStatus.agentId, answer);
  assert.equal((await a.call("inbox_list")).length, 1);
  assert.equal((await upgraded.call("inbox_list")).length, 2);
  console.log(
    `PASS adapter upgrade from ${baseline}: old signed invite, v1 keys, inbox, sender-scoped replay after interrupted ACK, inert command text and bidirectional stdio messaging.`,
  );
} finally {
  await Promise.allSettled([...clients].map((agent) => agent.close()));
  await rm(dir, { recursive: true, force: true });
}
