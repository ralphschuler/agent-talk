import { expect, it } from "vite-plus/test";
import { createLocalIdentity, openEnvelope, sealEnvelope, signInvite, verifyInvite } from "../src/crypto.ts";
import type { Invite } from "../src/protocol.ts";

it("uses authenticated HPKE with the pinned sender key", async () => {
  const alice = await createLocalIdentity();
  const bob = await createLocalIdentity();
  const mallory = await createLocalIdentity();
  const envelope = await sealEnvelope(alice, bob, "message-1", "Ist die Dev-Vorschau bereit zum Review?", 1_700_000_000_000);

  await expect(openEnvelope(bob, alice, envelope)).resolves.toBe("Ist die Dev-Vorschau bereit zum Review?");
  await expect(openEnvelope(bob, mallory, envelope)).rejects.toThrow();
  const alteredFinalByte = envelope.ciphertext.endsWith("A") ? "B" : "A";
  await expect(openEnvelope(bob, alice, { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}${alteredFinalByte}` })).rejects.toThrow();
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
