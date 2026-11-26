// Real MCP stdio sessions, isolated identities and an explicitly selected relay.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { signInvite } from "../src/crypto.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const relay = new URL(process.argv[2]).origin;
const dir = await mkdtemp(join(tmpdir(), "agent-talk-social-"));
const running = new Set();
const path = (name) => join(dir, name + ".json");
const read = async (name) => JSON.parse(await readFile(path(name), "utf8"));

async function until(readValue) {
  const end = Date.now() + 20000;
  do {
    const value = await readValue();
    if (value) return value;
    await delay(70);
  } while (Date.now() < end);
  throw new Error("Timed out waiting for synthetic delivery");
}

async function start(name) {
  const client = new Client(
    { name: "social-test-" + name, version: "1" },
    { capabilities: { elicitation: { form: {} } } },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", relay, "--state", path(name)],
    cwd: root,
    stderr: "ignore",
  });
  let decide = false;
  let prompt = "";
  client.setRequestHandler(ElicitRequestSchema, async ({ params }) => {
    assert.equal(params.requestedSchema.properties.approve.default, false);
    prompt = params.requestedSchema.properties.approve.title;
    return decide ? { action: "accept", content: { approve: true } } : { action: "decline" };
  });
  const app = {
    name,
    get prompt() {
      return prompt;
    },
    async call(tool, args = {}, approve = false) {
      decide = approve;
      try {
        const r = await client.callTool({ name: tool, arguments: args });
        if (r.isError) throw Error(r.content[0].text);
        return JSON.parse(r.content[0].text);
      } finally {
        decide = false;
      }
    },
    async close() {
      await client.close();
      running.delete(app);
    },
  };
  running.add(app);
  await client.connect(transport);
  await until(async () => (await app.call("adapter_status")).socket === "connected");
  return app;
}

async function exported(app) {
  const profile = await app.call("profile_export", {
    displayName: app.name,
    capabilities: ["code.review"],
  });
  const invite = await app.call("profile_export_invite", { displayName: app.name });
  return { invite: JSON.stringify(invite), profile: JSON.stringify(profile) };
}

try {
  let a = await start("A");
  const b = await start("B"),
    c = await start("C");
  const [A, B, C] = await Promise.all([a, b, c].map((app) => app.call("adapter_status")));
  await a.close();
  const state = await read("A");
  const history = {
    id: "old-message",
    senderId: B.agentId,
    text: "Legacy local history",
    receivedAt: Date.now(),
  };
  const legacy = {
    version: 1,
    relay,
    identity: state.identity,
    contacts: {},
    consumedInviteIds: { legacy: true },
    seen: { [B.agentId + ":" + history.id]: true },
    inbox: [history],
  };
  await writeFile(path("A"), JSON.stringify(legacy));
  a = await start("A");
  assert.deepEqual(await a.call("inbox_list"), [history]);
  assert.equal((await a.call("adapter_status")).agentId, A.agentId);
  assert.equal((await read("A")).consumedInviteIds.legacy, true);
  const [ai, bi, ci] = await Promise.all([a, b, c].map(exported));
  const profile = await a.call("profile_inspect", { profile: bi.profile });
  assert.equal(profile.fingerprint, B.fingerprint);
  assert.deepEqual(profile.capabilities, ["code.review"]);
  assert.deepEqual(await a.call("friends_list"), []);
  await assert.rejects(
    a.call("profile_inspect", {
      profile: JSON.stringify({ ...profile, capabilities: ["different"] }),
    }),
    /signature/i,
  );
  await assert.rejects(
    a.call("contact_confirm", { invite: bi.invite, profile: ci.profile }, true),
    /same relay and keys/,
  );
  await a.call("contact_confirm", bi, true);
  const sendText = "Is the preview ready?";
  await assert.rejects(a.call("direct_ask", { recipientId: B.agentId, text: sendText }), /403/);
  const [pending] = await a.call("direct_pending");
  assert.equal(pending.recipientId, B.agentId);
  await a.close();
  await b.call("contact_confirm", ai, true);
  a = await start("A");
  const submitted = await a.call("direct_retry", { id: pending.id });
  assert.equal(submitted.id, pending.id);
  assert.deepEqual(await a.call("direct_pending"), []);
  const q = await until(async () =>
    (await b.call("inbox_list")).find((m) => m.id === submitted.id),
  );
  assert.equal(q.type, "ask");
  assert.equal(q.text, sendText);
  assert.equal(q.threadId, submitted.threadId);
  const replyArgs = { recipientId: A.agentId, threadId: q.threadId, replyTo: q.id, text: "Ready." };
  await assert.rejects(b.call("direct_reply", { ...replyArgs, threadId: "unrelated" }), /thread/i);
  const reply = await b.call("direct_reply", replyArgs);
  await until(async () => (await a.call("inbox_list")).some((m) => m.id === reply.id));
  assert.equal(
    (await a.call("direct_thread", { peerId: C.agentId, threadId: q.threadId })).messages.length,
    0,
  );
  const thread = await a.call("direct_thread", { peerId: B.agentId, threadId: q.threadId });
  assert.equal(thread.messages.length, 2);
  assert.deepEqual(new Set(thread.messages.map((m) => m.id)), new Set([q.id, reply.id]));

  // A valid invitation signed with only one changed key cannot replace B's immutable identity.
  for (const [signer, enc] of [
    ["B", JSON.parse(ci.invite).issuer.encryptionPublicKey],
    ["C", JSON.parse(bi.invite).issuer.encryptionPublicKey],
  ]) {
    const { signature, ...unsigned } = JSON.parse(signer === "B" ? bi.invite : ci.invite);
    unsigned.inviteId = crypto.randomUUID();
    unsigned.issuer.encryptionPublicKey = enc;
    const partial = await signInvite((await read(signer)).identity, unsigned);
    await assert.rejects(
      a.call(
        "contact_reverify",
        { previousAgentId: B.agentId, invite: JSON.stringify(partial) },
        true,
      ),
      /fresh encryption key|key differs from the existing pin/i,
    );
  }
  const replace = { previousAgentId: B.agentId, ...ci };
  await assert.rejects(a.call("contact_reverify", replace), /Owner approval required/);
  for (const value of [B.agentId, B.fingerprint, C.agentId, C.fingerprint, relay])
    assert.ok(a.prompt.includes(value));
  assert.deepEqual(
    (await a.call("friends_list")).map((p) => p.agentId),
    [B.agentId],
  );
  // C has not approved A yet. Retire B durably but keep C unauthorized.
  await assert.rejects(a.call("contact_reverify", replace, true), /403/);
  assert.deepEqual(await a.call("friends_list"), []);
  await assert.rejects(
    b.call("message_send", { recipientId: A.agentId, text: "Former route" }),
    /403/,
  );
  assert.equal(
    Object.keys((await read("A")).consumedInviteIds).some((k) =>
      k.endsWith(JSON.parse(ci.invite).inviteId),
    ),
    false,
  );
  await a.close();
  a = await start("A");
  await assert.rejects(a.call("contact_confirm", ci, true), /pending replacement/);
  await c.call("contact_confirm", await exported(a), true);
  const complete = await a.call("contact_reverify", replace, true);
  assert.equal(complete.status, "replaced");
  assert.deepEqual(
    (await a.call("friends_list")).map((p) => p.agentId),
    [C.agentId],
  );
  assert.equal(
    (await a.call("direct_thread", { peerId: B.agentId, threadId: q.threadId })).messages.length,
    2,
  );
  assert.equal(
    (await a.call("direct_thread", { peerId: C.agentId, threadId: q.threadId })).messages.length,
    0,
  );
  assert.equal((await a.call("inbox_list"))[0].senderId, B.agentId);
  const after = await a.call("message_send", { recipientId: C.agentId, text: "New private route" });
  await until(async () => (await c.call("inbox_list")).some((m) => m.id === after.id));
  console.log(
    "PASS " +
      relay +
      " — legacy state migration, signed reusable profile, explicit retry of staged DM across restart, scoped replies, partial-key rejection, old route retirement before reciprocal replacement, persistent original thread identity.",
  );
} finally {
  await Promise.allSettled([...running].map((app) => app.close()));
  await rm(dir, { recursive: true, force: true });
}
