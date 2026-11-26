import { z } from "zod";
import { MAX_TEXT_LENGTH } from "../src/protocol.ts";
import { agentId } from "../src/validation.ts";

const uuid = z.string().uuid();
export const groupRef = z.string().refine((value) => {
  const [sender, id, extra] = value.split(":");
  return extra === undefined && agentId(sender) && uuid.safeParse(id).success;
}, "Expected a sender-qualified group message reference");
const common = {
  version: z.literal(1),
  groupId: uuid,
  id: uuid,
  senderId: z.string().refine(agentId),
  messageRef: groupRef,
  threadId: groupRef,
  text: z
    .string()
    .min(1)
    .max(MAX_TEXT_LENGTH)
    .refine((s) => s.isWellFormed()),
};

const ask = z.object({ ...common, kind: z.literal("ask"), replyTo: z.null() }).strict();
const reply = z.object({ ...common, kind: z.literal("reply"), replyTo: groupRef }).strict();
const message = z.discriminatedUnion("kind", [ask, reply]);
export type GroupPost = z.infer<typeof message>;

export function resolveGroupRef(history: GroupPost[], value: string): GroupPost {
  const matches = history.filter((post) => post.messageRef === value || post.id === value);
  if (matches.length !== 1)
    throw Error(
      "Reply target is absent or ambiguous in this group. Use the sender-qualified messageRef.",
    );
  return matches[0];
}

export function makeGroupPost(
  groupId: string,
  senderId: string,
  id: string,
  text: string,
  history: GroupPost[],
  replyTo?: string,
): GroupPost {
  const messageRef = senderId + ":" + id;
  const base = { version: 1, groupId, senderId, id, text, messageRef };
  if (!replyTo) return ask.parse({ ...base, kind: "ask", threadId: messageRef, replyTo: null });
  const parent = resolveGroupRef(
    history.filter((post) => post.groupId === groupId),
    replyTo,
  );
  return reply.parse({
    ...base,
    kind: "reply",
    threadId: parent.threadId,
    replyTo: parent.messageRef,
  });
}

export function readGroupPost(
  plaintext: string,
  groupId: string,
  senderId: string,
  id: string,
  history: GroupPost[],
): GroupPost | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return undefined;
  }
  const result = message.safeParse(parsed);
  if (!result.success) return undefined;
  const post = result.data;
  const ref = senderId + ":" + id;
  if (
    post.groupId !== groupId ||
    post.senderId !== senderId ||
    post.id !== id ||
    post.messageRef !== ref ||
    history.some((row) => row.messageRef === ref)
  )
    return undefined;
  if (post.kind === "ask") return post.threadId === ref ? post : undefined;
  // A later joiner can receive a reply to a pre-admission message. Hide the
  // unresolvable reference but still advance its authenticated MLS ratchet.
  const parent = history.find((row) => row.messageRef === post.replyTo && row.groupId === groupId);
  return parent && parent.threadId === post.threadId ? post : undefined;
}
