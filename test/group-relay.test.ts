import { SELF, env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vite-plus/test";
import * as ed from "@noble/ed25519";
import { createLocalIdentity, signInvite, signRequest, type LocalIdentity } from "../src/crypto.ts";
import { base64url, fromBase64url } from "../src/protocol.ts";
import {
  digestGroupWire,
  groupHttpAction,
  isGroupCapacityRejection,
  groupSigningBytes,
  type GroupConsent,
  type GroupEvent,
  type GroupGrant,
  type GroupOp,
} from "../src/group-protocol.ts";

const relay = "https://agent-talk.test";
const clocks = new Map<string, number>();
async function headers(actor: LocalIdentity, action: string, payload: unknown) {
  const now = Math.max(Date.now(), (clocks.get(actor.agentId) ?? 0) + 1);
  clocks.set(actor.agentId, now);
  return {
    "x-agent-id": actor.agentId,
    "x-agent-timestamp": String(now),
    "x-agent-signature": await signRequest(
      actor,
      action.startsWith("group/") ? groupHttpAction(action, relay) : action,
      String(now),
      payload,
    ),
  };
}
async function post(actor: LocalIdentity, action: string, payload: unknown) {
  const response = await SELF.fetch(relay + "/v1/" + action, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await headers(actor, action, payload)) },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    data: (await response.json()) as {
      seq: number;
      events: GroupEvent[];
      more: boolean;
      ok: boolean;
      error: string;
    },
  };
}
async function agent() {
  const local = await createLocalIdentity();
  const { agentId, signingPublicKey, encryptionPublicKey } = local;
  expect(
    (
      await post(local, "register", {
        identity: { agentId, signingPublicKey, encryptionPublicKey },
      })
    ).status,
  ).toBe(201);
  return local;
}
async function friends(a: LocalIdentity, b: LocalIdentity) {
  for (const [issuer, acceptor] of [
    [a, b],
    [b, a],
  ]) {
    const { agentId, signingPublicKey, encryptionPublicKey } = issuer;
    const invitation = await signInvite(issuer, {
      kind: "agent-talk-invite",
      version: 1,
      issuer: { agentId, signingPublicKey, encryptionPublicKey },
      displayName: "synthetic",
      inviteId: crypto.randomUUID(),
      expiresAt: Date.now() + 60000,
      relay,
      mcp: { transport: "stdio", hint: "local" },
    });
    expect((await post(acceptor, "contact/approve", { invite: invitation })).status).toBe(200);
  }
}
async function signed<const T extends object>(
  actor: LocalIdentity,
  groupId: string,
  epoch: number,
  fields: T,
) {
  const body = { id: crypto.randomUUID(), groupId, actor: actor.agentId, relay, epoch, ...fields };
  return {
    ...body,
    signature: base64url(
      await ed.signAsync(groupSigningBytes(body), fromBase64url(actor.signingSecretKey)),
    ),
  };
}
function submit(actor: LocalIdentity, op: GroupOp, welcome?: string) {
  return post(actor, "group/submit", welcome ? { op, welcome } : { op });
}
function wire() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
async function admission(
  manager: LocalIdentity,
  target: LocalIdentity,
  owner: LocalIdentity,
  group: string,
  epoch: number,
  members: string[],
  permit: GroupGrant | null = null,
) {
  const invite = await signed(manager, group, epoch, {
    kind: "invite",
    owner: owner.agentId,
    target: target.agentId,
    members: members.toSorted(),
    expiresAt: Date.now() + 60000,
    permit,
  });
  const consent: GroupConsent = await signed(target, group, epoch, {
    kind: "consent",
    invite,
    keyPackage: wire(),
  });
  const welcome = wire();
  const op = await signed(manager, group, epoch, {
    kind: "add",
    target: target.agentId,
    consent,
    commit: wire(),
    welcomeHash: await digestGroupWire(welcome),
    permit,
  });
  return { op, welcome };
}
function sync(actor: LocalIdentity, after = 0) {
  return post(actor, "group/sync", { after });
}

it("atomically admits a targeted member, routes its Welcome privately, and retains exact retries after ACK", async () => {
  const [a, b, c] = await Promise.all([agent(), agent(), agent()]);
  const g = crypto.randomUUID();
  const create = await signed(a, g, 0, { kind: "create" });
  expect((await submit(a, create)).status).toBe(403);
  await friends(a, b);
  await friends(a, c);
  expect((await submit(a, create)).status).toBe(200);
  const past = await signed(a, g, 0, { kind: "app", wire: wire() });
  expect((await submit(a, past)).status).toBe(200);
  const candidate = await admission(a, b, a, g, 0, [a.agentId]);
  expect((await submit(a, candidate.op, wire())).status).toBe(400);
  const competing = await admission(a, c, a, g, 0, [a.agentId]);
  const results = await Promise.all([
    submit(a, candidate.op, candidate.welcome),
    submit(a, competing.op, competing.welcome),
  ]);
  expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  const first = results[0].status === 200;
  const winner = first ? candidate : competing,
    joined = first ? b : c,
    other = first ? c : b;
  const received = (await sync(joined)).data.events;
  expect(received.map((e) => e.op.id)).toEqual([winner.op.id]);
  expect(received[0].welcome).toBe(winner.welcome);
  expect((await sync(other)).data.events).toEqual([]);
  const originator = (await sync(a)).data.events;
  expect(originator.map((e) => e.op.id)).toEqual([create.id, past.id, winner.op.id]);
  expect(originator.every((e) => e.welcome === undefined)).toBe(true);
  // Before ACK, an interrupted read of the same cursor yields exactly the same event.
  expect((await sync(joined)).data.events).toEqual(received);
  for (const peer of [a, joined]) {
    expect((await post(peer, "group/ack", { through: received[0].seq })).status).toBe(200);
    expect((await sync(peer, received[0].seq)).data.events).toEqual([]);
  }
  expect((await submit(a, winner.op, winner.welcome)).data.seq).toBe(received[0].seq);
  const conflict = await signed(a, g, 1, { kind: "app", id: past.id, wire: wire() });
  expect((await submit(a, conflict)).status).toBe(409);
  expect((await submit(a, await signed(a, g, 0, { kind: "app", wire: wire() }))).status).toBe(409);
  const stored = await runInDurableObject(env.DIRECTORY.getByName("directory"), (_, state) =>
    state.storage.sql.exec("SELECT payload,welcome FROM g_log WHERE gid=?", g).toArray(),
  );
  expect(stored.every((row) => row.payload === null && row.welcome === null)).toBe(true);
});

it("orders grants, revocation, offline group wakes, a requested departure and rekey; blocking purges pending pair deliveries", async () => {
  const [a, b, c] = await Promise.all([agent(), agent(), agent()]);
  const g = crypto.randomUUID();
  await friends(a, b);
  await friends(b, c);
  expect((await submit(a, await signed(a, g, 0, { kind: "create" }))).status).toBe(200);
  const first = await admission(a, b, a, g, 0, [a.agentId]);
  expect((await submit(a, first.op, first.welcome)).status).toBe(200);
  const roster = [a.agentId, b.agentId];
  const grant = await signed(a, g, 1, {
    kind: "grant",
    action: "add",
    delegate: b.agentId,
    target: c.agentId,
  });
  expect((await submit(a, grant)).status).toBe(200);
  expect(
    (await submit(a, await signed(a, g, 1, { kind: "revoke", permitId: grant.id }))).status,
  ).toBe(200);
  const denied = await admission(b, c, a, g, 1, roster, grant);
  expect((await submit(b, denied.op, denied.welcome)).status).toBe(403);
  const validGrant = await signed(a, g, 1, {
    kind: "grant",
    action: "add",
    delegate: b.agentId,
    target: c.agentId,
  });
  expect((await submit(a, validGrant)).status).toBe(200);
  const add = await admission(b, c, a, g, 1, roster, validGrant);
  expect((await submit(b, add.op, add.welcome)).status).toBe(200);
  const previous = (await sync(c)).data.events[0].seq;
  const response = await SELF.fetch(relay + "/v1/socket", {
    headers: { ...(await headers(c, "socket", {})), upgrade: "websocket" },
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket!;
  ws.accept();
  const wake = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Error("Group notification did not reach connected mailbox")),
      4000,
    );
    ws.addEventListener("message", (event) => {
      if (JSON.parse(String(event.data)).type === "group-wake") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  const app = await signed(b, g, 2, { kind: "app", wire: wire() });
  expect((await submit(b, app)).status).toBe(200);
  await wake;
  ws.close(1000);
  expect((await post(c, "contact/block", { peerId: b.agentId })).status).toBe(200);
  expect((await sync(c, previous)).data.events).toEqual([]);
  expect((await submit(a, await signed(a, g, 2, { kind: "app", wire: wire() }))).status).toBe(403);
  expect((await submit(c, await signed(c, g, 2, { kind: "leave" }))).status).toBe(200);
  expect((await submit(b, await signed(b, g, 2, { kind: "app", wire: wire() }))).status).toBe(409);
  const remove = await signed(a, g, 2, {
    kind: "remove",
    target: c.agentId,
    commit: wire(),
    permit: null,
  });
  expect((await submit(a, remove)).status).toBe(200);
  const fresh = await signed(b, g, 3, { kind: "app", wire: wire() });
  expect((await submit(b, fresh)).status).toBe(200);
  expect((await sync(c, previous)).data.events.map((e) => e.op.kind)).toEqual(["leave", "remove"]);
  expect((await submit(c, await signed(c, g, 3, { kind: "app", wire: wire() }))).status).toBe(403);
  expect((await submit(b, await signed(b, g, 3, { kind: "close" }))).status).toBe(403);
  const close = await signed(a, g, 3, { kind: "close" });
  expect((await submit(a, close)).status).toBe(200);
  expect((await submit(a, await signed(a, g, 3, { kind: "app", wire: wire() }))).status).toBe(403);
  const directory = env.DIRECTORY.getByName("directory");
  await runInDurableObject(directory, (_, state) => {
    state.storage.sql.exec("UPDATE g_groups SET closed=1 WHERE id=?", g);
  });
  expect(await runDurableObjectAlarm(directory)).toBe(true);
  const residue = await runInDurableObject(directory, (_, state) =>
    state.storage.sql.exec("SELECT seq FROM g_log WHERE gid=?", g).toArray(),
  );
  expect(residue).toEqual([]);
}, 15_000);

it("releases the founder's active slot on close without losing its last receipt", async () => {
  const [owner, peer] = await Promise.all([agent(), agent()]);
  await friends(owner, peer);
  const groups = [];
  for (let n = 0; n < 8; n++) {
    const id = crypto.randomUUID();
    expect((await submit(owner, await signed(owner, id, 0, { kind: "create" }))).status).toBe(200);
    groups.push(id);
  }
  const candidate = await signed(owner, crypto.randomUUID(), 0, { kind: "create" });
  const full = await submit(owner, candidate);
  expect(full.status).toBe(429);
  expect(isGroupCapacityRejection(full.data, candidate)).toBe(true);
  expect(isGroupCapacityRejection({ error: "Rate limited" }, candidate)).toBe(false);
  expect(isGroupCapacityRejection(full.data, { ...candidate, id: crypto.randomUUID() })).toBe(
    false,
  );
  const close = await signed(owner, groups[0], 0, { kind: "close" });
  const receipt = await submit(owner, close);
  expect(receipt.status).toBe(200);
  expect((await submit(owner, candidate)).status).toBe(200);
  expect((await submit(owner, close)).data.seq).toBe(receipt.data.seq);
});

it("rolls back a capacity-rejected admission and still accepts a reserved close", async () => {
  const [owner, peer] = await Promise.all([agent(), agent()]);
  await friends(owner, peer);
  const id = crypto.randomUUID();
  await submit(owner, await signed(owner, id, 0, { kind: "create" }));
  const directory = env.DIRECTORY.getByName("directory");
  // Emulate the normal boundary without manufacturing thousands of operations.
  await runInDurableObject(directory, (_, state) => {
    state.storage.sql.exec("UPDATE g_groups SET entries=4079 WHERE id=?", id);
  });
  const add = await admission(owner, peer, owner, id, 0, [owner.agentId]);
  const denied = await submit(owner, add.op, add.welcome);
  expect(denied.status).toBe(429);
  expect(isGroupCapacityRejection(denied.data, add.op)).toBe(true);
  expect((await sync(peer)).data.events).toEqual([]);
  const state = await runInDurableObject(directory, (_, state) => ({
    epoch: state.storage.sql.exec("SELECT epoch FROM g_groups WHERE id=?", id).one().epoch,
    members: state.storage.sql.exec("SELECT agent FROM g_members WHERE gid=?", id).toArray(),
    receipts: state.storage.sql
      .exec("SELECT seq FROM g_log WHERE agent=? AND opid=?", owner.agentId, add.op.id)
      .toArray(),
  }));
  expect(state).toEqual({ epoch: 0, members: [{ agent: owner.agentId }], receipts: [] });
  expect((await submit(owner, await signed(owner, id, 0, { kind: "close" }))).status).toBe(200);
});
