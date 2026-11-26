import { expect, it } from "vite-plus/test";
import {
  createLocalIdentity,
  openDirect,
  openEnvelope,
  sealDirect,
  sealEnvelope,
} from "../src/crypto.ts";
import { asEnvelope } from "../src/validation.ts";

it("authenticates the typed format and keeps the conversation and parent reference inside HPKE", async () => {
  const a = await createLocalIdentity(),
    b = await createLocalIdentity();
  const id = crypto.randomUUID(),
    threadId = a.agentId + "." + id;
  const text = "\uFEFF" + "\u0000".repeat(11_998) + "\n";
  const ask = { type: "ask" as const, threadId, replyTo: null, text };
  const env = await sealDirect(a, b, id, ask);
  expect(asEnvelope(env)).toEqual(env);
  expect(JSON.stringify(env)).not.toContain(threadId);
  await expect(openDirect(b, a, env)).resolves.toEqual(ask);
  await expect(openEnvelope(b, a, { ...env, version: 1 })).rejects.toThrow();

  const reply = { type: "reply" as const, threadId, replyTo: id, text: "Ready." };
  const answer = await sealDirect(b, a, crypto.randomUUID(), reply);
  expect(JSON.stringify(answer)).not.toContain(id);
  await expect(openDirect(a, b, answer)).resolves.toEqual(reply);
});

it("preserves legacy text resembling a structured message", async () => {
  const a = await createLocalIdentity(),
    b = await createLocalIdentity();
  const text = '{"type":"reply","threadId":"legacy","replyTo":"unknown"}\n/commands';
  const legacy = await sealEnvelope(a, b, crypto.randomUUID(), text);
  await expect(openEnvelope(b, a, legacy)).resolves.toBe(text);
  await expect(openDirect(b, a, { ...legacy, version: 2 })).rejects.toThrow();
});
