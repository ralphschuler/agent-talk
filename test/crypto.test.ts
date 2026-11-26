import { expect, it } from "vite-plus/test";
import { createLocalIdentity, openEnvelope, openOwnerCopy, sealEnvelope, sealOwnerCopy, signInvite, verifyInvite } from "../src/crypto.ts";
import type { Invite } from "../src/protocol.ts";

it("supports a maximum-length escaped message in an encrypted owner copy", async () => {
  const agent = await createLocalIdentity();
  const device = await createLocalIdentity();
  const content = JSON.stringify({ text: "\u0000".repeat(12_000) });
  const envelope = await sealOwnerCopy(agent, device, "maximum-owner-copy", content);
  expect(await openOwnerCopy(device, agent, envelope)).toBe(content);
});

it("preserves complete Unicode text at the supported message boundary", async () => {
  const alice = await createLocalIdentity();
  const bob = await createLocalIdentity();
  const text = "\uFEFF" + "🍐".repeat(5999) + "\n";
  const envelope = await sealEnvelope(alice, bob, "unicode-limit", text);
  await expect(openEnvelope(bob, alice, envelope)).resolves.toBe(text);
  await expect(sealEnvelope(alice, bob, "too-long", text + ".")).rejects.toThrow("Unicode text");
});

it("uses authenticated HPKE with the pinned sender key", async () => {
  const alice = await createLocalIdentity();
  const bob = await createLocalIdentity();
  const mallory = await createLocalIdentity();
  const envelope = await sealEnvelope(alice, bob, "message-1", "Is the development preview ready for review?", 1_700_000_000_000);

  await expect(openEnvelope(bob, alice, envelope)).resolves.toBe("Is the development preview ready for review?");
  await expect(openEnvelope(bob, mallory, envelope)).rejects.toThrow();
  await expect(openEnvelope(bob, { ...alice, encryptionPublicKey: mallory.encryptionPublicKey }, envelope)).rejects.toThrow();
  // Change a significant leading base64url character; changing the final one can
  // only touch unused padding bits for some ciphertext lengths.
  const alteredFirstCharacter = envelope.ciphertext.startsWith("A") ? "B" : "A";
  await expect(openEnvelope(bob, alice, { ...envelope, ciphertext: `${alteredFirstCharacter}${envelope.ciphertext.slice(1)}` })).rejects.toThrow();
});

it("accepts a signed, unexpired invite once it is pinned locally", async () => {
  const alice = await createLocalIdentity();
  const unsigned = {
    kind: "agent-talk-invite" as const,
    version: 1 as const,
    issuer: { agentId: alice.agentId, signingPublicKey: alice.signingPublicKey, encryptionPublicKey: alice.encryptionPublicKey },
    displayName: "Alice test agent",
    inviteId: "invite-test-1",
    expiresAt: Date.now() + 60_000,
    relay: "https://relay.invalid",
    mcp: { transport: "stdio" as const, hint: "local adapter only" },
  };
  const invite = await signInvite(alice, unsigned);
  await expect(verifyInvite(invite)).resolves.toBeUndefined();
  await expect(verifyInvite({ ...invite, displayName: "tampered" } as Invite)).rejects.toThrow("signature");
  await expect(verifyInvite({ ...invite, expiresAt: 1 } as Invite)).rejects.toThrow("expired");
});
