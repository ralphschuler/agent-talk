// Real stdio MCP clients talking to an explicitly selected relay with fresh synthetic identities.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const relay = new URL(process.argv[2]).origin;
const [storage, storageMarker] = process.argv.slice(3);
const dir = await mkdtemp(join(tmpdir(), "agent-talk-conversations-"));
const checkout = fileURLToPath(new URL("../", import.meta.url));
const clients = new Set();
const joinKeys = [];

async function until(description, read) {
  const deadline = Date.now() + 30_000;
  do {
    if (await read()) return;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error("Timed out waiting for " + description);
}

function onDisk(file, value) {
  return readFile(file, "utf8").then(
    (s) => s.includes(value),
    (e) => {
      if (e.code === "ENOENT") return false;
      throw e;
    },
  );
}

async function start(name, interruptText) {
  const profile = join(dir, name + ".json");
  const marker = join(dir, name + "-ack");
  const client = new Client(
    { name: "synthetic-" + name, version: "1" },
    { capabilities: { elicitation: { form: {} } } },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", relay, "--state", profile],
    cwd: checkout,
    stderr: "pipe",
    env: {
      NODE_OPTIONS: "--import=" + new URL("./group-ack-fixture.mjs", import.meta.url).href,
      SMOKE_PROFILE_PATH: profile,
      SMOKE_GROUP_MARKER: marker,
      SMOKE_GROUP_MESSAGE: interruptText ?? "",
      SMOKE_GROUP_RACE_DIR: dir,
      SMOKE_GROUP_ACTOR: name,
      ...(storage && name === "A" ? { SMOKE_GROUP_WIRE_RECEIPT: join(dir, "wire-receipt") } : {}),
    },
  });
  transport.stderr.resume();
  let decision = false;
  client.setRequestHandler(ElicitRequestSchema, async ({ params }) => {
    assert.equal(params.requestedSchema.properties.approve.default, false);
    assert.ok(params.requestedSchema.properties.approve.title);
    return decision ? { action: "accept", content: { approve: true } } : { action: "decline" };
  });
  const agent = {
    name,
    profile,
    marker,
    async call(tool, args = {}, owner = false) {
      decision = owner;
      try {
        const result = await client.callTool({ name: tool, arguments: args });
        if (result.isError) throw new Error(tool + " — " + result.content[0].text);
        return JSON.parse(result.content[0].text);
      } finally {
        decision = false;
      }
    },
    async close() {
      await client.close();
      clients.delete(agent);
    },
  };
  clients.add(agent);
  await client.connect(transport);
  if (!interruptText)
    await until(
      "signed WebSocket",
      async () => (await agent.call("adapter_status")).socket === "connected",
    );
  return agent;
}

async function befriend(a, b) {
  const exchange = async (agent) => {
    const profile = await agent.call("profile_export", { displayName: agent.name });
    const invite = await agent.call("profile_export_invite", { displayName: agent.name });
    return { profile: JSON.stringify(profile), invite: JSON.stringify(invite) };
  };
  const [first, second] = await Promise.all([exchange(a), exchange(b)]);
  const preview = await a.call("contact_preview", { invite: second.invite });
  assert.equal(preview.fingerprint, (await b.call("adapter_status")).fingerprint);
  await assert.rejects(
    a.call("management_shortcut", { command: "/contact confirm", arguments: second }),
    /approval/i,
  );
  await a.call("contact_confirm", second, true);
  await b.call("contact_confirm", first, true);
}

async function signedConsent(owner, member, groupId, target, permitId) {
  const invite = await owner.call("group_invite", { groupId, target, permitId }, true);
  const args = { invite: JSON.stringify(invite) };
  await assert.rejects(member.call("group_accept", args), /approval/i);
  return member.call("group_accept", args, true);
}

async function consentToJoin(owner, member, groupId, target) {
  const consent = await signedConsent(owner, member, groupId, target);
  if (storage && member.name === "B" && joinKeys.length === 0) {
    const state = JSON.parse(await readFile(member.profile, "utf8"));
    const prepared = state.groups.accepts[consent.id].prepared;
    joinKeys.push(prepared.initPrivateKey, prepared.hpkePrivateKey);
  }
  await owner.call("group_add", { consent: JSON.stringify(consent) }, true);
  await until("accepted Welcome on the member socket", async () => {
    const rows = await member.call("group_list");
    return rows.some((group) => group.groupId === groupId && group.status === "active");
  });
}

async function competingCommits(a, b, c, bId, cId) {
  const d = await start("D");
  const dId = (await d.call("adapter_status")).agentId;
  await befriend(b, d);
  const { groupId } = await a.call("group_create", { name: "Concurrent admissions" }, true);
  await consentToJoin(a, b, groupId, bId);
  const permit = await a.call(
    "group_grant",
    { groupId, delegate: bId, target: dId, action: "add" },
    true,
  );
  await until("delegated permit at recipient", () => onDisk(b.profile, permit.id));
  const first = await signedConsent(a, c, groupId, cId);
  const second = await signedConsent(b, d, groupId, dId, permit.id);
  await writeFile(join(dir, "race"), groupId);
  const competing = Promise.allSettled([
    a.call("group_add", { consent: JSON.stringify(first) }, true),
    b.call("group_add", { consent: JSON.stringify(second) }, true),
  ]);
  try {
    await until(
      "two independently prepared same-epoch membership Commits",
      async () =>
        (await onDisk(join(dir, "A-ready"), "1")) && (await onDisk(join(dir, "B-ready"), "1")),
    );
  } finally {
    await writeFile(join(dir, "release"), "go");
  }
  const results = await competing;
  assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
  const winner = results[0].status === "fulfilled" ? c : d;
  const loser = winner === c ? d : c;
  const inspect = async (agent) =>
    (await agent.call("group_list")).find((group) => group.groupId === groupId);
  await until("one Welcome and a converged membership", async () =>
    (await Promise.all([a, b, winner].map(inspect))).every(
      (group) => group?.epoch === 2 && group.status === "active",
    ),
  );
  const roster = (await inspect(a)).members;
  for (const member of [b, winner])
    assert.deepEqual([...(await inspect(member)).members].sort(), [...roster].sort());
  assert.notEqual((await inspect(loser))?.status, "active");
  const next = await a.call(
    "group_ask",
    { groupId, text: "Did the winning epoch converge?" },
    true,
  );
  await until("accepted member decrypted the next epoch", () => onDisk(winner.profile, next.id));
  assert.ok(
    (await winner.call("group_read", { groupId })).some(
      (row) => row.id === next.id && row.text === "Did the winning epoch converge?",
    ),
  );
  assert.ok(!(await onDisk(loser.profile, next.id)));
  const admittedId = (await winner.call("adapter_status")).agentId;
  const removal = await a.call(
    "group_grant",
    { groupId, delegate: bId, target: admittedId, action: "remove" },
    true,
  );
  await a.call("group_revoke", { groupId, permitId: removal.id }, true);
  await assert.rejects(
    b.call("group_remove", { groupId, target: admittedId, permitId: removal.id }, true),
  );
  await assert.rejects(
    winner.call("management_shortcut", { command: "/group leave", arguments: { groupId } }),
    /approval/i,
  );
  await winner.call(
    "management_shortcut",
    { command: "/group leave", arguments: { groupId } },
    true,
  );
  await assert.rejects(
    a.call("group_ask", { groupId, text: "Wait until the departure is rekeyed." }, true),
  );
  await a.call("group_remove", { groupId, target: admittedId }, true);
  await a.call("group_close", { groupId }, true);
}

try {
  const a = await start("A");
  let b = await start("B");
  const c = await start("C");
  const [aId, bId, cId] = await Promise.all(
    [a, b, c].map(async (agent) => (await agent.call("adapter_status")).agentId),
  );
  await befriend(a, b);
  await befriend(a, c);
  const question = await a.call(
    "direct_ask",
    { recipientId: bId, text: "Is the preview ready for review?" },
    true,
  );
  await until("durable direct push", () => onDisk(b.profile, question.id));
  const dmReply = await b.call(
    "direct_reply",
    {
      recipientId: aId,
      threadId: question.threadId,
      replyTo: question.id,
      text: "Yes, please review.",
    },
    true,
  );
  await until("direct threaded response", () => onDisk(a.profile, dmReply.id));
  assert.ok(
    JSON.stringify(
      await a.call("direct_thread", { peerId: bId, threadId: question.threadId }),
    ).includes(dmReply.id),
  );
  await assert.rejects(a.call("management_shortcut", { command: "/group run", arguments: {} }));
  const name = "Private review " + randomUUID();
  await assert.rejects(a.call("group_create", { name }), /approval/i);
  const { groupId } = await a.call(
    "management_shortcut",
    { command: "/group create", arguments: { name } },
    true,
  );
  assert.equal(typeof groupId, "string");
  await consentToJoin(a, b, groupId, bId);
  const prior = await a.call(
    "group_ask",
    { groupId, text: "A question for the two founding members." },
    true,
  );
  await until("two-member group push", () => onDisk(b.profile, prior.id));
  await consentToJoin(a, c, groupId, cId);
  assert.ok(!(await c.call("group_read", { groupId })).some((row) => row.id === prior.id));
  await b.close();
  const text = "Can someone review the group preview after reconnect? " + randomUUID();
  const ask = await a.call("group_ask", { groupId, text }, true);
  if (storage) {
    const { checkRelayPersistence } = await import("./check-relay-persistence.mjs");
    await checkRelayPersistence({
      relay,
      storage,
      storageMarker,
      groupId,
      sender: aId,
      recipient: bId,
      id: ask.id,
      sent: JSON.parse(await readFile(join(dir, "wire-receipt"), "utf8")),
      name,
      text,
      joinKeys,
      endpointStates: await Promise.all(
        [a, b].map(async (x) => JSON.parse(await readFile(x.profile, "utf8"))),
      ),
    });
  }
  b = await start("B", text);
  await until("crash between durable inbox and HTTP ACK", () => onDisk(b.marker, "through"));
  await b.close();
  b = await start("B");
  const replayed = (await b.call("group_read", { groupId, threadId: ask.threadId })).filter(
    (row) => row.id === ask.id,
  );
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].text, text);
  assert.equal(replayed[0].senderId, aId);
  const response = await b.call(
    "group_reply",
    { groupId, replyTo: ask.id, text: "I reviewed it." },
    true,
  );
  await until("one manual group reply", () => onDisk(a.profile, response.id));
  const thread = await a.call("group_read", { groupId, threadId: ask.threadId });
  assert.equal(thread.length, 2);
  assert.equal(thread.find((row) => row.id === response.id).senderId, bId);
  await a.call("group_remove", { groupId, target: cId }, true);
  const current = await a.call(
    "group_ask",
    { groupId, text: "Question for the remaining members." },
    true,
  );
  await until("post-removal push", () => onDisk(b.profile, current.id));
  assert.ok(!(await onDisk(c.profile, current.id)));
  await assert.rejects(c.call("group_ask", { groupId, text: "Can I still write?" }, true));
  await a.call("group_close", { groupId }, true);
  await competingCommits(a, b, c, bId, cId);
  await b.call("contact_block", { agentId: aId }, true);
  await assert.rejects(a.call("message_send", { recipientId: bId, text: "Blocked delivery." }));
  console.log(
    "PASS " +
      relay +
      " — signed private profiles, owner decline, mutual contacts, threaded DM, private group history, live push, offline replay after lost ACK, one manual reply, removal and blocking. Two owner-approved same-epoch Commits produced one accepted Welcome, one roster and one readable next epoch.",
  );
} finally {
  await Promise.allSettled([...clients].map((client) => client.close()));
  await rm(dir, { recursive: true, force: true });
}
