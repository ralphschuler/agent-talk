import { verifyRequest } from "./auth.ts";
import { DurableObject } from "cloudflare:workers";
import { agentIdFromSigningKey, inviteMessage, stableJson, type AgentIdentity, type CipherEnvelope, type Invite } from "./protocol.ts";
import * as ed from "@noble/ed25519";
import { fromBase64url } from "./protocol.ts";

export interface Env {
  DIRECTORY: DurableObjectNamespace<Directory>;
  MAILBOX: DurableObjectNamespace<Mailbox>;
}

type IdentityRecord = AgentIdentity & { registeredAt: number };
type Authenticated = { agentId: string; timestamp: string };
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_ENVELOPE_BYTES = 64 * 1024;

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asIdentity(value: unknown): AgentIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AgentIdentity>;
  if (!candidate.agentId || !candidate.signingPublicKey || !candidate.encryptionPublicKey) return null;
  try {
    if (agentIdFromSigningKey(candidate.signingPublicKey) !== candidate.agentId) return null;
    return { agentId: candidate.agentId, signingPublicKey: candidate.signingPublicKey, encryptionPublicKey: candidate.encryptionPublicKey };
  } catch {
    return null;
  }
}

function asEnvelope(value: unknown): CipherEnvelope | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Partial<CipherEnvelope>;
  if (
    envelope.version !== 1 || !text(envelope.id) || !text(envelope.senderId) || !text(envelope.recipientId) ||
    !Number.isSafeInteger(envelope.createdAt) || !text(envelope.enc) || !text(envelope.ciphertext)
  ) return null;
  const parsed = envelope as CipherEnvelope;
  if (parsed.id.length > 128 || parsed.ciphertext.length > MAX_ENVELOPE_BYTES || parsed.enc.length > 512) return null;
  return parsed;
}

async function requestJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return null; }
}

async function directoryFetch(env: Env, path: string, body: unknown): Promise<Response> {
  return env.DIRECTORY.getByName("directory").fetch(`https://directory${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

async function lookupIdentity(env: Env, agentId: string): Promise<IdentityRecord | null> {
  const response = await directoryFetch(env, "/identity", { agentId });
  if (!response.ok) return null;
  return (await response.json()) as IdentityRecord;
}

async function authenticate(request: Request, env: Env, action: string, payload: unknown): Promise<Authenticated | Response> {
  const agentId = request.headers.get("x-agent-id") ?? "";
  const timestamp = request.headers.get("x-agent-timestamp") ?? "";
  const signature = request.headers.get("x-agent-signature") ?? "";
  const at = Number(timestamp);
  if (!agentId || !signature || !Number.isSafeInteger(at) || Math.abs(Date.now() - at) > MAX_CLOCK_SKEW_MS) return fail("invalid authentication metadata", 401);
  const identity = await lookupIdentity(env, agentId);
  if (!identity || !(await verifyRequest(identity.signingPublicKey, action, agentId, timestamp, payload, signature))) return fail("authentication failed", 401);
  return { agentId, timestamp };
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") return json({ ok: true, protocol: 1 });
    // The public landing page is an asset and is served before this Worker.

    if (request.method === "POST" && url.pathname === "/v1/register") {
      const payload = await requestJson(request);
      const identity = asIdentity((payload as { identity?: unknown } | null)?.identity);
      const timestamp = request.headers.get("x-agent-timestamp") ?? "";
      const signature = request.headers.get("x-agent-signature") ?? "";
      const headerAgentId = request.headers.get("x-agent-id") ?? "";
      const at = Number(timestamp);
      if (!identity || identity.agentId !== headerAgentId || !signature || !Number.isSafeInteger(at) || Math.abs(Date.now() - at) > MAX_CLOCK_SKEW_MS) return fail("invalid registration", 401);
      if (!(await verifyRequest(identity.signingPublicKey, "register", identity.agentId, timestamp, payload, signature))) return fail("registration signature invalid", 401);
      return directoryFetch(env, "/register", { identity });
    }

    if (request.method === "GET" && url.pathname === "/v1/socket") {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return fail("WebSocket Upgrade required", 426);
      const payload = {};
      const auth = await authenticate(request, env, "socket", payload);
      if (auth instanceof Response) return auth;
      return env.MAILBOX.getByName(auth.agentId).fetch("https://mailbox/socket", {
        headers: { "Upgrade": "websocket", "x-agent-id": auth.agentId },
      });
    }

    if (request.method !== "POST") return fail("not found", 404);
    const payload = await requestJson(request);
    if (!payload || typeof payload !== "object") return fail("JSON object required");

    if (url.pathname === "/v1/contact/approve") {
      const auth = await authenticate(request, env, "contact/approve", payload);
      if (auth instanceof Response) return auth;
      return directoryFetch(env, "/approve", { actorId: auth.agentId, ...(payload as object) });
    }
    if (url.pathname === "/v1/contact/block") {
      const auth = await authenticate(request, env, "contact/block", payload);
      if (auth instanceof Response) return auth;
      const peerId = text((payload as { peerId?: unknown }).peerId);
      if (!peerId) return fail("peerId required");
      const response = await directoryFetch(env, "/block", { actorId: auth.agentId, peerId });
      if (response.ok) await env.MAILBOX.getByName(auth.agentId).fetch("https://mailbox/purge-sender", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senderId: peerId }),
      });
      return response;
    }
    if (url.pathname === "/v1/send") {
      const auth = await authenticate(request, env, "send", payload);
      if (auth instanceof Response) return auth;
      const envelope = asEnvelope((payload as { envelope?: unknown }).envelope);
      if (!envelope || envelope.senderId !== auth.agentId) return fail("invalid envelope", 400);
      const permission = await directoryFetch(env, "/can-deliver", { senderId: envelope.senderId, recipientId: envelope.recipientId });
      if (!permission.ok) return fail("delivery is not permitted", 403);
      return env.MAILBOX.getByName(envelope.recipientId).fetch("https://mailbox/enqueue", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ envelope }),
      });
    }
    return fail("not found", 404);
  },
} satisfies ExportedHandler<Env>;

export class Directory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS identities (agent_id TEXT PRIMARY KEY, signing_key TEXT NOT NULL, encryption_key TEXT NOT NULL, registered_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (owner_id TEXT NOT NULL, peer_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id, peer_id));
      CREATE TABLE IF NOT EXISTS blocks (owner_id TEXT NOT NULL, peer_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id, peer_id));
      CREATE TABLE IF NOT EXISTS consumed_invites (issuer_id TEXT NOT NULL, invite_id TEXT NOT NULL, consumed_by TEXT NOT NULL, PRIMARY KEY(issuer_id, invite_id));
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = await requestJson(request) as Record<string, unknown> | null;
    if (!body) return fail("JSON object required");
    const sql = this.ctx.storage.sql as any;
    const first = (query: string, ...parameters: unknown[]): Record<string, unknown> | null => sql.exec(query, ...parameters).toArray()[0] ?? null;
    if (path === "/identity") {
      const agentId = text(body.agentId);
      const row = first("SELECT agent_id, signing_key, encryption_key, registered_at FROM identities WHERE agent_id = ?", agentId);
      if (!row) return fail("unknown identity", 404);
      return json({ agentId: row.agent_id, signingPublicKey: row.signing_key, encryptionPublicKey: row.encryption_key, registeredAt: row.registered_at });
    }
    if (path === "/register") {
      const identity = asIdentity(body.identity);
      if (!identity) return fail("invalid identity");
      const existing = first("SELECT signing_key, encryption_key FROM identities WHERE agent_id = ?", identity.agentId);
      if (existing && (existing.signing_key !== identity.signingPublicKey || existing.encryption_key !== identity.encryptionPublicKey)) return fail("identity key rotation requires a new agent id", 409);
      sql.exec("INSERT OR IGNORE INTO identities (agent_id, signing_key, encryption_key, registered_at) VALUES (?, ?, ?, ?)", identity.agentId, identity.signingPublicKey, identity.encryptionPublicKey, Date.now());
      return json({ ok: true, agentId: identity.agentId }, existing ? 200 : 201);
    }
    if (path === "/approve") {
      const actorId = text(body.actorId);
      const invite = body.invite as Invite | undefined;
      if (!actorId || !invite || !invite.issuer) return fail("invite required");
      const peer = asIdentity(invite.issuer);
      if (!peer || invite.kind !== "agent-talk-invite" || invite.version !== 1 || invite.expiresAt <= Date.now() || !text(invite.inviteId) || !text(invite.signature)) return fail("invalid invite");
      const unsigned = { ...invite } as Record<string, unknown>;
      delete unsigned.signature;
      const signatureValid = await ed.verifyAsync(fromBase64url(invite.signature), inviteMessage(unsigned as Omit<Invite, "signature">), fromBase64url(peer.signingPublicKey), { zip215: false });
      if (!signatureValid) return fail("invite signature invalid", 403);
      const knownPeer = first("SELECT signing_key, encryption_key FROM identities WHERE agent_id = ?", peer.agentId);
      if (!knownPeer || knownPeer.signing_key !== peer.signingPublicKey || knownPeer.encryption_key !== peer.encryptionPublicKey) return fail("invite identity has not registered", 409);
      const consumed = first("SELECT invite_id FROM consumed_invites WHERE issuer_id = ? AND invite_id = ?", peer.agentId, invite.inviteId);
      if (consumed) return fail("invite already used", 409);
      sql.exec("INSERT INTO consumed_invites (issuer_id, invite_id, consumed_by) VALUES (?, ?, ?)", peer.agentId, invite.inviteId, actorId);
      sql.exec("INSERT OR IGNORE INTO approvals (owner_id, peer_id, created_at) VALUES (?, ?, ?)", actorId, peer.agentId, Date.now());
      return json({ ok: true, pendingMutualApproval: true });
    }
    if (path === "/block") {
      const actorId = text(body.actorId); const peerId = text(body.peerId);
      if (!actorId || !peerId) return fail("actorId and peerId required");
      sql.exec("INSERT OR REPLACE INTO blocks (owner_id, peer_id, created_at) VALUES (?, ?, ?)", actorId, peerId, Date.now());
      return json({ ok: true });
    }
    if (path === "/can-deliver") {
      const senderId = text(body.senderId); const recipientId = text(body.recipientId);
      if (!senderId || !recipientId || senderId === recipientId) return fail("invalid route", 403);
      const senderApproval = first("SELECT 1 FROM approvals WHERE owner_id = ? AND peer_id = ?", senderId, recipientId);
      const recipientApproval = first("SELECT 1 FROM approvals WHERE owner_id = ? AND peer_id = ?", recipientId, senderId);
      const blocked = first("SELECT 1 FROM blocks WHERE (owner_id = ? AND peer_id = ?) OR (owner_id = ? AND peer_id = ?) LIMIT 1", senderId, recipientId, recipientId, senderId);
      return senderApproval && recipientApproval && !blocked ? json({ ok: true }) : fail("unconfirmed or blocked", 403);
    }
    return fail("not found", 404);
  }
}

export class Mailbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, envelope TEXT NOT NULL, created_at INTEGER NOT NULL)");
  }

  private pending(): CipherEnvelope[] {
    const rows = (this.ctx.storage.sql as any).exec("SELECT envelope FROM messages ORDER BY created_at ASC, id ASC").toArray() as Array<{ envelope: string }>;
    return rows.map((row) => JSON.parse(row.envelope) as CipherEnvelope);
  }

  private push(envelope: CipherEnvelope): void {
    for (const socket of this.ctx.getWebSockets()) socket.send(JSON.stringify({ type: "message", envelope }));
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/socket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    const body = await requestJson(request) as Record<string, unknown> | null;
    if (!body) return fail("JSON object required");
    const sql = this.ctx.storage.sql as any;
    if (path === "/enqueue") {
      const envelope = asEnvelope(body.envelope);
      if (!envelope) return fail("invalid envelope");
      const existing = sql.exec("SELECT id FROM messages WHERE id = ?", envelope.id).toArray()[0] ?? null;
      if (!existing) {
        sql.exec("INSERT INTO messages (id, sender_id, envelope, created_at) VALUES (?, ?, ?, ?)", envelope.id, envelope.senderId, JSON.stringify(envelope), envelope.createdAt);
        this.push(envelope);
      }
      return json({ ok: true, duplicate: Boolean(existing) }, existing ? 200 : 201);
    }
    if (path === "/ack") {
      const id = text(body.id); if (!id) return fail("message id required");
      sql.exec("DELETE FROM messages WHERE id = ?", id);
      return json({ ok: true });
    }
    if (path === "/purge-sender") {
      const senderId = text(body.senderId); if (!senderId) return fail("sender id required");
      sql.exec("DELETE FROM messages WHERE sender_id = ?", senderId);
      return json({ ok: true });
    }
    return fail("not found", 404);
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    try {
      const event = JSON.parse(message) as { type?: string; id?: string };
      if (event.type === "resume") for (const envelope of this.pending()) socket.send(JSON.stringify({ type: "message", envelope }));
      if (event.type === "ack" && event.id) (this.ctx.storage.sql as any).exec("DELETE FROM messages WHERE id = ?", event.id);
    } catch { socket.close(1008, "invalid message"); }
  }

  webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }
}
