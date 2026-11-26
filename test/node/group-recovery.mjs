// Exercise the real endpoint, MLS implementation and signed frames with a delivery
// service that deterministically loses a submission or its response.
import test from "node:test";
import assert from "node:assert/strict";
import { createLocalIdentity } from "../../src/crypto.ts";
import { GroupRuntime } from "../../adapter/groups.ts";
import { stableJson, base64url, fromBase64url } from "../../src/protocol.ts";
import { groupSigningBytes } from "../../src/group-protocol.ts";
import * as ed from "@noble/ed25519";

const relay = "https://relay.invalid";
const approve = async () => {};

async function fixture() {
  const [a, b] = await Promise.all([createLocalIdentity(), createLocalIdentity()]);
  const feeds = new Map([
    [a.agentId, []],
    [b.agentId, []],
  ]);
  const receipts = new Map();
  const states = new Map();
  const attempts = [];
  let seq = 0;
  let crash;
  function start(identity) {
    let chain = Promise.resolve();
    return new GroupRuntime({
      identity: () => identity,
      relay,
      contact: (id) => [a, b].find((i) => i.agentId === id),
      serialize: (operation) => {
        const next = chain.then(operation);
        chain = next.catch(() => {});
        return next;
      },
      read: () => structuredClone(states.get(identity.agentId)),
      save: async (state) => {
        states.set(identity.agentId, structuredClone(state));
      },
      post: async (path, body) => {
        if (path === "group/sync")
          return {
            events: feeds.get(identity.agentId).filter((e) => e.seq > body.after),
            more: false,
          };
        if (path === "group/ack") return { ok: true };
        assert.equal(path, "group/submit");
        const { op, welcome } = body;
        if (crash === "capacity" + op.kind) {
          crash = undefined;
          throw Object.assign(Error("verified capacity"), {
            status: 429,
            groupCapacityRejected: true,
          });
        }
        if (crash === "generic429" && op.kind === "app") {
          crash = undefined;
          throw Object.assign(Error("unspecified upstream 429"), { status: 429 });
        }
        if (op.kind === "add" && crash === "refused") {
          crash = undefined;
          throw Object.assign(Error("definitive refusal"), { status: 403 });
        }
        if (op.kind === "app") attempts.push(stableJson(op));
        if (crash === "before" && op.kind === "app") {
          crash = undefined;
          throw Error("lost before append");
        }
        const key = op.actor + ":" + op.id;
        if (!receipts.has(key)) {
          ++seq;
          receipts.set(key, seq);
          for (const actor of op.kind === "create" ? [op.actor] : [a.agentId, b.agentId]) {
            feeds
              .get(actor)
              .push({ seq, op, ...(actor === op.target && welcome ? { welcome } : {}) });
          }
        }
        if (crash === "after" && op.kind === "app") {
          crash = undefined;
          throw Error("lost after append");
        }
        return { seq: receipts.get(key) };
      },
    });
  }
  // A fixture member provides signed routing metadata with unreadable MLS data.
  // Only the addressed local feed receives this synthetic validation fixture.
  async function unreadable(recipient, kind, groupId, epoch) {
    const common = { groupId, actor: a.agentId, relay, id: crypto.randomUUID(), kind, epoch };
    const unsigned =
      kind === "app"
        ? { ...common, wire: "AAAA" }
        : { ...common, target: b.agentId, commit: "AAAA", permit: null };
    const signature = base64url(
      await ed.signAsync(groupSigningBytes(unsigned), fromBase64url(a.signingSecretKey)),
    );
    feeds.get(recipient).push({ seq: ++seq, op: { ...unsigned, signature } });
  }
  const A = start(a),
    B = start(b);
  const failNext = (kind) => {
    crash = kind;
  };
  async function establish() {
    const group = (await A.create("Synthetic group", approve)).groupId;
    const invitation = await A.invite(group, b.agentId, 10, undefined, approve);
    const consent = await B.accept(JSON.stringify(invitation), undefined, approve);
    await A.add(JSON.stringify(consent), approve);
    await B.sync();
    return group;
  }
  return { a, b, A, B, states, attempts, start, failNext, unreadable, establish };
}
test("persisted send survives a crash before append or before the receipt, including concurrent sends", async () => {
  const f = await fixture();
  let A = f.A;
  const { B, a, states, attempts, start, failNext, establish } = f;
  const groupId = await establish();
  for (const mode of ["before", "after"]) {
    failNext(mode);
    const text = "Synthetic recovery " + mode;
    const offset = attempts.length;
    await assert.rejects(A.post(groupId, text, undefined, approve), /lost/);
    assert.equal(states.get(a.agentId).groups[groupId].pending.op.kind, "app");
    A = start(a);
    await A.sync();
    await B.sync();
    const sent = attempts.slice(offset);
    assert.equal(sent.length, mode === "before" ? 2 : 1);
    assert.equal(new Set(sent).size, 1);
    for (const peer of [A, B]) {
      const posts = peer.read(groupId).filter((post) => post.text === text);
      assert.equal(posts.length, 1);
      assert.equal(posts[0].senderId, a.agentId);
    }
  }
  const replies = await Promise.all([
    A.post(groupId, "Concurrent one", undefined, approve),
    A.post(groupId, "Concurrent two", undefined, approve),
  ]);
  await B.sync();
  assert.equal(new Set(replies.map((r) => r.messageRef)).size, 2);
  assert.deepEqual(
    B.read(groupId)
      .slice(-2)
      .map((p) => p.text),
    ["Concurrent one", "Concurrent two"],
  );
});
test("fresh admission after rejection, offline Welcome and bounded orphan KeyPackage lifetime", async () => {
  const { A, B, a, b, states, failNext } = await fixture();
  const { groupId } = await A.create("Delivery recovery", approve);
  const invite = await A.invite(groupId, b.agentId, 60, undefined, approve);
  const consent = await B.accept(JSON.stringify(invite), undefined, approve);
  failNext("refused");
  await assert.rejects(A.add(JSON.stringify(consent), approve), /definitive refusal/);
  assert.equal(A.list()[0].epoch, 0);
  assert.equal(A.list()[0].pending, undefined);
  const replacementInvite = await A.invite(groupId, b.agentId, 1, undefined, approve);
  const replacementConsent = await B.accept(JSON.stringify(replacementInvite), undefined, approve);
  assert.notEqual(replacementConsent.keyPackage, consent.keyPackage);
  await A.add(JSON.stringify(replacementConsent), approve);
  // One invitation received its Welcome before expiry, a second group never
  // accepted at the relay. Real, signed invites with separate one-use secrets.
  const unused = (await A.create("Unused invitation", approve)).groupId;
  const unusedInvite = await A.invite(unused, b.agentId, 10, undefined, approve);
  const unusedConsent = await B.accept(JSON.stringify(unusedInvite), undefined, approve);
  const realNow = Date.now;
  try {
    Date.now = () => unusedInvite.expiresAt + 299_990;
    await B.sync();
    assert.ok(
      states.get(b.agentId).accepts[unusedConsent.id],
      "clock-skew window protects the pending key",
    );
    Date.now = () => unusedInvite.expiresAt + 300_010;
    let allowed = false;
    const recovering = new GroupRuntime({
      relay,
      identity: () => b,
      contact: () => a,
      serialize: (cb) => cb(),
      read: () => structuredClone(states.get(b.agentId)),
      save: async (s) => {
        states.set(b.agentId, structuredClone(s));
      },
      post: async (path) => {
        if (!allowed) throw Error("offline");
        return path === "group/ack" ? { ok: true } : { events: [], more: false };
      },
    });
    await assert.rejects(recovering.sync(), /offline/);
    assert.ok(states.get(b.agentId).accepts[unusedConsent.id], "no offline expiry");
    allowed = true;
    await recovering.sync();
    assert.ok(
      !states.get(b.agentId).accepts[unusedConsent.id],
      "drained authenticated feed retires expired orphan",
    );
  } finally {
    Date.now = realNow;
  }
  await B.sync();
  assert.ok(
    !Object.values(states.get(b.agentId).accepts).some(
      (record) => record.consent.groupId === groupId,
    ),
  );
});
test("malformed MLS data is isolated and an owner can recover with fresh membership", async () => {
  const { A, B, a, b, establish, unreadable } = await fixture();
  const groupId = await establish();
  await unreadable(b.agentId, "app", groupId, 1);
  await B.sync();
  assert.equal(B.list()[0].status, "active");
  assert.equal(B.read(groupId).length, 0);
  const second = (await A.create("Unaffected group", approve)).groupId;
  const invitation = await A.invite(second, b.agentId, 10, undefined, approve);
  const accepted = await B.accept(JSON.stringify(invitation), undefined, approve);
  await A.add(JSON.stringify(accepted), approve);
  await B.sync();
  await unreadable(b.agentId, "remove", groupId, 1);
  await B.sync();
  assert.equal(B.list().find((g) => g.groupId === groupId).status, "needs-rejoin");
  await assert.rejects(
    B.post(groupId, "Cannot send from retired keys", undefined, approve),
    /active membership/,
  );
  const next = await A.post(second, "Unrelated group remains usable", undefined, approve);
  await B.sync();
  assert.equal(B.read(second)[0].messageRef, next.messageRef);
  await A.remove(groupId, b.agentId, undefined, approve);
  await B.sync();
  assert.equal(B.list().find((g) => g.groupId === groupId).status, "removed");
  const again = await A.invite(groupId, b.agentId, 10, undefined, approve);
  const a2 = await B.accept(JSON.stringify(again), undefined, approve);
  await A.add(JSON.stringify(a2), approve);
  await B.sync();
  assert.equal(B.list().find((g) => g.groupId === groupId).status, "active");
  await unreadable(a.agentId, "remove", groupId, 3);
  await A.sync();
  assert.equal(A.list().find((g) => g.groupId === groupId).status, "needs-rejoin");
  await A.depart(groupId, true, approve);
  assert.equal(A.list().find((g) => g.groupId === groupId).status, "closed");
});
test("definitive group capacity leaves room to close; ambiguous 429 retains exact pending bytes", async () => {
  const { A, a, failNext, establish, states } = await fixture();
  failNext("capacitycreate");
  await assert.rejects(A.create("Capacity trial", approve), /verified capacity/);
  assert.deepEqual(A.list(), []);
  const second = await establish();
  failNext("generic429");
  await assert.rejects(A.post(second, "Unknown 429", undefined, approve), /upstream/);
  assert.ok(A.list().find((g) => g.groupId === second).pending);
  await A.sync();
  const initial = states.get(a.agentId).groups[second].mls;
  failNext("capacityapp");
  await assert.rejects(
    A.post(second, "Definitively full", undefined, approve),
    /verified capacity/,
  );
  assert.equal(A.list().find((g) => g.groupId === second).pending, undefined);
  assert.notEqual(
    states.get(a.agentId).groups[second].mls,
    initial,
    "the refused encrypted send still burned its local generation",
  );
  await A.depart(second, true, approve);
  assert.equal(A.list().find((g) => g.groupId === second).status, "closed");
});
