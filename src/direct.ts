import { MAX_TEXT_LENGTH, stableJson, type CipherEnvelope } from "./protocol.ts";
import { fields } from "./validation.ts";

export const TYPED_DIRECT = "typed-direct-v1";
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export type DirectHeader =
  | { type: "ask"; threadId: string; replyTo: null }
  | { type: "reply"; threadId: string; replyTo: string };
export type DirectLetter = DirectHeader & { text: string };
type Route = Pick<CipherEnvelope, "senderId" | "recipientId" | "id">;

export function validText(text: unknown): text is string {
  return (
    typeof text === "string" &&
    text.length > 0 &&
    text.length <= MAX_TEXT_LENGTH &&
    text.isWellFormed()
  );
}

function validReference(meta: Record<string, unknown>, route: Route): boolean {
  if (!uuidPattern.test(route.id) || typeof meta.threadId !== "string") return false;
  const [creator, rootId, extra] = meta.threadId.split(".");
  if (
    extra !== undefined ||
    (creator !== route.senderId && creator !== route.recipientId) ||
    !uuidPattern.test(rootId ?? "")
  )
    return false;
  if (meta.type === "ask")
    return creator === route.senderId && rootId === route.id && meta.replyTo === null;
  return (
    meta.type === "reply" &&
    typeof meta.replyTo === "string" &&
    uuidPattern.test(meta.replyTo) &&
    meta.replyTo !== route.id
  );
}

export function encodeLetter(letter: DirectLetter, route: Route): Uint8Array {
  const { text, ...header } = letter;
  if (!validText(text) || !validReference(header, route))
    throw new Error("Invalid direct message.");
  const metadata = { ...header, participants: [route.senderId, route.recipientId].sort() };
  // The first line is bounded JSON metadata. Keeping text as UTF-8 preserves
  // the full v1 text limit even when it consists entirely of control characters.
  return new TextEncoder().encode(stableJson(metadata) + "\n" + text);
}

export function decodeLetter(bytes: ArrayBuffer, route: Route): DirectLetter {
  const raw = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const split = raw.indexOf("\n");
  if (split < 1 || split > 512) throw new Error("Invalid direct message header.");
  const meta: unknown = JSON.parse(raw.slice(0, split));
  const text = raw.slice(split + 1);
  const participants = [route.senderId, route.recipientId].sort();
  if (
    !fields(meta, ["type", "threadId", "replyTo", "participants"]) ||
    !validReference(meta, route) ||
    !Array.isArray(meta.participants) ||
    meta.participants.length !== 2 ||
    meta.participants[0] !== participants[0] ||
    meta.participants[1] !== participants[1] ||
    !validText(text)
  )
    throw new Error("Invalid direct message.");
  return { type: meta.type, threadId: meta.threadId, replyTo: meta.replyTo, text } as DirectLetter;
}
