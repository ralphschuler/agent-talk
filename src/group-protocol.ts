import { base64url, fromBase64url, stableJson } from "./protocol.ts";
import { agentId, canonicalBytes, fields, record } from "./validation.ts";

export const MAX_GROUP_MEMBERS = 8;
export const MAX_GROUP_WIRE = 65_536;
export const MAX_GROUP_KEY_PACKAGE = 8_192;
export const GROUP_REQUEST_LIMIT = 210_000;
export const GROUP_PAGE_SIZE = 8;

type SignedGroup = {
  id: string;
  groupId: string;
  actor: string;
  relay: string;
  epoch: number;
  signature: string;
};
export type GroupCreate = SignedGroup & { kind: "create" };
export type GroupApp = SignedGroup & { kind: "app"; wire: string };
export type GroupGrant = SignedGroup & {
  kind: "grant";
  action: "add" | "remove";
  delegate: string;
  target: string;
};
export type GroupRevoke = SignedGroup & { kind: "revoke"; permitId: string };
export type GroupInvite = SignedGroup & {
  kind: "invite";
  owner: string;
  target: string;
  members: string[];
  expiresAt: number;
  permit: GroupGrant | null;
};
export type GroupConsent = SignedGroup & {
  kind: "consent";
  invite: GroupInvite;
  keyPackage: string;
};
export type GroupAdd = SignedGroup & {
  kind: "add";
  target: string;
  consent: GroupConsent;
  commit: string;
  welcomeHash: string;
  permit: GroupGrant | null;
};
export type GroupRemove = SignedGroup & {
  kind: "remove";
  target: string;
  commit: string;
  permit: GroupGrant | null;
};
export type GroupLeave = SignedGroup & { kind: "leave" };
export type GroupClose = SignedGroup & { kind: "close" };
export type GroupOp =
  | GroupCreate
  | GroupApp
  | GroupGrant
  | GroupRevoke
  | GroupAdd
  | GroupRemove
  | GroupLeave
  | GroupClose;
export type GroupSigned = GroupOp | GroupInvite | GroupConsent;
export type GroupEvent = { seq: number; op: GroupOp; welcome?: string };

const common = ["id", "groupId", "actor", "relay", "epoch", "kind", "signature"];
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u;

export function groupSigningBytes(unsigned: object): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(new TextEncoder().encode("agent-talk.group.v1\n" + stableJson(unsigned)));
}

export async function verifyGroupSignature(signed: GroupSigned): Promise<boolean> {
  try {
    if (!agentId(signed.actor)) return false;
    const { signature, ...unsigned } = signed;
    const key = await crypto.subtle.importKey(
      "raw",
      Uint8Array.from(fromBase64url(signed.actor.slice(4))),
      "Ed25519",
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(fromBase64url(signature)),
      groupSigningBytes(unsigned),
    );
  } catch {
    return false;
  }
}

export async function digestGroupWire(wire: string): Promise<string> {
  return base64url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(fromBase64url(wire)))),
  );
}

export function groupCursor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function groupId(value: unknown): value is string {
  return typeof value === "string" && uuid.test(value);
}

function base(
  value: unknown,
  kind: string,
  origin: string,
  extra: string[],
): value is Record<string, unknown> {
  return (
    fields(value, [...common, ...extra]) &&
    value.kind === kind &&
    value.relay === origin &&
    groupId(value.id) &&
    groupId(value.groupId) &&
    agentId(value.actor) &&
    groupCursor(value.epoch) &&
    canonicalBytes(value.signature, 64)
  );
}

function isPermit(value: unknown, origin: string): value is GroupGrant {
  return (
    base(value, "grant", origin, ["action", "delegate", "target"]) &&
    (value.action === "add" || value.action === "remove") &&
    agentId(value.delegate) &&
    agentId(value.target)
  );
}

export function asGroupInvite(value: unknown, origin: string): GroupInvite | null {
  if (
    !base(value, "invite", origin, ["owner", "target", "members", "expiresAt", "permit"]) ||
    !agentId(value.owner) ||
    !agentId(value.target) ||
    !groupCursor(value.expiresAt) ||
    !Array.isArray(value.members) ||
    value.members.length === 0 ||
    value.members.length > MAX_GROUP_MEMBERS ||
    !value.members.every(
      (member, i, list) => agentId(member) && (i === 0 || member > list[i - 1]),
    ) ||
    !value.members.includes(value.owner) ||
    !value.members.includes(value.actor) ||
    value.members.includes(value.target) ||
    !(value.permit === null || isPermit(value.permit, origin))
  )
    return null;
  return value as GroupInvite;
}

export function asGroupConsent(value: unknown, origin: string): GroupConsent | null {
  if (
    !base(value, "consent", origin, ["invite", "keyPackage"]) ||
    !asGroupInvite(value.invite, origin) ||
    !canonicalBytes(value.keyPackage, 1, MAX_GROUP_KEY_PACKAGE)
  )
    return null;
  return value as GroupConsent;
}

export function asGroupOp(value: unknown, origin: string): GroupOp | null {
  if (!record(value)) return null;
  let valid: boolean;
  switch (value.kind) {
    case "create":
    case "leave":
    case "close":
      valid = base(value, value.kind, origin, []);
      break;
    case "app":
      valid = base(value, "app", origin, ["wire"]) && canonicalBytes(value.wire, 1, MAX_GROUP_WIRE);
      break;
    case "grant":
      valid = isPermit(value, origin);
      break;
    case "revoke":
      valid = base(value, "revoke", origin, ["permitId"]) && groupId(value.permitId);
      break;
    case "add":
      valid =
        base(value, "add", origin, ["target", "consent", "commit", "welcomeHash", "permit"]) &&
        agentId(value.target) &&
        asGroupConsent(value.consent, origin) !== null &&
        canonicalBytes(value.commit, 1, MAX_GROUP_WIRE) &&
        canonicalBytes(value.welcomeHash, 32) &&
        (value.permit === null || isPermit(value.permit, origin));
      break;
    case "remove":
      valid =
        base(value, "remove", origin, ["target", "commit", "permit"]) &&
        agentId(value.target) &&
        canonicalBytes(value.commit, 1, MAX_GROUP_WIRE) &&
        (value.permit === null || isPermit(value.permit, origin));
      break;
    default:
      return null;
  }
  return valid ? (value as GroupOp) : null;
}

export function groupHttpAction(action: string, origin: string): string {
  return "agent-talk.group-http.v1\n" + origin + "\n" + action;
}

export function validGroupRequest(action: string, body: unknown, origin: string): boolean {
  switch (action) {
    case "group/sync":
      return fields(body, ["after"]) && groupCursor(body.after);
    case "group/ack":
      return fields(body, ["through"]) && groupCursor(body.through);
    case "group/submit": {
      if (!record(body)) return false;
      const op = asGroupOp(body.op, origin);
      if (!op) return false;
      return op.kind === "add"
        ? fields(body, ["op", "welcome"]) && canonicalBytes(body.welcome, 1, MAX_GROUP_WIRE)
        : fields(body, ["op"]);
    }
    default:
      return false;
  }
}

export const GROUP_CAPACITY_REJECTION = "group_capacity_rejected";

export function isGroupCapacityRejection(
  value: unknown,
  op: Pick<GroupOp, "id" | "groupId" | "actor">,
): boolean {
  return (
    fields(value, ["error", "code", "operationId", "groupId", "actor"]) &&
    typeof value.error === "string" &&
    value.code === GROUP_CAPACITY_REJECTION &&
    value.operationId === op.id &&
    value.groupId === op.groupId &&
    value.actor === op.actor
  );
}
