import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLocalIdentity } from "../../src/crypto.ts";
import { base64url, fromBase64url } from "../../src/protocol.ts";
import {
  commitMls,
  createMlsGroup,
  inspectMls,
  joinMlsGroup,
  prepareMlsJoin,
  receiveMlsApplication,
  receiveMlsCommit,
  sendMls,
} from "../../adapter/mls.ts";
import { decodeGroupState } from "ts-mls/clientState.js";
import { decodeMlsMessage, encodeMlsMessage } from "ts-mls/message.js";
import { getCiphersuiteFromName } from "ts-mls/crypto/ciphersuite.js";
import { getCiphersuiteImpl } from "ts-mls/crypto/getCiphersuiteImpl.js";
import { decryptSenderData } from "ts-mls/privateMessage.js";

const add = (id) => ({ kind: "add", agentId: id });
const remove = (id) => ({ kind: "remove", agentId: id });

// Independently pass ciphertext to the dependency, bypassing our roster, routing and epoch guards.
async function assertEpochKeysCannotOpen(snapshot, ciphertext) {
  const [group] = decodeGroupState(fromBase64url(snapshot), 0);
  const [{ privateMessage }] = decodeMlsMessage(fromBase64url(ciphertext), 0);
  const suite = await getCiphersuiteImpl(getCiphersuiteFromName(group.groupContext.cipherSuite));
  await assert.rejects(
    decryptSenderData(privateMessage, group.keySchedule.senderDataSecret, suite),
  );
}

test("MLS admission, restore, sender authentication and cryptographic revocation", async () => {
  const [alice, bob, charlie] = await Promise.all(Array.from({ length: 3 }, createLocalIdentity));
  const group = randomUUID();
  const initial = await createMlsGroup(alice, group);
  const bobKeys = await prepareMlsJoin(bob);
  const firstAdd = await commitMls(initial, add(bob.agentId), bobKeys.keyPackage, "admit Bob");
  assert.deepEqual(inspectMls(initial), { groupId: group, members: [alice.agentId], epoch: 0 });
  let A = firstAdd.state;
  let B = await joinMlsGroup(
    bob,
    bobKeys,
    firstAdd.welcome,
    group,
    1,
    [alice.agentId, bob.agentId],
    alice.agentId,
  );
  await assert.rejects(
    joinMlsGroup(
      bob,
      bobKeys,
      firstAdd.welcome,
      randomUUID(),
      1,
      [alice.agentId, bob.agentId],
      alice.agentId,
    ),
  );
  await assert.rejects(
    joinMlsGroup(
      bob,
      bobKeys,
      firstAdd.welcome,
      group,
      1,
      [bob.agentId, charlie.agentId],
      alice.agentId,
    ),
  );
  await assert.rejects(
    joinMlsGroup(
      bob,
      bobKeys,
      firstAdd.welcome,
      group,
      1,
      [alice.agentId, bob.agentId],
      bob.agentId,
    ),
    /Welcome signer mismatch/,
  );
  const before = await sendMls(A, "confidential before admission");
  A = before.state;
  const old = await receiveMlsApplication(B, before.wire, alice.agentId);
  B = old.state;
  assert.equal(old.plaintext, "confidential before admission");
  const charlieKeys = await prepareMlsJoin(charlie);
  const second = await commitMls(A, add(charlie.agentId), charlieKeys.keyPackage, "admit Charlie");
  await assert.rejects(
    receiveMlsCommit(
      B,
      second.commit,
      alice.agentId,
      add(charlie.agentId),
      "wrong context",
      charlieKeys.keyPackage,
    ),
  );
  await assert.rejects(
    receiveMlsCommit(
      B,
      second.commit,
      bob.agentId,
      add(charlie.agentId),
      "admit Charlie",
      charlieKeys.keyPackage,
    ),
  );
  await assert.rejects(
    receiveMlsCommit(
      B,
      second.commit,
      alice.agentId,
      add(charlie.agentId),
      "admit Charlie",
      (await prepareMlsJoin(charlie)).keyPackage,
    ),
  );
  // The second receiver resumes from serialized disk bytes, then applies the ordered add before text.
  const restoredB = JSON.parse(JSON.stringify(B));
  B = await receiveMlsCommit(
    restoredB,
    second.commit,
    alice.agentId,
    add(charlie.agentId),
    "admit Charlie",
    charlieKeys.keyPackage,
  );
  let C = await joinMlsGroup(
    charlie,
    charlieKeys,
    second.welcome,
    group,
    2,
    [alice.agentId, bob.agentId, charlie.agentId],
    alice.agentId,
  );
  await assertEpochKeysCannotOpen(C, before.wire);
  A = second.state;
  const sent = await sendMls(A, "\uFEFFExact UTF-8 text 🐈");
  A = sent.state;
  await assert.rejects(
    receiveMlsApplication(B, sent.wire.charAt(0) + sent.wire.slice(1) + "A", alice.agentId),
  );
  await assert.rejects(receiveMlsApplication(B, sent.wire, charlie.agentId), /sender mismatch/);
  const received = await receiveMlsApplication(B, sent.wire, alice.agentId);
  B = received.state;
  assert.equal(received.plaintext, "\uFEFFExact UTF-8 text 🐈");
  assert.equal(received.senderId, alice.agentId);
  await assert.rejects(receiveMlsApplication(B, sent.wire, alice.agentId));
  C = (await receiveMlsApplication(C, sent.wire, alice.agentId)).state;
  const removal = await commitMls(A, remove(bob.agentId), undefined, "remove Bob");
  assert.equal(
    await receiveMlsCommit(B, removal.commit, alice.agentId, remove(bob.agentId), "remove Bob"),
    null,
  );
  C = await receiveMlsCommit(C, removal.commit, alice.agentId, remove(bob.agentId), "remove Bob");
  const later = await sendMls(removal.state, "after removal");
  assert.equal(
    (await receiveMlsApplication(C, later.wire, alice.agentId)).plaintext,
    "after removal",
  );
  await assert.rejects(receiveMlsApplication(B, later.wire, alice.agentId));
  await assertEpochKeysCannotOpen(B, later.wire);
});

test("competing commits are independent candidates bound to distinct epoch secrets", async () => {
  const [a, b, c, d] = await Promise.all(Array.from({ length: 4 }, createLocalIdentity));
  const group = randomUUID();
  const initial = await createMlsGroup(a, group);
  const kb = await prepareMlsJoin(b),
    kc = await prepareMlsJoin(c),
    kd = await prepareMlsJoin(d);
  const ab = await commitMls(initial, add(b.agentId), kb.keyPackage);
  const B = await joinMlsGroup(b, kb, ab.welcome, group, 1, [a.agentId, b.agentId], a.agentId);
  const [win, lose] = await Promise.all([
    commitMls(ab.state, add(c.agentId), kc.keyPackage),
    commitMls(ab.state, add(d.agentId), kd.keyPackage),
  ]);
  // A delivery rejection leaves the base epoch intact. Public MLS member Commits use
  // the epoch membership MAC and sender signature, never the private handshake ratchet.
  for (const candidate of [win, lose]) {
    const [m] = decodeMlsMessage(fromBase64url(candidate.commit), 0);
    assert.equal(m.wireformat, "mls_public_message");
    assert.equal(m.publicMessage.senderType, "member");
    assert.equal(m.publicMessage.membershipTag.byteLength, 32);
    assert.equal(m.publicMessage.content.epoch, 1n);
    assert.equal(m.publicMessage.auth.signature.byteLength, 64);
    assert.equal(m.publicMessage.content.contentType, "commit");
  }
  const [badTag] = decodeMlsMessage(fromBase64url(win.commit), 0);
  badTag.publicMessage.membershipTag[0] ^= 1;
  await assert.rejects(
    receiveMlsCommit(
      B,
      base64url(encodeMlsMessage(badTag)),
      a.agentId,
      add(c.agentId),
      "",
      kc.keyPackage,
    ),
    /verify membership/i,
  );
  const [badSig] = decodeMlsMessage(fromBase64url(win.commit), 0);
  badSig.publicMessage.auth.signature[0] ^= 1;
  await assert.rejects(
    receiveMlsCommit(
      B,
      base64url(encodeMlsMessage(badSig)),
      a.agentId,
      add(c.agentId),
      "",
      kc.keyPackage,
    ),
  );
  const restoredBase = JSON.parse(JSON.stringify(ab.state));
  const fresh = await commitMls(
    restoredBase,
    add(c.agentId),
    kc.keyPackage,
    "fresh after rejection",
  );
  const acceptedFresh = await receiveMlsCommit(
    B,
    fresh.commit,
    a.agentId,
    add(c.agentId),
    "fresh after rejection",
    kc.keyPackage,
  );
  assert.equal(inspectMls(acceptedFresh).epoch, 2);
  assert.equal(inspectMls(restoredBase).epoch, 1);
  const privateApp = await sendMls(fresh.state, "private after fresh commit");
  const [application] = decodeMlsMessage(fromBase64url(privateApp.wire), 0);
  assert.equal(application.wireformat, "mls_private_message");
  assert.equal(
    (await receiveMlsApplication(acceptedFresh, privateApp.wire, a.agentId)).plaintext,
    "private after fresh commit",
  );
  const accepted = await receiveMlsCommit(
    B,
    win.commit,
    a.agentId,
    add(c.agentId),
    "",
    kc.keyPackage,
  );
  await assert.rejects(
    receiveMlsCommit(accepted, lose.commit, a.agentId, add(d.agentId), "", kd.keyPackage),
    /epoch/,
  );
  const lostWelcome = await joinMlsGroup(
    d,
    kd,
    lose.welcome,
    group,
    2,
    [a.agentId, b.agentId, d.agentId],
    a.agentId,
  );
  const msg = await sendMls(win.state, "winner only");
  assert.equal(
    (await receiveMlsApplication(accepted, msg.wire, a.agentId)).plaintext,
    "winner only",
  );
  await assertEpochKeysCannotOpen(lostWelcome, msg.wire);
  const raw = fromBase64url(win.commit);
  const trailing = new Uint8Array(raw.length + 1);
  trailing.set(raw);
  await assert.rejects(
    receiveMlsCommit(B, base64url(trailing), a.agentId, add(c.agentId), "", kc.keyPackage),
    /trailing/,
  );
});

test("Basic Credentials, signed KeyPackages and group IDs must match the approved identities", async () => {
  const alice = await createLocalIdentity(),
    bob = await createLocalIdentity();
  const A = await createMlsGroup(alice, randomUUID()),
    keys = await prepareMlsJoin(bob);
  await assert.rejects(prepareMlsJoin({ ...bob, agentId: alice.agentId }), /credential/);
  await assert.rejects(
    commitMls(A, add(bob.agentId), (await prepareMlsJoin(alice)).keyPackage),
    /identity/,
  );
  const tampered = fromBase64url(keys.keyPackage);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(commitMls(A, add(bob.agentId), base64url(tampered)), /signature/);
  await assert.rejects(createMlsGroup(alice, "display name"));
});
