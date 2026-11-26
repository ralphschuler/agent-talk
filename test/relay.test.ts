import { SELF, env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { expect, it } from "vite-plus/test";
import { createLocalIdentity, sealEnvelope, signInvite, signRequest } from "../src/crypto.ts";
import type { LocalIdentity } from "../src/crypto.ts";
import type { Invite } from "../src/protocol.ts";
import { DAY } from "../src/validation.ts";

async function signedPost(path: string, identity: LocalIdentity, action: string, payload: unknown): Promise<Response> {
  const timestamp = String(Date.now());
  return SELF.fetch(`https://agent-talk.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agent-id": identity.agentId,
      "x-agent-timestamp": timestamp,
      "x-agent-signature": await signRequest(identity, action, timestamp, payload),
    },
    body: JSON.stringify(payload),
  });
}

function registration(identity: LocalIdentity): Promise<Response> {
  return signedPost("/v1/register", identity, "register", { identity: {
    agentId: identity.agentId, signingPublicKey: identity.signingPublicKey, encryptionPublicKey: identity.encryptionPublicKey,
  } });
}

async function register(identity: LocalIdentity): Promise<void> {
  const response = await registration(identity);
  expect(response.status).toBeGreaterThanOrEqual(200);
  expect(response.status).toBeLessThan(300);
}

async function invite(identity: LocalIdentity, suffix: string): Promise<Invite> {
  return signInvite(identity, {
    kind: "agent-talk-invite", version: 1,
    issuer: { agentId: identity.agentId, signingPublicKey: identity.signingPublicKey, encryptionPublicKey: identity.encryptionPublicKey },
    displayName: `agent-${suffix}`, inviteId: `invite-${suffix}`, expiresAt: Date.now() + 60_000,
    relay: "https://agent-talk.test", mcp: { transport: "stdio", hint: "local adapter only" },
  });
}

async function socketFor(identity: LocalIdentity): Promise<WebSocket> {
  const timestamp = String(Date.now());
  const response = await SELF.fetch("https://agent-talk.test/v1/socket", {
    headers: {
      Upgrade: "websocket",
      "x-agent-id": identity.agentId,
      "x-agent-timestamp": timestamp,
      "x-agent-signature": await signRequest(identity, "socket", timestamp, {}),
    },
  });
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error("expected a WebSocket upgrade");
  socket.accept();
  return socket;
}

async function nextMessage(socket: WebSocket): Promise<{ envelope: { id: string; ciphertext: string } }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for relay push")), 1_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(event.data)) as { envelope: { id: string; ciphertext: string } });
    }, { once: true });
  });
}

async function mutuallyApprove(alice: LocalIdentity, bob: LocalIdentity, label: string): Promise<void> {
  const aliceInvite = await invite(alice, `${label}-alice`);
  const bobInvite = await invite(bob, `${label}-bob`);
  expect((await signedPost("/v1/contact/approve", bob, "contact/approve", { invite: aliceInvite })).status).toBe(200);
  expect((await signedPost("/v1/contact/approve", alice, "contact/approve", { invite: bobInvite })).status).toBe(200);
}

it("uses the Worker entrypoint to reject unconfirmed, then blocked, senders", async () => {
  const alice = await createLocalIdentity();
  const bob = await createLocalIdentity();
  const charlie = await createLocalIdentity();
  await Promise.all([register(alice), register(bob), register(charlie)]);

  const deniedEnvelope = await sealEnvelope(charlie, alice, "unconfirmed-1", "ciphertext only");
  const denied = await signedPost("/v1/send", charlie, "send", { envelope: deniedEnvelope });
  expect(denied.status).toBe(403);

  await mutuallyApprove(alice, bob, "block");

  const envelope = await sealEnvelope(alice, bob, "live-1", "Is the development preview ready for review?");
  expect((await signedPost("/v1/send", alice, "send", { envelope })).status).toBe(201);
  const mailbox = env.MAILBOX.getByName(bob.agentId);
  const stored = await runInDurableObject(mailbox, (_, state) => state.storage.sql.exec("SELECT * FROM queue").toArray());
  expect(stored).toHaveLength(1);
  expect(JSON.parse(String(stored[0].envelope))).toEqual(envelope);
  const dir = env.DIRECTORY.getByName("directory");
  const registry = await runInDurableObject(dir, (_, state) => ["identities", "approvals", "blocks", "consumed_invites", "admissions"].map(table =>
    state.storage.sql.exec("SELECT * FROM " + table).toArray()));
  const dump = JSON.stringify([stored, registry]);
  for (const value of [alice.signingSecretKey, bob.signingSecretKey, alice.encryptionSecretKey, bob.encryptionSecretKey, "Is the development preview ready for review?"]) {
    expect(dump.includes(value)).toBe(false);
  }

  expect((await signedPost("/v1/contact/block", bob, "contact/block", { peerId: alice.agentId })).status).toBe(200);
  expect(await runInDurableObject(mailbox, (_, state) => state.storage.sql.exec("SELECT COUNT(*) AS n FROM queue").one().n)).toBe(0);
  const afterBlock = await sealEnvelope(alice, bob, "blocked-1", "still opaque");
  expect((await signedPost("/v1/send", alice, "send", { envelope: afterBlock })).status).toBe(403);
});

it("consumes an expiring invite for exactly one recipient and requires reciprocal consent", async () => {
  const [alice, bob, charlie] = await Promise.all(Array.from({ length: 3 }, () => createLocalIdentity()));
  await Promise.all([register(alice), register(bob), register(charlie)]);
  const ticket = await invite(alice, "once");
  const accept = (identity: LocalIdentity, invitation: Invite) =>
    signedPost("/v1/contact/approve", identity, "contact/approve", { invite: invitation });
  expect((await accept(bob, ticket)).status).toBe(200);
  expect((await accept(charlie, ticket)).status).toBe(409);
  const outgoing = await sealEnvelope(bob, alice, "one-way", "Waiting for owner approval");
  expect((await signedPost("/v1/send", bob, "send", { envelope: outgoing })).status).toBe(403);
  const { signature, ...unsigned } = ticket;
  expect((await accept(charlie, await signInvite(alice, { ...unsigned, inviteId: "expired", expiresAt: Date.now() - 60_000 }))).status).toBe(400);
});

it("reclaims only long-idle unrelated registrations and restores an issuer from a valid private invite", async () => {
  const [owner, peer, active, orphan, entrant, overflow] = await Promise.all(Array.from({ length: 6 }, () => createLocalIdentity()));
  await Promise.all([owner, peer, active, orphan].map(register));
  // Even a one-sided approval protects both existing key pins.
  const peerInvite = await invite(peer, "directory-capacity");
  expect((await signedPost("/v1/contact/approve", owner, "contact/approve", { invite: peerInvite })).status).toBe(200);
  const orphanInvite = await invite(orphan, "returning-issuer");
  const directory = env.DIRECTORY.getByName("directory");
  try {
    await runInDurableObject(directory, (_, state) => state.storage.transactionSync(() => {
      const sql = state.storage.sql;
      sql.exec("UPDATE identities SET last_active=0 WHERE agent_id IN (?,?,?,?)", owner.agentId, peer.agentId, active.agentId, orphan.agentId);
      const count = Number(sql.exec("SELECT COUNT(*) AS n FROM identities").one().n);
      for (let i = 0; i < 512 - count; i++) {
        const id = "directory-fixture-" + i;
        sql.exec("INSERT INTO identities VALUES (?, ?, ?, ?, ?)", id, "fixture", "fixture", Date.now(), i < 2 ? 0 : Date.now());
      }
      // Historic blocks must independently protect identities even without an approval row.
      sql.exec("INSERT INTO blocks VALUES ('directory-fixture-0', 'directory-fixture-1', ?)", Date.now());
    }));
    (await socketFor(active)).close(1000, "active identity");
    await register(entrant);
    const registered = await runInDurableObject(directory, (_, state) =>
      state.storage.sql.exec("SELECT agent_id, encryption_key FROM identities").toArray());
    const pins = new Map(registered.map(row => [row.agent_id, row.encryption_key]));
    expect(pins.has(orphan.agentId)).toBe(false);
    for (const identity of [owner, peer, active, entrant]) expect(pins.get(identity.agentId)).toBe(identity.encryptionPublicKey);
    for (const id of ["directory-fixture-0", "directory-fixture-1"]) expect(pins.has(id)).toBe(true);
    expect((await registration(overflow)).status).toBe(429);
    const accept = () => signedPost("/v1/contact/approve", owner, "contact/approve", { invite: orphanInvite });
    expect((await accept()).status).toBe(429);
    await runInDurableObject(directory, (_, state) => { state.storage.sql.exec("DELETE FROM identities WHERE agent_id='directory-fixture-2'"); });
    expect((await accept()).status).toBe(200);
    const restored = await runInDurableObject(directory, (_, state) =>
      state.storage.sql.exec("SELECT signing_key, encryption_key FROM identities WHERE agent_id=?", orphan.agentId).one());
    expect(restored).toEqual({ signing_key: orphan.signingPublicKey, encryption_key: orphan.encryptionPublicKey });
  } finally {
    await runInDurableObject(directory, (_, state) => {
      state.storage.sql.exec("DELETE FROM blocks WHERE owner_id='directory-fixture-0'");
      state.storage.sql.exec("DELETE FROM identities WHERE agent_id LIKE 'directory-fixture-%'");
    });
  }
});

it("enforces bounded offline retention and independent sender IDs in the same mailbox", async () => {
  const [alice, bob, charlie] = await Promise.all(Array.from({ length: 3 }, () => createLocalIdentity()));
  await Promise.all([register(alice), register(bob), register(charlie)]);
  await mutuallyApprove(alice, bob, "capacity-a");
  await mutuallyApprove(charlie, bob, "capacity-c");
  const twinnedId = "same-message-id";
  for (const sender of [alice, charlie]) {
    const envelope = await sealEnvelope(sender, bob, twinnedId, "synthetic");
    expect((await signedPost("/v1/send", sender, "send", { envelope })).status).toBe(201);
  }
  const box = env.MAILBOX.getByName(bob.agentId);
  // A sender's 48 occupied slots leave 16 slots available to other confirmed contacts.
  await runInDurableObject(box, (_, state) => {
    for (let i = 0; i < 47; i++) state.storage.sql.exec("INSERT INTO queue VALUES (?, ?, ?, ?)", alice.agentId, "sender-fixture-" + i, "{}", Date.now());
  });
  const waiting = await sealEnvelope(alice, bob, "individual-limit", "synthetic");
  const senderFull = await signedPost("/v1/send", alice, "send", { envelope: waiting });
  expect(senderFull.status).toBe(429);
  expect(await senderFull.json()).toEqual({ error: "sender limit for this mailbox reached" });
  const other = await sealEnvelope(charlie, bob, "other-room", "synthetic");
  expect((await signedPost("/v1/send", charlie, "send", { envelope: other })).status).toBe(201);
  await runInDurableObject(box, (_, state) => {
    state.storage.sql.exec("DELETE FROM queue WHERE id LIKE 'sender-fixture-%' OR id='other-room'");
  });
  // Seed the remaining occupancy in DO storage; assert admission through the public entry point.
  await runInDurableObject(box, (_, state) => {
    const sql = state.storage.sql;
    for (let i = 0; i < 62; i++) sql.exec("INSERT INTO queue VALUES (?, ?, ?, ?)", "fixture", "fixture-" + i, "{}", Date.now());
  });
  const last = await sealEnvelope(alice, bob, "last", "synthetic");
  const mailboxFull = await signedPost("/v1/send", alice, "send", { envelope: last });
  expect(mailboxFull.status).toBe(429);
  expect(await mailboxFull.json()).toEqual({ error: "mailbox full" });
  await runInDurableObject(box, (_, state) => {
    state.storage.sql.exec("UPDATE queue SET received=0 WHERE sender='fixture'");
  });
  expect(await runDurableObjectAlarm(box)).toBe(true);
  expect(await runInDurableObject(box, (_, state) => state.storage.sql.exec("SELECT COUNT(*) AS n FROM queue").one().n)).toBe(2);
  expect((await signedPost("/v1/send", alice, "send", { envelope: last })).status).toBe(201);
});

async function legacyPhase<T>(name: string, operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out during " + name)), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

it("replays authorized legacy mail only within its original retention window", async () => {
  const [alice, bob, carol] = await Promise.all(Array.from({ length: 3 }, () => createLocalIdentity()));
  await Promise.all([alice, bob, carol].map(register));
  await mutuallyApprove(alice, bob, "legacy-block");
  await mutuallyApprove(carol, bob, "legacy-mail");
  const block = await signedPost("/v1/contact/block", alice, "contact/block", { peerId: bob.agentId });
  expect(block.status).toBe(200);
  expect(await block.json()).toEqual({ ok: true });
  const now = Date.now();
  const [blocked, valid, expired, interim, oldInterim, future] = await Promise.all([
    sealEnvelope(alice, bob, "blocked", "synthetic", now - DAY),
    sealEnvelope(carol, bob, "valid", "synthetic", now - 2 * DAY),
    sealEnvelope(carol, bob, "expired", "synthetic", now - 8 * DAY),
    sealEnvelope(carol, bob, "interim", "synthetic", now - 3 * DAY),
    sealEnvelope(carol, bob, "old-interim", "synthetic", now - 9 * DAY),
    sealEnvelope(carol, bob, "future", "synthetic", now + 2 * DAY),
  ]);
  const box = env.MAILBOX.getByName(bob.agentId);
  await runInDurableObject(box, (_, state) => state.storage.transactionSync(() => {
    const sql = state.storage.sql;
    sql.exec("DELETE FROM mailbox_migrations");
    // Original blocking purged the blocker's own mailbox only. Bob has no local bar for Alice.
    sql.exec("DELETE FROM barred WHERE sender=?", alice.agentId);
    sql.exec("CREATE TABLE messages (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, envelope TEXT NOT NULL, created_at INTEGER NOT NULL)");
    for (const envelope of [blocked, valid, expired, future]) {
      sql.exec("INSERT INTO messages VALUES (?,?,?,?)", envelope.id, envelope.senderId, JSON.stringify(envelope), envelope.createdAt);
    }
    for (const envelope of [interim, oldInterim]) {
      // The first migrator used the upgrade time as the receipt time for these rows.
      sql.exec("INSERT INTO queue VALUES (?,?,?,?)", envelope.senderId, envelope.id, JSON.stringify(envelope), now);
    }
  }));
  // Request draining is part of real workerd eviction. Distinguish it from a constructor or replay stall.
  await legacyPhase("graceful mailbox eviction", evictDurableObject(box), 25_000);
  const socket = await legacyPhase("mailbox rehydration and signed socket upgrade", socketFor(bob), 12_000);
  const replay = nextMessage(socket);
  socket.send(JSON.stringify({ type: "resume" }));
  expect((await replay).envelope.id).toBe(interim.id);
  socket.close(1000);
  const remaining = await runInDurableObject(box, (_, state) => ({
    rows: state.storage.sql.exec("SELECT id, received FROM queue ORDER BY received").toArray(),
    originalTable: state.storage.sql.exec("SELECT 1 FROM sqlite_master WHERE name='messages'").toArray(),
    migrated: state.storage.sql.exec("SELECT version FROM mailbox_migrations").one().version,
  }));
  expect(remaining).toEqual({
    rows: [{ id: interim.id, received: interim.createdAt }, { id: valid.id, received: valid.createdAt }],
    originalTable: [], migrated: 1,
  });
}, 45_000);

it("pushes live and safely replays after local persistence but before ACK", async () => {
  const alice = await createLocalIdentity();
  const bob = await createLocalIdentity();
  await Promise.all([register(alice), register(bob)]);
  await mutuallyApprove(alice, bob, "replay");

  // A connected mailbox gets a live push through the real Worker /v1/socket route.
  const liveSocket = await socketFor(bob);
  const livePush = nextMessage(liveSocket);
  const liveEnvelope = await sealEnvelope(alice, bob, "live-socket-1", "Is the development preview ready for review?");
  expect((await signedPost("/v1/send", alice, "send", { envelope: liveEnvelope })).status).toBe(201);
  const live = await livePush;
  expect(live.envelope.id).toBe(liveEnvelope.id);
  expect(live.envelope.ciphertext).not.toContain("development preview");
  liveSocket.send(JSON.stringify({ type: "ack", senderId: alice.agentId, id: liveEnvelope.id }));
  liveSocket.close(1000, "done");

  // Simulate the critical crash window: durable local display happens, then no ACK is sent.
  const offlineEnvelope = await sealEnvelope(alice, bob, "replay-after-crash-1", "Ja — manuelles Review kann starten.");
  expect((await signedPost("/v1/send", alice, "send", { envelope: offlineEnvelope })).status).toBe(201);
  const seen = new Set<string>();
  let visibleInboxEntries = 0;
  const firstSocket = await socketFor(bob);
  const firstReplay = nextMessage(firstSocket);
  firstSocket.send(JSON.stringify({ type: "resume" }));
  const first = await firstReplay;
  seen.add(`${alice.agentId}:${first.envelope.id}`); // durable local write
  visibleInboxEntries += 1;
  firstSocket.close(1000, "crash before ack");

  const secondSocket = await socketFor(bob);
  const secondReplay = nextMessage(secondSocket);
  secondSocket.send(JSON.stringify({ type: "resume" }));
  const replayed = await secondReplay;
  if (!seen.has(`${alice.agentId}:${replayed.envelope.id}`)) visibleInboxEntries += 1;
  secondSocket.send(JSON.stringify({ type: "ack", senderId: alice.agentId, id: replayed.envelope.id }));
  secondSocket.close(1000, "acknowledged after replay");

  expect(replayed.envelope.id).toBe(offlineEnvelope.id);
  expect(visibleInboxEntries).toBe(1);
});
