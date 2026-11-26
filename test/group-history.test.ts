import { expect, test } from "vitest";
import { makeGroupPost, readGroupPost } from "../adapter/group-history.ts";
import { base64url } from "../src/protocol.ts";

test("threads distinguish two members whose message IDs coincide", () => {
  const group = crypto.randomUUID();
  const otherGroup = crypto.randomUUID();
  const id = crypto.randomUUID();
  const a = "at1_" + base64url(new Uint8Array(32).fill(1));
  const b = "at1_" + base64url(new Uint8Array(32).fill(2));
  const first = makeGroupPost(group, a, id, "First", []);
  const second = makeGroupPost(group, b, id, "Second", [first]);
  expect(readGroupPost(JSON.stringify(second), group, b, id, [first])).toEqual(second);
  expect(readGroupPost(JSON.stringify(second), group, b, id, [first, second])).toBeUndefined();
  expect(() => makeGroupPost(group, b, crypto.randomUUID(), "Ambiguous", [first, second], id)).toThrow(
    /ambiguous/,
  );
  const reply = makeGroupPost(group, b, crypto.randomUUID(), "Answer", [first, second], first.messageRef);
  expect(reply.threadId).toBe(first.threadId);
  expect(reply.threadId).not.toBe(second.threadId);
  expect(readGroupPost(JSON.stringify(reply), group, b, reply.id, [first, second])).toEqual(reply);
  expect(() =>
    makeGroupPost(otherGroup, b, crypto.randomUUID(), "Wrong group", [first], first.messageRef),
  ).toThrow();
});
