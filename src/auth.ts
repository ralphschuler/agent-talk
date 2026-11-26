import * as ed from "@noble/ed25519";
import { authMessage, base64url, fromBase64url } from "./protocol.ts";

export async function signRequestWithKey(secretKey: string, agentId: string, action: string, timestamp: string, payload: unknown): Promise<string> {
  return base64url(await ed.signAsync(authMessage(action, agentId, timestamp, payload), fromBase64url(secretKey)));
}

export async function verifyRequest(
  signingPublicKey: string,
  action: string,
  agentId: string,
  timestamp: string,
  payload: unknown,
  signature: string,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(fromBase64url(signature), authMessage(action, agentId, timestamp, payload), fromBase64url(signingPublicKey), { zip215: false });
  } catch {
    return false;
  }
}
