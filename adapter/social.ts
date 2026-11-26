import { createHash } from "node:crypto";
import { signAsync, verifyAsync } from "@noble/ed25519";
import { base64url, fromBase64url, stableJson, type AgentIdentity } from "../src/protocol.ts";
import { TYPED_DIRECT } from "../src/direct.ts";
import { asIdentity, canonicalBytes, fields } from "../src/validation.ts";
import type { LocalIdentity } from "../src/crypto.ts";

export type PublicProfile = {
  kind: "agent-talk-profile";
  version: 1;
  issuer: AgentIdentity;
  fingerprint: string;
  displayName: string;
  relay: string;
  capabilities: string[];
  protocols: string[];
  mcp: { transport: "stdio" };
  signature: string;
};
export const capabilityLabel = /^[a-z][a-z0-9._-]{0,39}$/u;

export function keyFingerprint(identity: AgentIdentity): string {
  return createHash("sha256")
    .update(JSON.stringify([identity.signingPublicKey, identity.encryptionPublicKey]))
    .digest("hex");
}

export function replacementPrompt(
  oldId: string,
  oldFingerprint: string,
  newId: string,
  newFingerprint: string,
  relay: string,
): string {
  return `Retire contact ${oldId} (fingerprint ${oldFingerprint}) and confirm replacement ${newId} (fingerprint ${newFingerprint}) at ${relay}? Verify both fingerprints privately. Group memberships and permissions do not transfer.`;
}

function profileBytes(data: Omit<PublicProfile, "signature">) {
  return new TextEncoder().encode("agent-talk/public-profile/v1\n" + stableJson(data));
}

function labels(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 16 &&
    value.every((s) => typeof s === "string" && capabilityLabel.test(s)) &&
    new Set(value).size === value.length
  );
}

function validOrigin(raw: unknown) {
  if (typeof raw !== "string" || raw.length > 512) return false;
  try {
    const url = new URL(raw);
    return (
      url.origin === raw &&
      (url.protocol === "https:" ||
        (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    );
  } catch {
    return false;
  }
}

function profileName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 80 &&
    value.isWellFormed() &&
    !/[\p{Cc}\p{Cf}]/u.test(value)
  );
}

export async function exportProfile(
  identity: LocalIdentity,
  relay: string,
  displayName: string,
  capabilities: string[],
): Promise<PublicProfile> {
  if (!profileName(displayName) || !labels(capabilities) || !validOrigin(relay))
    throw new Error("Invalid public profile.");
  const { agentId, signingPublicKey, encryptionPublicKey } = identity;
  const data: Omit<PublicProfile, "signature"> = {
    kind: "agent-talk-profile",
    version: 1,
    issuer: { agentId, signingPublicKey, encryptionPublicKey },
    fingerprint: keyFingerprint(identity),
    displayName,
    relay,
    capabilities,
    protocols: [TYPED_DIRECT],
    mcp: { transport: "stdio" },
  };
  return {
    ...data,
    signature: base64url(
      await signAsync(profileBytes(data), fromBase64url(identity.signingSecretKey)),
    ),
  };
}

export async function inspectProfile(serialized: string): Promise<PublicProfile> {
  let data: unknown;
  try {
    data = JSON.parse(serialized);
  } catch {
    throw new Error("Invalid public profile JSON.");
  }
  if (
    !fields(data, [
      "kind",
      "version",
      "issuer",
      "fingerprint",
      "displayName",
      "relay",
      "capabilities",
      "protocols",
      "mcp",
      "signature",
    ]) ||
    data.kind !== "agent-talk-profile" ||
    data.version !== 1 ||
    !asIdentity(data.issuer) ||
    !profileName(data.displayName) ||
    !validOrigin(data.relay) ||
    !labels(data.capabilities) ||
    !labels(data.protocols) ||
    !fields(data.mcp, ["transport"]) ||
    data.mcp.transport !== "stdio" ||
    !canonicalBytes(data.signature, 64)
  )
    throw new Error("Invalid public profile.");
  const profile = data as PublicProfile;
  if (keyFingerprint(profile.issuer) !== profile.fingerprint)
    throw new Error("Profile fingerprint mismatch.");
  const { signature, ...unsigned } = profile;
  if (
    !(await verifyAsync(
      fromBase64url(signature),
      profileBytes(unsigned),
      fromBase64url(profile.issuer.signingPublicKey),
      { zip215: false },
    ))
  )
    throw new Error("Invalid public profile signature.");
  return profile;
}
