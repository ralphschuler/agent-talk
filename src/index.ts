import { PortalStore } from "../portal/worker.ts";
export { PortalStore };
import { oauthIssuer } from "./oauth-issuer.ts";
import { createProviderResource, type McpGrant, type ProviderEnv } from "./mcp-provider-resource.ts";
import type { AuthorizationServerBinding } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { GroupDelivery } from "./group-relay.ts";
import { GROUP_REQUEST_LIMIT, groupHttpAction, validGroupRequest } from "./group-protocol.ts";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { authMessage, fromBase64url, inviteMessage, type AgentIdentity, type CipherEnvelope } from "./protocol.ts";
import { agentId, asEnvelope, asIdentity, asInvite, canonicalBytes, CLOCK_SKEW, DAY, fields, identifier, readJson, record } from "./validation.ts";

export interface Env {
  RELEASE_SHA: string;
  PORTAL_STORE?: DurableObjectNamespace<PortalStore>;
  PORTAL_ORIGIN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  MCP_OAUTH_ISSUER?: string;
  MCP_OAUTH_RESOURCE?: string;
  AUTH_SERVER?: AuthorizationServerBinding<McpGrant>;
  OAUTH_KV?: KVNamespace;
  DIRECTORY: DurableObjectNamespace<Directory>;
  MAILBOX: DurableObjectNamespace<Mailbox>;
}

/** Internal service entrypoint: never exposes an unauthenticated token-validation URL. */
export class OAuthValidator extends WorkerEntrypoint<Env> {
  async validateToken(resource: string, token: string) {
    if (!this.env.PORTAL_ORIGIN || !this.env.OAUTH_KV) throw new Error("OAuth issuer unavailable");
    return oauthIssuer({ PORTAL_ORIGIN: this.env.PORTAL_ORIGIN, OAUTH_KV: this.env.OAUTH_KV }).validateToken<McpGrant>(resource, token, { PORTAL_ORIGIN: this.env.PORTAL_ORIGIN, OAUTH_KV: this.env.OAUTH_KV });
  }
}

const IDENTITY_LIMIT = 512;
const ORPHAN_RETENTION = 30 * DAY;
const MAILBOX_LIMIT = 64;
const SENDER_QUEUE_LIMIT = 48;

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

async function serveMcp(request: Request, env: Env, grantedAgentId: string): Promise<Response> {
  const url = new URL(request.url);
  // Delivery uses the existing authenticated WebSocket, not an idle MCP stream.
  if (request.method === "GET") return fail("stream not available", 405);
  const server = new McpServer({ name: "agent-talk-ciphertext-relay", version: "0.2.0" });
  server.registerTool("relay_send_envelope", {
    description: "Submit a locally encrypted and signed envelope. Private keys and plaintext stay on the client.",
    inputSchema: {
      agentId: z.string().max(64), timestamp: z.string().max(13), signature: z.string().max(86),
      envelope: z.object({ version: z.number(), id: z.string().max(128), senderId: z.string().max(64),
    recipientId: z.string().max(64), createdAt: z.number(), enc: z.string().max(64), ciphertext: z.string().max(65000) }).strict(),
    },
  }, async ({ agentId: actor, timestamp, signature, envelope }) => {
    if (actor !== grantedAgentId) return { content: [{ type: "text" as const, text: "Envelope rejected." }], isError: true };
    const relayRequest = new Request(url.origin + "/v1/send", { method: "POST", headers: {
      "content-type": "application/json", "x-agent-id": actor, "x-agent-timestamp": timestamp, "x-agent-signature": signature,
    }, body: JSON.stringify({ envelope }) });
    const response = await worker.fetch(relayRequest, env);
    return { content: [{ type: "text" as const, text: response.ok ? "Envelope accepted." : "Envelope rejected (HTTP " + response.status + ")." }], isError: !response.ok };
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 96_000 });
  await server.connect(transport);
  return transport.handleRequest(request);
}

const worker = {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/oauth/token" || url.pathname === "/oauth/register") {
      if (url.protocol !== "https:" || !env.PORTAL_ORIGIN || url.origin !== env.PORTAL_ORIGIN || !env.OAUTH_KV || !ctx) return fail("OAuth issuer unavailable", 503);
      try { return await oauthIssuer({ PORTAL_ORIGIN: env.PORTAL_ORIGIN, OAUTH_KV: env.OAUTH_KV }).fetch(request, { PORTAL_ORIGIN: env.PORTAL_ORIGIN, OAUTH_KV: env.OAUTH_KV }, ctx); }
      catch { return fail("OAuth issuer unavailable", 503); }
    }
    if (url.pathname === "/authorize" || url.pathname === "/oauth/consent" || url.pathname.startsWith("/auth/") || url.pathname === "/agents" || ["/pairing/", "/device/", "/copy/"].some(prefix => url.pathname.startsWith(prefix))) {
      if (url.protocol !== "https:" || !env.PORTAL_STORE || !env.PORTAL_ORIGIN || url.origin !== env.PORTAL_ORIGIN || !env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) return fail("Owner portal unavailable", 503);
      return env.PORTAL_STORE.getByName("owner-portal").fetch(request);
    }
    if (url.pathname === "/.well-known/oauth-protected-resource/mcp" || url.pathname === "/mcp") {
      if (url.protocol !== "https:") return fail("HTTPS required", 403);
      if (url.pathname === "/mcp" && request.headers.has("origin")) return fail("origin not allowed", 403);
      if (!env.MCP_OAUTH_ISSUER || !env.MCP_OAUTH_RESOURCE || !env.AUTH_SERVER || !ctx || env.MCP_OAUTH_RESOURCE !== url.origin + "/mcp") return fail("OAuth unavailable", 503);
      const providerEnv = { ...env, AUTH_SERVER: env.AUTH_SERVER };
      let provider;
      try {
        provider = createProviderResource<Env & ProviderEnv>(env.MCP_OAUTH_RESOURCE, env.MCP_OAUTH_ISSUER, serveMcp);
      } catch { return fail("OAuth unavailable", 503); }
      return provider.fetch(request, providerEnv, ctx);
    }
    if (url.pathname === "/healthz" && request.method === "GET") return json({ ok: true, protocol: 1, release: env.RELEASE_SHA });
    const action = url.pathname.slice("/v1/".length);
    const group = ["group/submit","group/sync","group/ack"].includes(action);
    if (!url.pathname.startsWith("/v1/") || (!group && !["register", "socket", "contact/approve", "contact/block", "send"].includes(action))) return fail("not found", 404);
    const socket = action === "socket";
    if (request.method !== (socket ? "GET" : "POST")) return fail("method not allowed", 405);
    if (socket && request.headers.get("upgrade")?.toLowerCase() !== "websocket") return fail("WebSocket Upgrade required", 426);
    const actor = request.headers.get("x-agent-id");
    const timestamp = request.headers.get("x-agent-timestamp") ?? "";
    const signature = request.headers.get("x-agent-signature") ?? "";
    if (!agentId(actor) || !/^\d{13}$/u.test(timestamp) || Math.abs(Number(timestamp) - Date.now()) > CLOCK_SKEW
        || !canonicalBytes(signature, 64)) return fail("invalid authentication metadata", 401);
    const payload = socket ? {} : await readJson(request, group ? GROUP_REQUEST_LIMIT : undefined);
    if (!record(payload)) return fail("invalid or oversized JSON");
    // Validate the exact wire shape before signing or forwarding any user-controlled data.
    if (action === "register" && (!fields(payload, ["identity"]) || asIdentity(payload.identity)?.agentId !== actor)) return fail("invalid identity");
    if (action === "contact/approve") {
      const keys = payload.requireReciprocal === true ? ["invite","requireReciprocal"] : ["invite"];
      if (!fields(payload, keys) || !asInvite(payload.invite, url.origin)) return fail("invalid invite");
    }
    if (action === "contact/block" && (!fields(payload, ["peerId"]) || !agentId(payload.peerId) || payload.peerId === actor)) return fail("invalid peer");
    if (action === "send" && (!fields(payload, ["envelope"]) || asEnvelope(payload.envelope)?.senderId !== actor)) return fail("invalid envelope");
    if (group && !validGroupRequest(action, payload, url.origin)) return fail("invalid group request");
    if (!await signed(actor.slice(4), signature, authMessage(group ? groupHttpAction(action, url.origin) : action, actor, timestamp, payload))) return fail("authentication failed", 401);
    const directory = env.DIRECTORY.getByName("directory");
    if (action === "register") return post(directory, "/register", { identity: payload.identity });
    const auth = await post(directory, "/admit", { actor, signature, expires: Number(timestamp) + CLOCK_SKEW });
    if (!auth.ok) return auth;
    if (group) return post(directory, "/" + action, {actor,payload,origin:url.origin});
    if (socket) return env.MAILBOX.getByName(actor).fetch("https://internal/socket", { headers: { Upgrade: "websocket" } });
    if (action === "contact/approve") return post(directory, "/approve", { actor, invite: payload.invite, origin: url.origin, requireReciprocal: payload.requireReciprocal === true });
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

export default worker;

export class Directory extends DurableObject<Env> {
  private readonly groups = new GroupDelivery(this.ctx, this.env.MAILBOX);
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS identities (agent_id TEXT PRIMARY KEY, signing_key TEXT NOT NULL, encryption_key TEXT NOT NULL, registered_at INTEGER NOT NULL, last_active INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (owner_id TEXT NOT NULL, peer_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id, peer_id));
      CREATE TABLE IF NOT EXISTS blocks (owner_id TEXT NOT NULL, peer_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(owner_id, peer_id));
      CREATE TABLE IF NOT EXISTS consumed_invites (issuer_id TEXT NOT NULL, invite_id TEXT NOT NULL, consumed_by TEXT NOT NULL, PRIMARY KEY(issuer_id, invite_id));
      CREATE TABLE IF NOT EXISTS admissions (signature TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS admissions_expiry ON admissions(expires);
      CREATE INDEX IF NOT EXISTS approvals_peer ON approvals(peer_id);
      CREATE INDEX IF NOT EXISTS blocks_peer ON blocks(peer_id);
    `);
    if (!this.sql.exec("PRAGMA table_info(identities)").toArray().some(row => row.name === "last_active")) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("ALTER TABLE identities ADD COLUMN last_active INTEGER NOT NULL DEFAULT 0");
        // Older versions did not track activity; give every existing identity a full grace period.
        this.sql.exec("UPDATE identities SET last_active = ?", Date.now());
      });
    }
    this.sql.exec("CREATE INDEX IF NOT EXISTS identities_activity ON identities(last_active)");
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

  private touch(actor: string, lastActive: number, now: number) {
    // Coalesce writes on active identities. Reclamation allows for this full extra day.
    if (now - lastActive >= DAY) this.sql.exec("UPDATE identities SET last_active = ? WHERE agent_id = ?", now, actor);
  }

  private hasRegistrationSlot(now: number): boolean {
    const count = Number(this.sql.exec("SELECT COUNT(*) AS n FROM identities").one().n);
    if (count < IDENTITY_LIMIT) return true;
    const needed = count - IDENTITY_LIMIT + 1;
    this.sql.exec(`DELETE FROM identities WHERE agent_id IN (
      SELECT i.agent_id FROM identities i WHERE i.last_active < ?
      AND NOT EXISTS (SELECT 1 FROM g_clients WHERE agent = i.agent_id)
      AND NOT EXISTS (SELECT 1 FROM approvals WHERE owner_id = i.agent_id)
      AND NOT EXISTS (SELECT 1 FROM approvals WHERE peer_id = i.agent_id)
      AND NOT EXISTS (SELECT 1 FROM blocks WHERE owner_id = i.agent_id)
      AND NOT EXISTS (SELECT 1 FROM blocks WHERE peer_id = i.agent_id)
      ORDER BY i.last_active LIMIT ?
    )`, now - ORPHAN_RETENTION - DAY, Math.min(needed, 32));
    return Number(this.sql.exec("SELECT COUNT(*) AS n FROM identities").one().n) < IDENTITY_LIMIT;
  }

  private insertIdentity(identity: AgentIdentity, now: number) {
    this.sql.exec("INSERT INTO identities (agent_id, signing_key, encryption_key, registered_at, last_active) VALUES (?, ?, ?, ?, ?)", identity.agentId, identity.signingPublicKey, identity.encryptionPublicKey, now, now);
  }

  async alarm() { await this.groups.alarm(); }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const body = await readJson(request, path.startsWith("/group/") ? GROUP_REQUEST_LIMIT + 256 : undefined);
    if (!record(body)) return fail("invalid input");
    if (path === "/register") {
      const identity = asIdentity(body.identity);
      if (!identity) return fail("invalid identity");
      const now = Date.now();
      const [existing] = this.sql.exec("SELECT encryption_key, last_active FROM identities WHERE agent_id = ?", identity.agentId);
      if (existing) {
        if (existing.encryption_key !== identity.encryptionPublicKey) return fail("key mismatch", 409);
        this.touch(identity.agentId, Number(existing.last_active), now);
        return json({ ok: true, agentId: identity.agentId });
      }
      if (!this.hasRegistrationSlot(now)) return fail("pilot identity capacity reached", 429);
      this.insertIdentity(identity, now);
      return json({ ok: true, agentId: identity.agentId }, 201);
    }
    const actor = body.actor;
    if (!agentId(actor)) return fail("invalid actor");
    if (["/group/submit","/group/sync","/group/ack"].includes(path) && record(body.payload) && typeof body.origin === "string") {
      return this.groups.handle(path.slice(1), actor, body.payload, body.origin);
    }
    if (path === "/migration-contacts") {
      // Internal, one-time mailbox migration. The public router exposes no contact-list endpoint.
      const allowed = this.sql.exec(`SELECT a.peer_id FROM approvals a JOIN approvals b
        ON a.peer_id = b.owner_id AND b.peer_id = a.owner_id WHERE a.owner_id = ?
        AND NOT EXISTS (SELECT 1 FROM blocks WHERE owner_id = a.owner_id AND peer_id = a.peer_id)
        AND NOT EXISTS (SELECT 1 FROM blocks WHERE owner_id = a.peer_id AND peer_id = a.owner_id)`, actor);
      return json(allowed.toArray().map(row => row.peer_id));
    }
    if (path === "/admit") {
      const now = Date.now();
      const [identity] = this.sql.exec("SELECT last_active FROM identities WHERE agent_id = ?", actor);
      if (!identity) return fail("authentication failed", 401);
      this.sql.exec("DELETE FROM admissions WHERE expires < ?", now);
      if (typeof body.signature !== "string" || typeof body.expires !== "number" || body.expires < now) return fail("expired", 401);
      if (this.sql.exec("SELECT 1 FROM admissions WHERE signature = ?", body.signature).toArray().length) return fail("request already used", 409);
      if (Number(this.sql.exec("SELECT COUNT(*) AS n FROM admissions").one().n) >= 8192) return fail("pilot request limit", 429);
      this.sql.exec("INSERT INTO admissions VALUES (?, ?)", body.signature, body.expires);
      this.touch(actor, Number(identity.last_active), now);
      return new Response(null, { status: 204 });
    }
    if (path === "/approve") {
      const invite = asInvite(body.invite, String(body.origin));
      if (!invite || invite.issuer.agentId === actor) return fail("invalid invite");
      const { signature, ...unsigned } = invite;
      if (!await signed(invite.issuer.signingPublicKey, signature, inviteMessage(unsigned))) return fail("invalid signature", 403);
      const peer = invite.issuer.agentId;
      const [identity] = this.sql.exec("SELECT encryption_key FROM identities WHERE agent_id = ?", peer);
      if ((identity && identity.encryption_key !== invite.issuer.encryptionPublicKey) || this.blocked(actor, peer)) return fail("contact unavailable", 403);
      if (body.requireReciprocal === true && !this.sql.exec("SELECT 1 FROM approvals WHERE owner_id=? AND peer_id=?", peer, actor).toArray().length) return fail("replacement requires reciprocal approval", 403);
      const now = Date.now();
      if (invite.expiresAt <= now) return fail("expired invite");
      this.sql.exec("DELETE FROM consumed_invites WHERE expires < ?", now);
      const [used] = this.sql.exec("SELECT consumed_by FROM consumed_invites WHERE issuer_id = ? AND invite_id = ?", peer, invite.inviteId);
      // The same accepter can recover after a dropped HTTP response; another identity cannot consume it.
      if (used && used.consumed_by !== actor) return fail("invite already used", 409);
      if (!used) {
        if (Number(this.sql.exec("SELECT COUNT(*) AS n FROM consumed_invites").one().n) >= 8192) return fail("invite limit", 429);
        return this.ctx.storage.transactionSync(() => {
          // A valid signed invitation also proves ownership after an idle, unrelated registration aged out.
          if (!identity) {
            if (!this.hasRegistrationSlot(now)) return fail("pilot identity capacity reached", 429);
            this.insertIdentity(invite.issuer, now);
          }
          this.sql.exec("INSERT INTO consumed_invites VALUES (?, ?, ?, ?)", peer, invite.inviteId, actor, invite.expiresAt);
          this.sql.exec("INSERT OR IGNORE INTO approvals VALUES (?, ?, ?)", actor, peer, now);
          return json({ ok: true });
        });
      }
      return json({ ok: true });
    }
    const peer = body.peer;
    if (!agentId(peer) || actor === peer) return fail("invalid contact");
    if (path === "/block") {
      const related = this.sql.exec("SELECT 1 FROM approvals WHERE (owner_id=? AND peer_id=?) OR (owner_id=? AND peer_id=?) LIMIT 1", actor, peer, peer, actor).toArray();
      if (!related.length) return fail("unknown contact", 404);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("INSERT OR IGNORE INTO blocks VALUES (?, ?, ?)", actor, peer, Date.now());
        this.groups.block(actor, peer);
      });
      return new Response(null, { status: 204 });
    }
    if (path === "/permit") {
      const rows = this.sql.exec("SELECT 1 FROM approvals WHERE (owner_id=? AND peer_id=?) OR (owner_id=? AND peer_id=?)", actor, peer, peer, actor).toArray();
      return rows.length === 2 && !this.blocked(actor, peer) ? new Response(null, { status: 204 }) : fail("delivery is not permitted", 403);
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
      CREATE TABLE IF NOT EXISTS barred (sender TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS mailbox_migrations (version INTEGER PRIMARY KEY);`);
    if (!this.sql.exec("SELECT 1 FROM mailbox_migrations WHERE version=1").toArray().length) {
      void ctx.blockConcurrencyWhile(() => this.migrateLegacyQueue());
    }
  }

  private async migrateLegacyQueue() {
    const legacy = this.sql.exec("SELECT 1 FROM sqlite_master WHERE type='table' AND name='messages'").toArray().length > 0;
    const tables = legacy ? ["queue", "messages"] : ["queue"];
    let owner = this.ctx.id.name;
    if (!agentId(owner)) {
      // Some wake-ups provide only the opaque DO ID. Check the full routing identity against it.
      for (const table of tables) {
        // Finish the legacy read before the directory call or schema changes.
        const recipients = this.sql.exec(`SELECT DISTINCT json_extract(envelope, '$.recipientId') AS recipient FROM ${table} WHERE json_valid(envelope)`).toArray();
        for (const row of recipients) {
          if (agentId(row.recipient) && this.env.MAILBOX.idFromName(row.recipient).equals(this.ctx.id)) {
            owner = row.recipient;
            break;
          }
        }
        if (agentId(owner)) break;
      }
    }
    const pending = tables.some(table => this.sql.exec(`SELECT 1 FROM ${table} LIMIT 1`).toArray().length);
    let allowed: string[] = [];
    if (pending && agentId(owner)) {
      const response = await post(this.env.DIRECTORY.getByName("directory"), "/migration-contacts", { actor: owner });
      if (!response.ok) throw new Error("Cannot verify legacy contact permissions");
      const contacts: unknown = await response.json();
      if (!Array.isArray(contacts) || !contacts.every(agentId)) throw new Error("Invalid legacy contact permissions");
      allowed = contacts;
    }
    this.ctx.storage.transactionSync(() => {
      if (legacy) {
        this.sql.exec("INSERT OR IGNORE INTO queue SELECT sender_id,id,envelope,created_at FROM messages");
        this.sql.exec("DROP TABLE messages");
      }
      if (pending) {
        const now = Date.now();
        this.sql.exec("DELETE FROM queue WHERE NOT json_valid(envelope)");
        this.sql.exec(`DELETE FROM queue WHERE sender NOT IN (SELECT value FROM json_each(?))
          OR sender IN (SELECT sender FROM barred)
          OR json_extract(envelope,'$.recipientId') IS NOT ?
          OR json_extract(envelope,'$.senderId') IS NOT sender OR json_extract(envelope,'$.id') IS NOT id
          OR json_type(envelope,'$.createdAt') IS NOT 'integer' OR json_extract(envelope,'$.createdAt') > ?
          OR received > ?`, JSON.stringify(allowed), owner ?? "", now + CLOCK_SKEW, now + CLOCK_SKEW);
        // The interim schema could have assigned an old envelope the date of its migration.
        // Bound its age with both available timestamps. Future clock skew never extends retention.
        this.sql.exec("UPDATE queue SET received=MIN(received,json_extract(envelope,'$.createdAt'),?)", now);
        this.prune();
      }
    });
    if (pending) await this.scheduleExpiry();
    this.sql.exec("INSERT INTO mailbox_migrations VALUES (1)");
  }

  private prune() {
    this.sql.exec("DELETE FROM queue WHERE received <= ?", Date.now() - 7 * DAY);
  }

  private async scheduleExpiry() {
    const [oldest] = this.sql.exec("SELECT received FROM queue ORDER BY received LIMIT 1").toArray();
    if (oldest) await this.ctx.storage.setAlarm(Number(oldest.received) + 7 * DAY);
  }

  async alarm() {
    this.prune();
    await this.scheduleExpiry();
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/group-wake" && request.method === "POST") {
      for (const socket of this.ctx.getWebSockets()) {
        try { socket.send('{"type":"group-wake"}'); } catch { try { socket.close(1011); } catch { /* already closed */ } }
      }
      return new Response(null, {status:204});
    }
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
      return new Response(null, { status: 204 });
    }
    if (path !== "/enqueue") return fail("not found", 404);
    const envelope = asEnvelope(body.envelope);
    if (!envelope) return fail("invalid envelope");
    if (this.sql.exec("SELECT 1 FROM barred WHERE sender = ?", envelope.senderId).toArray().length) return fail("delivery is not permitted", 403);
    this.prune();
    const [existing] = this.sql.exec("SELECT 1 FROM queue WHERE id=? AND sender=?", envelope.id, envelope.senderId);
    if (existing) return json({ ok: true, duplicate: true });
    const occupancy = this.sql.exec("SELECT COUNT(*) AS total, COUNT(CASE WHEN sender = ? THEN 1 END) AS from_sender FROM queue", envelope.senderId).one();
    if (Number(occupancy.total) >= MAILBOX_LIMIT) return fail("mailbox full", 429);
    if (Number(occupancy.from_sender) >= SENDER_QUEUE_LIMIT) return fail("sender limit for this mailbox reached", 429);
    this.sql.exec("INSERT INTO queue VALUES (?, ?, ?, ?)", envelope.senderId, envelope.id, JSON.stringify(envelope), Date.now());
    const message = JSON.stringify({ type: "message", envelope });
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(message); } catch { /* committed for replay */ }
    }
    if (Number(occupancy.total) === 0) await this.scheduleExpiry();
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
