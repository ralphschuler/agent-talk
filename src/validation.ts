import { base64url, fromBase64url, type AgentIdentity, type CipherEnvelope, type Invite } from "./protocol.ts";

export const DAY = 86_400_000;
export const CLOCK_SKEW = 5 * 60_000;
export const REQUEST_LIMIT = 72_000;
const IDENTIFIER = /^[A-Za-z0-9_-]{1,128}$/u;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u;

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function fields(value: unknown, keys: string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

export function agentId(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("at1_") && PUBLIC_KEY.test(value.slice(4));
}

export function identifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.test(value);
}

export function canonicalBytes(value: unknown, min: number, max = min): boolean {
  if (typeof value !== "string" || value.length < Math.ceil(min * 4 / 3) || value.length > Math.ceil(max * 4 / 3)) return false;
  try {
    const bytes = fromBase64url(value);
    return bytes.length >= min && bytes.length <= max && base64url(bytes) === value;
  } catch {
    return false;
  }
}

export function asIdentity(value: unknown): AgentIdentity | null {
  if (!fields(value, ["agentId", "signingPublicKey", "encryptionPublicKey"]) || !agentId(value.agentId)
      || value.signingPublicKey !== value.agentId.slice(4) || !canonicalBytes(value.encryptionPublicKey, 32)) return null;
  return value as AgentIdentity;
}

export function asInvite(value: unknown, origin: string, now = Date.now()): Invite | null {
  if (!fields(value, ["kind", "version", "issuer", "displayName", "inviteId", "expiresAt", "relay", "mcp", "signature"])
      || value.kind !== "agent-talk-invite" || value.version !== 1 || !asIdentity(value.issuer)
      || !identifier(value.inviteId) || !canonicalBytes(value.signature, 64)
      || typeof value.displayName !== "string" || value.displayName.length === 0 || value.displayName.length > 80
      || typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt)
      || value.expiresAt <= now || value.expiresAt > now + DAY + CLOCK_SKEW || value.relay !== origin
      || !fields(value.mcp, ["transport", "hint"]) || value.mcp.transport !== "stdio"
      || typeof value.mcp.hint !== "string" || value.mcp.hint.length > 256) return null;
  return value as Invite;
}

export function asEnvelope(value: unknown): CipherEnvelope | null {
  if (!fields(value, ["version", "id", "senderId", "recipientId", "createdAt", "enc", "ciphertext"])
      || (value.version !== 1 && value.version !== 2) || !identifier(value.id) || !agentId(value.senderId) || !agentId(value.recipientId)
      || value.senderId === value.recipientId || !Number.isSafeInteger(value.createdAt)
      || !canonicalBytes(value.enc, 32) || !canonicalBytes(value.ciphertext, 16, 48_016)) return null;
  return value as CipherEnvelope;
}

export async function readJson(request: Pick<Request, "body" | "headers">, limit = REQUEST_LIMIT): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > limit
      || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const buffer = new Uint8Array(limit);
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.length > limit) {
        await reader.cancel();
        return null;
      }
      buffer.set(chunk.value, length);
      length += chunk.value.length;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(buffer.subarray(0, length)));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}
