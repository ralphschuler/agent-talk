// Endpoint-only MLS. Every transition starts from freshly decoded bytes and returns a
// separate serialized candidate. Only the caller decides which candidate to persist.
import type {
  ClientConfig,
  ClientState,
  Credential,
  KeyPackage,
  MLSMessage,
  Proposal,
} from "ts-mls";
import { createApplicationMessage } from "ts-mls/createMessage.js";
import { createCommit } from "ts-mls/createCommit.js";
import {
  createGroup,
  joinGroup,
  decodeGroupState,
  encodeGroupState,
  getOwnLeafNode,
  getGroupMembers,
} from "ts-mls/clientState.js";
import { decodeMlsMessage, encodeMlsMessage } from "ts-mls/message.js";
import { defaultCapabilities } from "ts-mls/defaultCapabilities.js";
import { emptyPskIndex } from "ts-mls/pskIndex.js";
import {
  generateKeyPackageWithKey,
  makeKeyPackageRef,
  verifyKeyPackage,
} from "ts-mls/keyPackage.js";
import { getCiphersuiteFromName } from "ts-mls/crypto/ciphersuite.js";
import { getCiphersuiteImpl } from "ts-mls/crypto/getCiphersuiteImpl.js";
import { processMessage } from "ts-mls/processMessages.js";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import { decryptGroupInfo, decryptGroupSecrets } from "ts-mls/welcome.js";
import { decryptSenderData } from "ts-mls/privateMessage.js";
import {
  getCredentialFromLeafIndex,
  getSignaturePublicKeyFromLeafIndex,
  findLeafIndex,
} from "ts-mls/ratchetTree.js";
import { toLeafIndex } from "ts-mls/treemath.js";
import {
  groupId as isGroupId,
  MAX_GROUP_KEY_PACKAGE as MAX_PACKAGE,
  MAX_GROUP_MEMBERS as MAX_MEMBERS,
  MAX_GROUP_WIRE as MAX_WIRE,
} from "../src/group-protocol.ts";
import type { LocalIdentity } from "../src/crypto.ts";
import { base64url, fromBase64url } from "../src/protocol.ts";

export type MlsState = string;
export type MlsJoinPackage = { keyPackage: string; initPrivateKey: string; hpkePrivateKey: string };
export type MlsChange = { kind: "add" | "remove"; agentId: string };
const suite = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";
const cryptoSuite = getCiphersuiteImpl(getCiphersuiteFromName(suite));
const utf8 = new TextEncoder();
const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const MAX_LOCAL_STATE = 512 * 1024;

function check(condition: unknown, description: string): asserts condition {
  if (!condition) throw new Error("MLS " + description);
}

function bytes(value: string, maximum: number): Uint8Array {
  check(
    typeof value === "string" && value.length > 0 && value.length <= Math.ceil((maximum * 4) / 3),
    "byte limit",
  );
  const result = fromBase64url(value);
  check(base64url(result) === value && result.length <= maximum, "noncanonical bytes");
  return result;
}

function key(value: string) {
  const result = bytes(value, 32);
  check(result.length === 32, "invalid public or private key length");
  return result;
}

function agentId(credential: Credential, publicKey: Uint8Array): string {
  check(
    credential.credentialType === "basic" && publicKey.length === 32,
    "requires an Ed25519 Basic Credential",
  );
  const expected = "at1_" + base64url(publicKey);
  check(text.decode(credential.identity) === expected, "credential differs from signature key");
  return expected;
}

const config: ClientConfig = {
  ...defaultClientConfig,
  // The authenticated delivery stream is ordered. Older epoch traffic cannot enter the inbox.
  keyRetentionConfig: {
    ...defaultClientConfig.keyRetentionConfig,
    retainKeysForEpochs: 0,
    retainKeysForGenerations: 0,
  },
  authService: {
    async validateCredential(credential, publicKey) {
      try {
        agentId(credential, publicKey);
        return true;
      } catch {
        return false;
      }
    },
  },
};

function groupId(value: string) {
  check(isGroupId(value), "invalid group ID");
  return utf8.encode(value);
}

function roster(state: ClientState) {
  const members = getGroupMembers(state).map((leaf) =>
    agentId(leaf.credential, leaf.signaturePublicKey),
  );
  check(
    members.length > 0 && members.length <= MAX_MEMBERS && new Set(members).size === members.length,
    "invalid roster",
  );
  return members;
}

function sameRoster(actual: string[], expected: string[]) {
  check(
    actual.length === expected.length &&
      new Set(expected).size === expected.length &&
      expected.every((id) => actual.includes(id)),
    "unexpected membership",
  );
}

function stateOf(snapshot: MlsState): ClientState {
  const raw = bytes(snapshot, MAX_LOCAL_STATE);
  const decoded = decodeGroupState(raw, 0);
  check(decoded && decoded[1] === raw.length, "invalid local state");
  const state = { ...decoded[0], clientConfig: config };
  check(
    state.groupContext.version === "mls10" &&
      state.groupContext.cipherSuite === suite &&
      state.groupActiveState.kind === "active" &&
      state.groupContext.epoch <= BigInt(Number.MAX_SAFE_INTEGER),
    "unsupported local state",
  );
  groupId(text.decode(state.groupContext.groupId));
  roster(state);
  return state;
}

function save(state: ClientState): MlsState {
  const encoded = encodeGroupState(state);
  check(encoded.length <= MAX_LOCAL_STATE, "local state too large");
  return base64url(encoded);
}

function wire(message: MLSMessage, limit = MAX_WIRE) {
  const encoded = encodeMlsMessage(message);
  check(encoded.length <= limit, "wire too large");
  return base64url(encoded);
}

function readWire(value: string, limit = MAX_WIRE) {
  const raw = bytes(value, limit);
  const decoded = decodeMlsMessage(raw, 0);
  check(
    decoded &&
      decoded[1] === raw.length &&
      decoded[0].version === "mls10" &&
      wire(decoded[0], limit) === value,
    "invalid or trailing wire data",
  );
  return decoded[0];
}

function checkFrameContext(
  state: ClientState,
  frame: { groupId: Uint8Array; epoch: bigint; authenticatedData: Uint8Array },
  context: string,
) {
  check(
    Buffer.from(frame.groupId).equals(state.groupContext.groupId) &&
      frame.epoch === state.groupContext.epoch,
    "wrong group or epoch",
  );
  check(
    Buffer.from(frame.authenticatedData).equals(utf8.encode(context)),
    "wrong authenticated context",
  );
}

async function checkedKeyPackage(value: string, id: string): Promise<KeyPackage> {
  const message = readWire(value, MAX_PACKAGE);
  check(message.wireformat === "mls_key_package", "expected KeyPackage");
  const kp = message.keyPackage;
  check(
    kp.version === "mls10" &&
      kp.cipherSuite === suite &&
      agentId(kp.leafNode.credential, kp.leafNode.signaturePublicKey) === id,
    "wrong KeyPackage identity or suite",
  );
  check(await verifyKeyPackage(kp, (await cryptoSuite).signature), "invalid KeyPackage signature");
  return kp;
}

async function makePackage(identity: LocalIdentity) {
  const publicKey = key(identity.signingPublicKey);
  const credential: Credential = {
    credentialType: "basic",
    identity: utf8.encode(identity.agentId),
  };
  agentId(credential, publicKey);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const cs = await cryptoSuite;
  const pair = await generateKeyPackageWithKey(
    credential,
    defaultCapabilities(),
    { notBefore: now - 300n, notAfter: now + 86400n },
    [],
    { signKey: key(identity.signingSecretKey), publicKey },
    cs,
  );
  check(await verifyKeyPackage(pair.publicPackage, cs.signature), "local signing key mismatch");
  return pair;
}

export async function prepareMlsJoin(identity: LocalIdentity): Promise<MlsJoinPackage> {
  const pair = await makePackage(identity);
  return {
    keyPackage: wire(
      { version: "mls10", wireformat: "mls_key_package", keyPackage: pair.publicPackage },
      MAX_PACKAGE,
    ),
    initPrivateKey: base64url(pair.privatePackage.initPrivateKey),
    hpkePrivateKey: base64url(pair.privatePackage.hpkePrivateKey),
  };
}

export async function createMlsGroup(identity: LocalIdentity, id: string): Promise<MlsState> {
  const gid = groupId(id);
  const pair = await makePackage(identity);
  return save(
    await createGroup(gid, pair.publicPackage, pair.privatePackage, [], await cryptoSuite, config),
  );
}

export function inspectMls(snapshot: MlsState) {
  const state = stateOf(snapshot);
  return {
    groupId: text.decode(state.groupContext.groupId),
    epoch: Number(state.groupContext.epoch),
    members: roster(state),
  };
}

function membersAfter(state: ClientState, change: MlsChange): string[] {
  const before = roster(state);
  const present = before.includes(change.agentId);
  if (change.kind === "remove") {
    check(present && before.length > 1, "cannot remove that member");
    return before.filter((id) => id !== change.agentId);
  }
  check(change.kind === "add" && !present && before.length < MAX_MEMBERS, "cannot add that member");
  return [...before, change.agentId];
}

function memberAt(state: ClientState, index: number) {
  const leaf = toLeafIndex(index);
  return agentId(
    getCredentialFromLeafIndex(state.ratchetTree, leaf),
    getSignaturePublicKeyFromLeafIndex(state.ratchetTree, leaf),
  );
}

function removalIndex(state: ClientState, id: string) {
  const leaf = getGroupMembers(state).find(
    (node) => agentId(node.credential, node.signaturePublicKey) === id,
  );
  check(leaf, "no member to remove");
  const index = findLeafIndex(state.ratchetTree, leaf);
  check(index !== undefined, "no leaf for member");
  return index;
}

export async function commitMls(
  snapshot: MlsState,
  change: MlsChange,
  keyPackage?: string,
  context = "",
) {
  const state = stateOf(snapshot);
  const expected = membersAfter(state, change);
  const proposals: Proposal[] = [];
  if (change.kind === "add") {
    check(keyPackage, "missing admission KeyPackage");
    const kp = await checkedKeyPackage(keyPackage, change.agentId);
    const now = BigInt(Math.floor(Date.now() / 1000));
    check(
      kp.leafNode.lifetime.notBefore <= now && now <= kp.leafNode.lifetime.notAfter,
      "admission KeyPackage expired",
    );
    proposals.push({ proposalType: "add", add: { keyPackage: kp } });
  } else {
    check(keyPackage === undefined, "unexpected KeyPackage");
    if (change.kind === "remove")
      proposals.push({
        proposalType: "remove",
        remove: { removed: removalIndex(state, change.agentId) },
      });
  }
  const result = await createCommit(
    { state, cipherSuite: await cryptoSuite },
    {
      wireAsPublicMessage: true,
      extraProposals: proposals,
      ratchetTreeExtension: change.kind === "add",
      authenticatedData: utf8.encode(context),
    },
  );
  sameRoster(roster(result.newState), expected);
  check(!!result.welcome === (change.kind === "add"), "unexpected Welcome");
  return {
    state: save(result.newState),
    commit: wire(result.commit),
    ...(result.welcome && {
      welcome: wire({ version: "mls10", wireformat: "mls_welcome", welcome: result.welcome }),
    }),
  };
}

export async function joinMlsGroup(
  identity: LocalIdentity,
  prepared: MlsJoinPackage,
  welcome: string,
  id: string,
  epoch: number,
  members: string[],
  expectedSigner: string,
): Promise<MlsState> {
  groupId(id);
  check(
    Number.isSafeInteger(epoch) &&
      epoch >= 1 &&
      members.length <= MAX_MEMBERS &&
      members.includes(identity.agentId),
    "invalid admission",
  );
  const kp = await checkedKeyPackage(prepared.keyPackage, identity.agentId);
  const message = readWire(welcome);
  check(
    message.wireformat === "mls_welcome" &&
      message.welcome.cipherSuite === suite &&
      message.welcome.secrets.length === 1,
    "expected one targeted Welcome",
  );
  const cs = await cryptoSuite;
  const privateKeys = {
    initPrivateKey: key(prepared.initPrivateKey),
    hpkePrivateKey: key(prepared.hpkePrivateKey),
    signaturePrivateKey: key(identity.signingSecretKey),
  };
  const state = await joinGroup(
    message.welcome,
    kp,
    privateKeys,
    emptyPskIndex,
    cs,
    undefined,
    undefined,
    config,
  );
  check(
    text.decode(state.groupContext.groupId) === id && state.groupContext.epoch === BigInt(epoch),
    "Welcome for unexpected group or epoch",
  );
  const self = getOwnLeafNode(state);
  check(
    agentId(self.credential, self.signaturePublicKey) === identity.agentId,
    "wrong Welcome recipient",
  );
  sameRoster(roster(state), members);
  // joinGroup verifies the GroupInfo signature but omits its signer in the returned state.
  // Open the same Welcome with the library to bind its signer to the approved admission.
  const initKey = await cs.hpke.importPrivateKey(privateKeys.initPrivateKey);
  const ref = await makeKeyPackageRef(kp, cs.hash);
  const secrets = await decryptGroupSecrets(initKey, ref, message.welcome, cs.hpke);
  check(secrets && secrets.psks.length === 0, "unexpected Welcome secrets");
  try {
    const info = await decryptGroupInfo(
      message.welcome,
      secrets.joinerSecret,
      new Uint8Array(cs.kdf.size),
      cs,
    );
    check(
      info &&
        memberAt(state, info.signer) === expectedSigner &&
        expectedSigner !== identity.agentId,
      "Welcome signer mismatch",
    );
  } finally {
    secrets.joinerSecret.fill(0);
    secrets.pathSecret?.fill(0);
  }
  return save(state);
}

export async function sendMls(snapshot: MlsState, plaintext: string) {
  check(
    plaintext.length > 0 && plaintext.length <= MAX_WIRE && plaintext.isWellFormed(),
    "invalid application text",
  );
  const state = stateOf(snapshot);
  const result = await createApplicationMessage(state, utf8.encode(plaintext), await cryptoSuite);
  return {
    state: save(result.newState),
    wire: wire({
      version: "mls10",
      wireformat: "mls_private_message",
      privateMessage: result.privateMessage,
    }),
  };
}

export async function receiveMlsApplication(
  snapshot: MlsState,
  input: string,
  expectedSender: string,
) {
  const state = stateOf(snapshot);
  const message = readWire(input);
  check(
    message.wireformat === "mls_private_message" &&
      message.privateMessage.contentType === "application",
    "expected private application message",
  );
  checkFrameContext(state, message.privateMessage, "");
  const cs = await cryptoSuite;
  // processMessage authenticates content against this epoch's leaf signing key, but omits sender
  // from its application result. Resolve the RFC SenderData for the same frame and epoch.
  const sender = await decryptSenderData(
    message.privateMessage,
    state.keySchedule.senderDataSecret,
    cs,
  );
  const result = await processMessage(message, state, emptyPskIndex, () => "reject", cs);
  check(sender && result.kind === "applicationMessage", "unverified application frame");
  const senderId = memberAt(state, sender.leafIndex);
  check(senderId === expectedSender, "application sender mismatch");
  return { state: save(result.newState), plaintext: text.decode(result.message), senderId };
}

export async function receiveMlsCommit(
  snapshot: MlsState,
  input: string,
  expectedSender: string,
  change: MlsChange,
  context = "",
  acceptedKeyPackage?: string,
) {
  check(
    change.kind === "add" ? !!acceptedKeyPackage : acceptedKeyPackage === undefined,
    "admission KeyPackage mismatch",
  );
  const state = stateOf(snapshot);
  const expected = membersAfter(state, change);
  const message = readWire(input);
  check(message.wireformat === "mls_public_message", "expected public membership Commit");
  const frame = message.publicMessage;
  check(
    frame.senderType === "member" &&
      frame.membershipTag.length === 32 &&
      frame.content.sender.senderType === "member" &&
      frame.content.contentType === "commit",
    "expected authenticated member Commit",
  );
  checkFrameContext(state, frame.content, context);
  // processMessage checks the epoch membership MAC and leaf-key signature before invoking policy.
  const result = await processMessage(
    message,
    state,
    emptyPskIndex,
    (incoming) => {
      if (
        incoming.kind !== "commit" ||
        incoming.senderLeafIndex === undefined ||
        memberAt(state, incoming.senderLeafIndex) !== expectedSender
      )
        return "reject";
      const proposals = incoming.proposals;
      const proposal = proposals[0]?.proposal;
      if (proposals.length !== 1 || !proposal) return "reject";
      if (change.kind === "remove")
        return proposal.proposalType === "remove" &&
          memberAt(state, proposal.remove.removed) === change.agentId
          ? "accept"
          : "reject";
      if (proposal.proposalType !== "add") return "reject";
      const leaf = proposal.add.keyPackage.leafNode;
      const proposed = wire(
        { version: "mls10", wireformat: "mls_key_package", keyPackage: proposal.add.keyPackage },
        MAX_PACKAGE,
      );
      return agentId(leaf.credential, leaf.signaturePublicKey) === change.agentId &&
        proposed === acceptedKeyPackage
        ? "accept"
        : "reject";
    },
    await cryptoSuite,
  );
  check(
    result.kind === "newState" && result.actionTaken === "accept",
    "unexpected commit or committer",
  );
  sameRoster(roster(result.newState), expected);
  if (result.newState.groupActiveState.kind === "removedFromGroup") return null;
  check(
    result.newState.groupContext.epoch === state.groupContext.epoch + 1n,
    "invalid epoch transition",
  );
  return save(result.newState);
}
