import { Chacha20Poly1305 } from "@hpke/chacha20poly1305";
import { CipherSuite } from "@hpke/core";
import { DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/dhkem-x25519";
import * as ed from "@noble/ed25519";
import { signRequestWithKey, verifyRequest } from "./auth.ts";
import { decodeLetter, encodeLetter, type DirectLetter, validText } from "./direct.ts";
import {
  agentIdFromSigningKey,
  base64url,
  envelopeAad,
  fromBase64url,
  inviteMessage,
  MAX_TEXT_LENGTH,
  type AgentIdentity,
  type CipherEnvelope,
  type Invite,
} from "./protocol.ts";

const suite = new CipherSuite({
  kem: new DhkemX25519HkdfSha256(),
  kdf: new HkdfSha256(),
  aead: new Chacha20Poly1305(),
});

export type LocalIdentity = AgentIdentity & {
  signingSecretKey: string;
  encryptionSecretKey: string;
};

export async function createLocalIdentity(): Promise<LocalIdentity> {
  const signing = await ed.keygenAsync();
  const encryption = await suite.kem.generateKeyPair();
  return {
    signingPublicKey: base64url(signing.publicKey),
    signingSecretKey: base64url(signing.secretKey),
    encryptionPublicKey: base64url(new Uint8Array(await suite.kem.serializePublicKey(encryption.publicKey))),
    encryptionSecretKey: base64url(new Uint8Array(await suite.kem.serializePrivateKey(encryption.privateKey))),
    agentId: agentIdFromSigningKey(base64url(signing.publicKey)),
  };
}

export async function signRequest(identity: LocalIdentity, action: string, timestamp: string, payload: unknown): Promise<string> {
  return signRequestWithKey(identity.signingSecretKey, identity.agentId, action, timestamp, payload);
}

export { verifyRequest };

export async function signInvite(identity: LocalIdentity, invite: Omit<Invite, "signature">): Promise<Invite> {
  const signature = await ed.signAsync(inviteMessage(invite), fromBase64url(identity.signingSecretKey));
  return { ...invite, signature: base64url(signature) };
}

export async function verifyInvite(invite: Invite, now = Date.now()): Promise<void> {
  const { signature, ...unsigned } = invite;
  if (invite.kind !== "agent-talk-invite" || invite.version !== 1) throw new Error("unsupported invite");
  if (invite.expiresAt <= now) throw new Error("invite expired");
  if (agentIdFromSigningKey(invite.issuer.signingPublicKey) !== invite.issuer.agentId) throw new Error("invite identity mismatch");
  const verified = await ed.verifyAsync(fromBase64url(signature), inviteMessage(unsigned), fromBase64url(invite.issuer.signingPublicKey), { zip215: false });
  if (!verified) throw new Error("invite signature invalid");
}

export async function sealEnvelope(
  identity: LocalIdentity,
  recipient: AgentIdentity,
  id: string,
  plaintext: string,
  createdAt = Date.now(),
): Promise<CipherEnvelope> {
  if (!validText(plaintext)) {
    throw new Error("Expected 1–12000 characters of Unicode text.");
  }
  return sealBytes(identity, recipient, id, createdAt, 1, new TextEncoder().encode(plaintext));
}

export function sealDirect(identity: LocalIdentity, recipient: AgentIdentity, id: string, letter: DirectLetter, createdAt = Date.now()): Promise<CipherEnvelope> {
  return sealBytes(identity, recipient, id, createdAt, 2, encodeLetter(letter, { id, senderId: identity.agentId, recipientId: recipient.agentId }));
}

async function sealBytes(identity: LocalIdentity, recipient: AgentIdentity, id: string, createdAt: number, version: 1|2, bytes: Uint8Array): Promise<CipherEnvelope> {
  const header = { version, id, senderId: identity.agentId, recipientId: recipient.agentId, createdAt };
  const senderKey = {
    privateKey: await suite.kem.deserializePrivateKey(fromBase64url(identity.encryptionSecretKey)),
    publicKey: await suite.kem.deserializePublicKey(fromBase64url(identity.encryptionPublicKey)),
  };
  const recipientPublicKey = await suite.kem.deserializePublicKey(fromBase64url(recipient.encryptionPublicKey));
  const context = await suite.createSenderContext({ recipientPublicKey, senderKey });
  const ciphertext = await context.seal(bytes, envelopeAad(header));
  return { ...header, enc: base64url(new Uint8Array(context.enc)), ciphertext: base64url(new Uint8Array(ciphertext)) };
}

async function openBytes(identity: LocalIdentity, sender: AgentIdentity, envelope: CipherEnvelope): Promise<ArrayBuffer> {
  if (envelope.recipientId !== identity.agentId || envelope.senderId !== sender.agentId) throw new Error("envelope route mismatch");
  const recipientKey = await suite.kem.deserializePrivateKey(fromBase64url(identity.encryptionSecretKey));
  const senderPublicKey = await suite.kem.deserializePublicKey(fromBase64url(sender.encryptionPublicKey));
  const context = await suite.createRecipientContext({ recipientKey, senderPublicKey, enc: fromBase64url(envelope.enc) });
  return context.open(fromBase64url(envelope.ciphertext), envelopeAad(envelope));
}

export async function openDirect(identity: LocalIdentity, sender: AgentIdentity, envelope: CipherEnvelope): Promise<DirectLetter> {
  if (envelope.version !== 2) throw new Error("Expected a typed direct envelope.");
  return decodeLetter(await openBytes(identity, sender, envelope), envelope);
}

export async function openEnvelope(identity: LocalIdentity, sender: AgentIdentity, envelope: CipherEnvelope): Promise<string> {
  if (envelope.version !== 1) throw new Error("Expected a legacy direct envelope.");
  const plaintext = await openBytes(identity,sender,envelope);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(plaintext);
  if (text.length === 0 || text.length > MAX_TEXT_LENGTH) throw new Error("Invalid message length.");
  return text;
}
