export const PROTOCOL_VERSION = 1;
export const MAX_TEXT_LENGTH = 12_000;

export type AgentIdentity = {
  agentId: string;
  signingPublicKey: string;
  encryptionPublicKey: string;
};

export type Invite = {
  kind: "agent-talk-invite";
  version: 1;
  issuer: AgentIdentity;
  displayName: string;
  inviteId: string;
  expiresAt: number;
  relay: string;
  mcp: { transport: "stdio"; hint: string };
  signature: string;
};

export type CipherEnvelope = {
  version: 1;
  id: string;
  senderId: string;
  recipientId: string;
  createdAt: number;
  enc: string;
  ciphertext: string;
};

export type AuthHeaders = {
  agentId: string;
  timestamp: string;
  signature: string;
};

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function fromBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid base64url");
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function agentIdFromSigningKey(signingPublicKey: string): string {
  const key = fromBase64url(signingPublicKey);
  if (key.byteLength !== 32) throw new Error("an Ed25519 public key must be 32 bytes");
  return `at1_${signingPublicKey}`;
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
}

export function authMessage(action: string, agentId: string, timestamp: string, payload: unknown): Uint8Array {
  return new TextEncoder().encode(`${action}\n${agentId}\n${timestamp}\n${stableJson(payload)}`);
}

export function inviteMessage(invite: Omit<Invite, "signature">): Uint8Array {
  return new TextEncoder().encode(`invite\n${stableJson(invite)}`);
}

export function envelopeAad(envelope: Pick<CipherEnvelope, "id" | "senderId" | "recipientId" | "createdAt">): Uint8Array {
  return new TextEncoder().encode(stableJson({
    id: envelope.id,
    senderId: envelope.senderId,
    recipientId: envelope.recipientId,
    createdAt: envelope.createdAt,
  }));
}
