import { DurableObject } from "cloudflare:workers";
import { authMessage, fromBase64url, inviteMessage, type CipherEnvelope } from "./protocol.ts";
import { agentId, asEnvelope, asIdentity, asInvite, canonicalBytes, CLOCK_SKEW, DAY, fields, identifier, readJson, record } from "./validation.ts";

export interface Env {
  DIRECTORY: DurableObjectNamespace<Directory>;
  MAILBOX: DurableObjectNamespace<Mailbox>;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function post(stub: DurableObjectStub, path: string, data: unknown): Promise<Response> {
  return stub.fetch("https://internal" + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
  });
}

async function signed(publicKey: string, signature: string, message: Uint8Array): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", fromBase64url(publicKey), "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, fromBase64url(signature), message);
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/healthz" && request.method === "GET") return json({ ok: true, protocol: 1 });
    const action = url.pathname.slice("/v1/".length);
    if (!url.pathname.startsWith("/v1/") || !["register", "socket", "contact/approve", "contact/block", "send"].includes(action)) return fail("not found", 404);
    const socket = action === "socket";
    if (request.method !== (socket ? "GET" : "POST")) return fail("method not allowed", 405);
    if (socket && request.headers.get("upgrade")?.toLowerCase() !== "websocket") return fail("WebSocket Upgrade required", 426);
    const actor = request.headers.get("x-agent-id");
    const timestamp = request.headers.get("x-agent-timestamp") ?? "";
    const signature = request.headers.get("x-agent-signature") ?? "";
    if (!agentId(actor) || !/^\d{13}$/u.test(timestamp) || Math.abs(Number(timestamp) - Date.now()) > CLOCK_SKEW
        || !canonicalBytes(signature, 64)) return fail("invalid authentication metadata", 401);
    const payload = socket ? {} : await readJson(request);
    if (!record(payload)) return fail("invalid or oversized JSON");
    // Validate the exact wire shape before signing or forwarding any user-controlled data.
    if (action === "register" && (!fields(payload, ["identity"]) || asIdentity(payload.identity)?.agentId !== actor)) return fail("invalid identity");
    if (action === "contact/approve" && (!fields(payload, ["invite"]) || !asInvite(payload.invite, url.origin))) return fail("invalid invite");
    if (action === "contact/block" && (!fields(payload, ["peerId"]) || !agentId(payload.peerId) || payload.peerId === actor)) return fail("invalid peer");
    if (action === "send" && (!fields(payload, ["envelope"]) || asEnvelope(payload.envelope)?.senderId !== actor)) return fail("invalid envelope");
    if (!await signed(actor.slice(4), signature, authMessage(action, actor, timestamp, payload))) return fail("authentication failed", 401);
    const directory = env.DIRECTORY.getByName("directory");
    if (action === "register") return post(directory, "/register", { identity: payload.identity });
    const auth = await post(directory, "/admit", { actor, signature, expires: Number(timestamp) + CLOCK_SKEW });
    if (!auth.ok) return auth;
    if (socket) return env.MAILBOX.getByName(actor).fetch("https://internal/socket", { headers: { Upgrade: "websocket" } });
    if (action === "contact/approve") return post(directory, "/approve", { actor, invite: payload.invite, origin: url.origin });
    if (action === "contact/block") {
      const peer = payload.peerId as string;
      const blocked = await post(directory, "/block", { actor, peer });
      if (!blocked.ok) return blocked;
      // Bar both directions at the queue itself so a concurrent send with an older
      // authorization cannot enqueue after the block has been acknowledged.
      const results = await Promise.all([
        post(env.MAILBOX.getByName(actor), "/bar", { sender: peer }),
        post(env.MAILBOX.getByName(peer), "/bar", { sender: actor }),
      ]);
      return results.find(response => !response.ok) ?? json({ ok: true });
    }
    const envelope = payload.envelope as CipherEnvelope;
    const permitted = await post(directory, "/permit", { actor, peer: envelope.recipientId });
    if (!permitted.ok) return permitted;
    return post(env.MAILBOX.getByName(envelope.recipientId), "/enqueue", { envelope });
  },
} satisfies ExportedHandler<Env>;

export class Directory extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS identities (agent_id TEXT PRIMARY KEY, signing_key TEXT NOT NULL, encryption_key TEXT NOT NULL, registered_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (owner_id TEXT NOT NULL, peer_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id, peer_id));
      CREATE TABLE IF NOT EXISTS blocks (owner_id TEXT NOT NULL, peer_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id, peer_id));
      CREATE TABLE IF NOT EXISTS consumed_invites (issuer_id TEXT NOT NULL, invite_id TEXT NOT NULL, consumed_by TEXT NOT NULL, PRIMARY KEY(issuer_id, invite_id));
      CREATE TABLE IF NOT EXISTS admissions (signature TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS admissions_expiry ON admissions(expires);
    `);
    if (!this.sql.exec("PRAGMA table_info(consumed_invites)").toArray().some(row => row.name === "expires")) {
      this.sql.exec("ALTER TABLE consumed_invites ADD COLUMN expires INTEGER");
      this.sql.exec("UPDATE consumed_invites SET expires = ?", Date.now() + DAY + CLOCK_SKEW);
    }
    this.sql.exec("CREATE INDEX IF NOT EXISTS invite_expiry ON consumed_invites(expires)");
  }

  private blocked(actor: string, peer: string): boolean {
    return this.sql.exec("SELECT 1 FROM blocks WHERE (owner_id = ? AND peer_id = ?) OR (owner_id = ? AND peer_id = ?) LIMIT 1",
      actor, peer, peer, actor).toArray().length > 0;
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = await readJson(request);
    if (!record(body)) return fail("invalid input");
    if (path === "/register") {
      const identity = asIdentity(body.identity);
      if (!identity) return fail("invalid identity");
      const [existing] = this.sql.exec("SELECT encryption_key FROM identities WHERE agent_id = ?", identity.agentId);
      if (existing) return existing.encryption_key === identity.encryptionPublicKey ? json({ ok: true, agentId: identity.agentId }) : fail("key mismatch", 409);
      if (Number(this.sql.exec("SELECT COUNT(*) AS n FROM identities").one().n) >= 512) return fail("pilot capacity reached", 429);
      this.sql.exec("INSERT INTO identities VALUES (?, ?, ?, ?)", identity.agentId, identity.signingPublicKey, identity.encryptionPublicKey, Date.now());
      return json({ ok: true, agentId: identity.agentId }, 201);
    }
    const actor = body.actor;
    if (!agentId(actor)) return fail("invalid actor");
    if (path === "/admit") {
      const now = Date.now();
      if (!this.sql.exec("SELECT 1 FROM identities WHERE agent_id = ?", actor).toArray().length) return fail("authentication failed", 401);
      this.sql.exec("DELETE FROM admissions WHERE expires < ?", now);
      if (typeof body.signature !== "string" || typeof body.expires !== "number" || body.expires < now) return fail("expired", 401);
      if (this.sql.exec("SELECT 1 FROM admissions WHERE signature = ?", body.signature).toArray().length) return fail("request already used", 409);
      if (Number(this.sql.exec("SELECT COUNT(*) AS n FROM admissions").one().n) >= 8192) return fail("pilot request limit", 429);
      this.sql.exec("INSERT INTO admissions VALUES (?, ?)", body.signature, body.expires);
      return json({ ok: true });
    }
    if (path === "/approve") {
      const invite = asInvite(body.invite, String(body.origin));
      if (!invite || invite.issuer.agentId === actor) return fail("invalid invite");
      const { signature, ...unsigned } = invite;
      if (!await signed(invite.issuer.signingPublicKey, signature, inviteMessage(unsigned))) return fail("invalid signature", 403);
      const peer = invite.issuer.agentId;
      const [identity] = this.sql.exec("SELECT encryption_key FROM identities WHERE agent_id = ?", peer);
      if (!identity || identity.encryption_key !== invite.issuer.encryptionPublicKey || this.blocked(actor, peer)) return fail("contact unavailable", 403);
      const now = Date.now();
      if (invite.expiresAt <= now) return fail("expired invite");
      this.sql.exec("DELETE FROM consumed_invites WHERE expires < ?", now);
      const [used] = this.sql.exec("SELECT consumed_by FROM consumed_invites WHERE issuer_id = ? AND invite_id = ?", peer, invite.inviteId);
      // The same accepter can recover after a dropped HTTP response; another identity cannot consume it.
      if (used && used.consumed_by !== actor) return fail("invite already used", 409);
      if (!used) {
        if (Number(this.sql.exec("SELECT COUNT(*) AS n FROM consumed_invites").one().n) >= 8192) return fail("invite limit", 429);
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("INSERT INTO consumed_invites VALUES (?, ?, ?, ?)", peer, invite.inviteId, actor, invite.expiresAt);
          this.sql.exec("INSERT OR IGNORE INTO approvals VALUES (?, ?, ?)", actor, peer, now);
        });
      }
      return json({ ok: true });
    }
    const peer = body.peer;
    if (!agentId(peer) || actor === peer) return fail("invalid contact");
    if (path === "/block") {
      const related = this.sql.exec("SELECT 1 FROM approvals WHERE (owner_id=? AND peer_id=?) OR (owner_id=? AND peer_id=?) LIMIT 1", actor, peer, peer, actor).toArray();
      if (!related.length) return fail("unknown contact", 404);
      this.sql.exec("INSERT OR IGNORE INTO blocks VALUES (?, ?, ?)", actor, peer, Date.now());
      return json({ ok: true });
    }
    if (path === "/permit") {
      const rows = this.sql.exec("SELECT 1 FROM approvals WHERE (owner_id=? AND peer_id=?) OR (owner_id=? AND peer_id=?)", actor, peer, peer, actor).toArray();
      return rows.length === 2 && !this.blocked(actor, peer) ? json({ ok: true }) : fail("delivery is not permitted", 403);
    }
    return fail("not found", 404);
  }
}

export class Mailbox extends DurableObject<Env> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS queue (
      sender TEXT NOT NULL, id TEXT NOT NULL, envelope TEXT NOT NULL, received INTEGER NOT NULL,
      PRIMARY KEY(sender, id));
      CREATE INDEX IF NOT EXISTS queue_received ON queue(received);
      CREATE TABLE IF NOT EXISTS barred (sender TEXT PRIMARY KEY);`);
    if (this.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages'").toArray().length) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("INSERT OR IGNORE INTO queue SELECT sender_id,id,envelope,? FROM messages", Date.now());
        this.sql.exec("DROP TABLE messages");
      });
      this.ctx.waitUntil(this.scheduleExpiry());
    }
  }

  private prune() {
    this.sql.exec("DELETE FROM queue WHERE received <= ?", Date.now() - 7 * DAY);
  }

  private async scheduleExpiry() {
    const [oldest] = this.sql.exec("SELECT received FROM queue ORDER BY received LIMIT 1");
    if (oldest) await this.ctx.storage.setAlarm(Number(oldest.received) + 7 * DAY);
  }

  async alarm() {
    this.prune();
    await this.scheduleExpiry();
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/socket") {
      if (this.ctx.getWebSockets().length >= 4) return fail("socket limit", 429);
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ resumed: false });
      return new Response(null, { status: 101, webSocket: client });
    }
    const body = await readJson(request);
    if (!record(body)) return fail("invalid input");
    if (path === "/bar" && agentId(body.sender)) {
      this.sql.exec("INSERT OR IGNORE INTO barred VALUES (?)", body.sender);
      this.sql.exec("DELETE FROM queue WHERE sender = ?", body.sender);
      return json({ ok: true });
    }
    if (path !== "/enqueue") return fail("not found", 404);
    const envelope = asEnvelope(body.envelope);
    if (!envelope) return fail("invalid envelope");
    if (this.sql.exec("SELECT 1 FROM barred WHERE sender = ?", envelope.senderId).toArray().length) return fail("delivery is not permitted", 403);
    this.prune();
    const [existing] = this.sql.exec("SELECT 1 FROM queue WHERE id=? AND sender=?", envelope.id, envelope.senderId);
    if (existing) return json({ ok: true, duplicate: true });
    const count = Number(this.sql.exec("SELECT COUNT(*) AS n FROM queue").one().n);
    if (count >= 64) return fail("mailbox full", 429);
    this.sql.exec("INSERT INTO queue VALUES (?, ?, ?, ?)", envelope.senderId, envelope.id, JSON.stringify(envelope), Date.now());
    const message = JSON.stringify({ type: "message", envelope });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch { /* committed for replay */ }
    }
    if (count === 0) await this.scheduleExpiry();
    return json({ ok: true, duplicate: false }, 201);
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 512) { socket.close(1009, "invalid frame"); return; }
    try {
      const event: unknown = JSON.parse(message);
      if (fields(event, ["type"]) && event.type === "resume" && !socket.deserializeAttachment()?.resumed) {
        socket.serializeAttachment({ resumed: true });
        this.prune();
        for (const row of this.sql.exec("SELECT envelope FROM queue ORDER BY received, sender, id")) {
          socket.send('{"type":"message","envelope":' + row.envelope + '}');
        }
        return;
      }
      if (fields(event, ["type", "senderId", "id"]) && event.type === "ack" && agentId(event.senderId) && identifier(event.id)) {
        this.sql.exec("DELETE FROM queue WHERE sender=? AND id=?", event.senderId, event.id);
        return;
      }
    } catch { /* Malformed input never gets echoed to the peer. */ }
    socket.close(1008, "invalid event");
  }
}
