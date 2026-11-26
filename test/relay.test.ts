import { SELF } from "cloudflare:test";
import { expect, it } from "vite-plus/test";
import { createLocalIdentity, sealEnvelope, signInvite, signRequest } from "../src/crypto.ts";
import type { LocalIdentity } from "../src/crypto.ts";
import type { Invite } from "../src/protocol.ts";

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

async function register(identity: LocalIdentity): Promise<void> {
  const response = await signedPost("/v1/register", identity, "register", { identity: {
    agentId: identity.agentId, signingPublicKey: identity.signingPublicKey, encryptionPublicKey: identity.encryptionPublicKey,
  } });
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

  const envelope = await sealEnvelope(alice, bob, "live-1", "Ist die Dev-Vorschau bereit zum Review?");
  expect((await signedPost("/v1/send", alice, "send", { envelope })).status).toBe(201);

  expect((await signedPost("/v1/contact/block", bob, "contact/block", { peerId: alice.agentId })).status).toBe(200);
  const afterBlock = await sealEnvelope(alice, bob, "blocked-1", "still opaque");
  expect((await signedPost("/v1/send", alice, "send", { envelope: afterBlock })).status).toBe(403);
});

it("pushes live and safely replays after local persistence but before ACK", async () => {
  const alice = await createLocalIdentity();
  const bob = await createLocalIdentity();
  await Promise.all([register(alice), register(bob)]);
  await mutuallyApprove(alice, bob, "replay");

  // A connected mailbox gets a live push through the real Worker /v1/socket route.
  const liveSocket = await socketFor(bob);
  const livePush = nextMessage(liveSocket);
  const liveEnvelope = await sealEnvelope(alice, bob, "live-socket-1", "Ist die Dev-Vorschau bereit zum Review?");
  expect((await signedPost("/v1/send", alice, "send", { envelope: liveEnvelope })).status).toBe(201);
  const live = await livePush;
  expect(live.envelope.id).toBe(liveEnvelope.id);
  expect(live.envelope.ciphertext).not.toContain("Dev-Vorschau");
  liveSocket.send(JSON.stringify({ type: "ack", id: liveEnvelope.id }));
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
  secondSocket.send(JSON.stringify({ type: "ack", id: replayed.envelope.id }));
  secondSocket.close(1000, "acknowledged after replay");

  expect(replayed.envelope.id).toBe(offlineEnvelope.id);
  expect(visibleInboxEntries).toBe(1);
});
