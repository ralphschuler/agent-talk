import { signRequest, verifyRequest, type LocalIdentity } from "../src/crypto.ts";
import { agentIdFromSigningKey, base64url, fromBase64url, type AgentIdentity } from "../src/protocol.ts";

// The caller must obtain explicit approval before signing and atomically consume
// the challenge before storing a pairing. This module performs no authorization.
export interface PairingRequest {
  accountId: string;
  agentId: string;
  device: AgentIdentity;
  nonce: string;
  expiresAt: number;
}

export interface PairingApproval {
  request: PairingRequest;
  signature: string;
  agent: AgentIdentity;
  identitySignature: string;
}

function validate(request: PairingRequest, now: number): void {
  if (Object.keys(request).sort().join(",") !== "accountId,agentId,device,expiresAt,nonce" ||
      Object.keys(request.device).sort().join(",") !== "agentId,encryptionPublicKey,signingPublicKey" ||
      !/^at1_[A-Za-z0-9_-]{43}$/.test(request.agentId) ||
      !/^[1-9][0-9]{0,19}$/.test(request.accountId) ||
      !/^[A-Za-z0-9_-]{43}$/.test(request.nonce) ||
      !Number.isSafeInteger(request.expiresAt) || request.expiresAt <= now ||
      request.expiresAt > now + 5 * 60_000 ||
      agentIdFromSigningKey(request.device.signingPublicKey) !== request.device.agentId ||
      fromBase64url(request.device.encryptionPublicKey).length !== 32) {
    throw new Error("Invalid or expired pairing request.");
  }
}

export function createPairingRequest(accountId: string, agentId: string, device: AgentIdentity, now = Date.now()): PairingRequest {
  const request = {
    accountId, agentId,
    device: {
      agentId: device.agentId,
      signingPublicKey: device.signingPublicKey,
      encryptionPublicKey: device.encryptionPublicKey,
    },
    nonce: base64url(crypto.getRandomValues(new Uint8Array(32))),
    expiresAt: now + 5 * 60_000,
  };
  validate(request, now);
  return request;
}

export async function approvePairing(request: PairingRequest, agent: LocalIdentity, now = Date.now()): Promise<PairingApproval> {
  validate(request, now);
  if (request.agentId !== agent.agentId) throw new Error("Pairing agent mismatch.");
  const identity = { agentId: agent.agentId, signingPublicKey: agent.signingPublicKey, encryptionPublicKey: agent.encryptionPublicKey };
  return {
    request,
    signature: await signRequest(agent, "owner-device-pairing-v1", String(request.expiresAt), request),
    agent: identity,
    identitySignature: await signRequest(agent, "owner-device-identity-v1", String(request.expiresAt), { request, agent: identity }),
  };
}

export async function verifyPairing(
  approval: PairingApproval, expectedAccount: string, pinnedAgent: AgentIdentity, now = Date.now(),
): Promise<void> {
  const { request, signature } = approval;
  validate(request, now);
  if (request.accountId !== expectedAccount || request.agentId !== pinnedAgent.agentId ||
      agentIdFromSigningKey(pinnedAgent.signingPublicKey) !== pinnedAgent.agentId ||
      approval.agent.agentId !== pinnedAgent.agentId ||
      approval.agent.signingPublicKey !== pinnedAgent.signingPublicKey ||
      fromBase64url(approval.agent.encryptionPublicKey).length !== 32 ||
      !await verifyRequest(pinnedAgent.signingPublicKey, "owner-device-identity-v1", pinnedAgent.agentId,
        String(request.expiresAt), { request, agent: approval.agent }, approval.identitySignature) ||
      !await verifyRequest(pinnedAgent.signingPublicKey, "owner-device-pairing-v1", pinnedAgent.agentId,
        String(request.expiresAt), request, signature)) {
    throw new Error("Pairing approval does not match the account and pinned agent.");
  }
}
