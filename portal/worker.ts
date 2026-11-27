import { DurableObject } from "cloudflare:workers";
import { oauthIssuer } from "../src/oauth-issuer.ts";
import { PROVIDER_SCOPE } from "../src/mcp-provider-resource.ts";
import { beginAuthorization, exchangeAuthorization } from "../src/github-oauth.ts";
import { initAuthTransactions, saveAuthTransaction, consumeAuthTransaction } from "../src/auth-transaction.ts";
import { base64url, type CipherEnvelope } from "../src/protocol.ts";
import { createPairingRequest, verifyPairing, type PairingApproval } from "./pairing.ts";
import { verifyRequest } from "../src/crypto.ts";
import { agentId, canonicalBytes, fields, identifier, readJson } from "../src/validation.ts";

interface PortalEnv {
  PORTAL_STORE: DurableObjectNamespace<PortalStore>;
  PORTAL_ORIGIN: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  RELEASE_SHA: string;
  OAUTH_TEST_PROVIDER?: Fetcher;
  OAUTH_KV?: KVNamespace;
}

const cookieOptions = "Path=/; Secure; HttpOnly; SameSite=Lax";
const random = () => base64url(crypto.getRandomValues(new Uint8Array(32)));
const hash = async (value: string) => base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));

function cookie(request: Request, name: string): string {
  const matches = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim())
    .filter(part => part.startsWith(name + "="));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : "";
}

function response(body: unknown, status = 200, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  result.set("X-Content-Type-Options", "nosniff");
  result.set("Referrer-Policy", "no-referrer");
  return Response.json(body, { status, headers: result });
}

function ownerEnvelope(value: unknown): CipherEnvelope | null {
  if (!fields(value, ["version", "id", "senderId", "recipientId", "createdAt", "enc", "ciphertext"]) ||
      value.version !== 1 || !identifier(value.id) || !agentId(value.senderId) || !agentId(value.recipientId) ||
      value.senderId === value.recipientId || !Number.isSafeInteger(value.createdAt) ||
      !canonicalBytes(value.enc, 32) || !canonicalBytes(value.ciphertext, 16, 90_016)) return null;
  return value as CipherEnvelope;
}

export default {
  async fetch(request: Request, env: PortalEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== env.PORTAL_ORIGIN) return response({ error: "Invalid origin" }, 400);
    if (url.pathname === "/healthz" && request.method === "GET") return response({ ok: true, release: env.RELEASE_SHA });
    return env.PORTAL_STORE.getByName("owner-portal").fetch(request);
  },
} satisfies ExportedHandler<PortalEnv>;

export class PortalStore extends DurableObject<PortalEnv> {
  private readonly sql = this.ctx.storage.sql;

  constructor(ctx: DurableObjectState, env: PortalEnv) {
    super(ctx, env);
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS owner_copies (agent_id TEXT NOT NULL, device_id TEXT NOT NULL, message_id TEXT NOT NULL, envelope_json TEXT NOT NULL, PRIMARY KEY(agent_id, device_id, message_id)); CREATE TABLE IF NOT EXISTS device_nonces (device_id TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL, PRIMARY KEY(device_id, nonce));");
    this.ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS pending_pairs (nonce TEXT PRIMARY KEY, account_id TEXT NOT NULL, session_hash TEXT NOT NULL, request_json TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS agents (agent_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, agent_json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS devices (agent_id TEXT NOT NULL, device_id TEXT NOT NULL, device_json TEXT NOT NULL, grant_nonce TEXT NOT NULL, PRIMARY KEY(agent_id, device_id));");
    initAuthTransactions(this.ctx.storage);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS transactions (
      state_hash TEXT PRIMARY KEY, cookie_hash TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL
    ); CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL
    );`);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== this.env.PORTAL_ORIGIN) return response({ error: "Invalid origin" }, 400);
    const config = {
      clientId: this.env.GITHUB_CLIENT_ID,
      clientSecret: this.env.GITHUB_CLIENT_SECRET,
      callback: this.env.PORTAL_ORIGIN + "/auth/callback",
    };
    if (url.pathname === "/authorize" || url.pathname === "/oauth/consent") {
      if (!this.env.OAUTH_KV) return response({ error: "MCP authorization unavailable" }, 503);
      const token = cookie(request, "__Host-at_session");
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return response({ error: "Sign in to the owner portal before authorizing an MCP client" }, 401);
      const session = this.sql.exec<{ account_id: string }>("SELECT account_id FROM sessions WHERE token_hash = ? AND expires > ?", await hash(token), Date.now()).toArray()[0];
      if (!session) return response({ error: "Unauthorized" }, 401);
      const oauth = oauthIssuer({ PORTAL_ORIGIN: this.env.PORTAL_ORIGIN, OAUTH_KV: this.env.OAUTH_KV }).getOAuthApi({ PORTAL_ORIGIN: this.env.PORTAL_ORIGIN, OAUTH_KV: this.env.OAUTH_KV });
      if (url.pathname === "/authorize" && request.method === "GET") {
        try {
          const authRequest = await oauth.parseAuthRequest(request);
          if (authRequest.scope.length !== 1 || authRequest.scope[0] !== PROVIDER_SCOPE) return response({ error: "Invalid scope" }, 400);
          const description = await oauth.describeConsent(authRequest);
          const consent = await oauth.beginConsent(authRequest);
          const agents = this.sql.exec<{ agent_id: string }>("SELECT agent_id FROM agents WHERE account_id = ? ORDER BY agent_id", session.account_id).toArray();
          const esc = (value: string) => value.replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[ch]!);
          const options = agents.map(({ agent_id }) => `<option value="${esc(agent_id)}">${esc(agent_id)}</option>`).join("");
          const headers = new Headers(consent.headers);
          headers.set("Content-Type", "text/html; charset=utf-8");
          headers.set("Cache-Control", "no-store");
          headers.set("Content-Security-Policy", "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
          return new Response(`<!doctype html><html lang="en"><title>Authorize Agent Talk</title><h1>Authorize agent</h1><p>Client: ${esc(description.clientName)}</p><p>Redirect: ${esc(description.redirectHost)}</p><p>Scope: ${esc(description.scope.join(", "))}</p><form method="post" action="/oauth/consent"><input type="hidden" name="handle" value="${esc(consent.handle)}"><label>Agent <select name="agent" required>${options}</select></label><button name="decision" value="approve">Approve</button><button name="decision" value="deny" formnovalidate>Deny</button></form></html>`, { headers });
        } catch { return response({ error: "Invalid authorization request" }, 400); }
      }
      if (url.pathname === "/oauth/consent" && request.method === "POST") {
        if (request.headers.get("origin") !== url.origin || request.headers.get("content-type")?.split(";")[0] !== "application/x-www-form-urlencoded") return response({ error: "Invalid origin or content type" }, 403);
        const length = Number(request.headers.get("content-length"));
        if (!Number.isSafeInteger(length) || length < 1 || length > 8192) return response({ error: "Invalid request size" }, 400);
        const text = await request.text();
        if (new TextEncoder().encode(text).length !== length) return response({ error: "Invalid request size" }, 400);
        const form = new URLSearchParams(text);
        if ([...form.keys()].some(key => !["handle", "agent", "decision"].includes(key)) || form.getAll("handle").length !== 1 || form.getAll("decision").length !== 1 || form.getAll("agent").length > 1) return response({ error: "Invalid request" }, 400);
        const handle = form.get("handle")!, agent = form.get("agent") ?? "", decision = form.get("decision");
        try {
          if (decision === "deny") { const denied = await oauth.denyConsent(request, handle); return new Response(null, { status: 303, headers: denied.headers }); }
          if (decision !== "approve" || !agentId(agent) || !this.sql.exec("SELECT 1 FROM agents WHERE agent_id = ? AND account_id = ?", agent, session.account_id).toArray().length) return response({ error: "Agent is not owned by this account" }, 403);
          const approved = await oauth.approveConsent(request, handle, { scope: [PROVIDER_SCOPE] });
          const result = await oauth.completeAuthorization({ request: approved.request, userId: session.account_id, metadata: {}, scope: [PROVIDER_SCOPE], props: { agentId: agent } });
          const headers = new Headers(approved.headers); headers.set("Location", result.redirectTo); headers.set("Cache-Control", "no-store");
          return new Response(null, { status: 303, headers });
        } catch { return response({ error: "Invalid or expired consent" }, 400); }
      }
      return response({ error: "Method not allowed" }, 405);
    }
    if ((url.pathname === "/auth/login" || url.pathname === "/auth/mcp/login") && request.method === "POST") {
      // MCP continuation is unavailable until the issuer is integrated.
      if (url.pathname === "/auth/mcp/login") return response({ error: "MCP authorization unavailable" }, 503);
      if (request.headers.get("origin") !== url.origin) return response({ error: "Invalid origin" }, 403);
      const { transaction, url: authorizationUrl } = await beginAuthorization(config);
      const browserToken = random();
      const stateHash = await hash(transaction.state);
      const cookieHash = await hash(browserToken);
      const inserted = saveAuthTransaction(this.ctx.storage, {
        stateHash, browserHash: cookieHash, verifier: transaction.verifier,
        expires: transaction.expiresAt, flow: "dashboard",
      }, Date.now());
      if (!inserted) return response({ error: "Too many pending authorizations" }, 429);
      return response({ url: authorizationUrl }, 200, { "Set-Cookie": `__Host-at_auth=${browserToken}; ${cookieOptions}; Max-Age=300` });
    }
    if (url.pathname === "/auth/callback" && request.method === "GET") {
      const state = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      const browserToken = cookie(request, "__Host-at_auth");
      if (url.searchParams.getAll("state").length !== 1 || url.searchParams.getAll("code").length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browserToken) || !code || code.length > 2048) {
        return response({ error: "Invalid authorization" }, 400);
      }
      const stateHash = await hash(state);
      const browserHash = await hash(browserToken);
      const row = consumeAuthTransaction(this.ctx.storage, stateHash, browserHash, Date.now());
      if (!row) return response({ error: "Invalid authorization" }, 400);
      if (row.flow !== "dashboard") return response({ error: "MCP authorization unavailable" }, 503);
      let accountId: string;
      try {
        const fetcher: typeof fetch = this.env.OAUTH_TEST_PROVIDER
          ? ((input, init) => this.env.OAUTH_TEST_PROVIDER!.fetch(input, init)) as typeof fetch
          : fetch;
        accountId = await exchangeAuthorization(config, { state, verifier: row.verifier, expiresAt: row.expires }, state, code, fetcher);
      } catch {
        return response({ error: "Authorization failed" }, 401);
      }
      const token = random();
      this.sql.exec("DELETE FROM sessions WHERE expires <= ?", Date.now());
      this.sql.exec("INSERT INTO sessions VALUES (?, ?, ?)", await hash(token), accountId, Date.now() + 8 * 60 * 60_000);
      const headers = new Headers({ Location: "/", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
      headers.append("Set-Cookie", `__Host-at_session=${token}; ${cookieOptions}; Max-Age=28800`);
      headers.append("Set-Cookie", `__Host-at_auth=; ${cookieOptions}; Max-Age=0`);
      return new Response(null, { status: 303, headers });
    }
    if (url.pathname === "/auth/account" && request.method === "GET") {
      const token = cookie(request, "__Host-at_session");
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return response({ error: "Unauthorized" }, 401);
      const session = this.sql.exec<{ account_id: string }>(
        "SELECT account_id FROM sessions WHERE token_hash = ? AND expires > ?", await hash(token), Date.now(),
      ).toArray()[0];
      return session ? response({ accountId: session.account_id }) : response({ error: "Unauthorized" }, 401);
    }
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (request.headers.get("origin") !== url.origin) return response({ error: "Invalid origin" }, 403);
      const token = cookie(request, "__Host-at_session");
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
        const sessionHash = await hash(token);
        this.ctx.storage.transactionSync(() => {
          this.sql.exec("DELETE FROM sessions WHERE token_hash = ?", sessionHash);
          this.sql.exec("DELETE FROM pending_pairs WHERE session_hash = ?", sessionHash);
        });
      }
      return response({ ok: true }, 200, { "Set-Cookie": `__Host-at_session=; ${cookieOptions}; Max-Age=0` });
    }
    if (url.pathname === "/copy/publish" && request.method === "POST") {
      const payload = await readJson(request, 125_000);
      const timestamp = request.headers.get("x-agent-timestamp") ?? "";
      const signature = request.headers.get("x-agent-signature") ?? "";
      if ((!fields(payload, ["envelope", "grantNonce"]) && !fields(payload, ["envelope", "grantNonce", "grantExpiresAt"])) ||
          !canonicalBytes(payload.grantNonce, 32) ||
          ("grantExpiresAt" in payload && (!Number.isSafeInteger(payload.grantExpiresAt) || Number(payload.grantExpiresAt) <= Date.now())) ||
          !ownerEnvelope(payload.envelope) ||
          !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 60_000 ||
          !canonicalBytes(signature, 64)) return response({ error: "Invalid request" }, 400);
      const envelope = ownerEnvelope(payload.envelope)!;
      if (!await verifyRequest(envelope.senderId.slice(4), "owner-copy-v1", envelope.senderId, timestamp, payload, signature)) {
        return response({ error: "Unauthorized" }, 401);
      }
      const stored = this.ctx.storage.transactionSync(() => {
        if ("grantExpiresAt" in payload && Number(payload.grantExpiresAt) <= Date.now()) return false;
        const active = this.sql.exec("SELECT 1 FROM devices WHERE agent_id = ? AND device_id = ? AND grant_nonce = ?",
          envelope.senderId, envelope.recipientId, payload.grantNonce).toArray().length;
        if (!active) return false;
        const serialized = JSON.stringify(envelope);
        const previous = this.sql.exec<{ envelope_json: string }>("SELECT envelope_json FROM owner_copies WHERE agent_id = ? AND device_id = ? AND message_id = ?", envelope.senderId, envelope.recipientId, envelope.id).toArray()[0];
        if (previous) return previous.envelope_json === serialized;
        this.sql.exec("INSERT INTO owner_copies VALUES (?, ?, ?, ?)", envelope.senderId, envelope.recipientId, envelope.id, serialized);
        return true;
      });
      return stored ? response({ ok: true }) : response({ error: "Device unavailable or conflicting message" }, 403);
    }
    if (["/agents", "/pairing/start", "/pairing/complete", "/pairing/deny", "/device/revoke", "/copy/read"].includes(url.pathname)) {
      const list = url.pathname === "/agents";
      if (request.method !== (list ? "GET" : "POST")) return response({ error: "Method not allowed" }, 405);
      if (!list && request.headers.get("origin") !== url.origin) return response({ error: "Invalid origin" }, 403);
      const token = cookie(request, "__Host-at_session");
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return response({ error: "Unauthorized" }, 401);
      const sessionHash = await hash(token);
      const session = this.sql.exec<{ account_id: string }>(
        "SELECT account_id FROM sessions WHERE token_hash = ? AND expires > ?", sessionHash, Date.now(),
      ).toArray()[0];
      if (!session) return response({ error: "Unauthorized" }, 401);
      if (list) {
        const agents = this.sql.exec<{ agent_id: string; agent_json: string }>(
          "SELECT agent_id, agent_json FROM agents WHERE account_id = ? ORDER BY agent_id", session.account_id,
        ).toArray().map(({ agent_id, agent_json }) => ({
          agentId: agent_id,
          identity: JSON.parse(agent_json),
          devices: this.sql.exec<{ device_json: string }>("SELECT device_json FROM devices WHERE agent_id = ? ORDER BY device_id", agent_id)
            .toArray().map(device => JSON.parse(device.device_json)),
        }));
        return response({ agents });
      }
      if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return response({ error: "Invalid content type" }, 415);
      const text = await request.text();
      if (text.length > 8192) return response({ error: "Request too large" }, 413);
      let body: Record<string, any>;
      try {
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        body = parsed as Record<string, any>;
      } catch { return response({ error: "Invalid request" }, 400); }
      if (url.pathname === "/copy/read") {
        const timestamp = request.headers.get("x-device-timestamp") ?? "";
        const signature = request.headers.get("x-device-signature") ?? "";
        if (!fields(body, ["agentId", "deviceId", "nonce"]) || !agentId(body.agentId) || !agentId(body.deviceId) ||
            !canonicalBytes(body.nonce, 32) || !/^\d{13}$/.test(timestamp) ||
            Math.abs(Date.now() - Number(timestamp)) > 60_000 || !canonicalBytes(signature, 64)) return response({ error: "Invalid request" }, 400);
        const signedBody = { ...body, accountId: session.account_id };
        if (!await verifyRequest(body.deviceId.slice(4), "owner-copy-read-v1", body.deviceId, timestamp, signedBody, signature)) {
          return response({ error: "Unauthorized" }, 401);
        }
        const copies = this.ctx.storage.transactionSync(() => {
          const allowed = this.sql.exec("SELECT 1 FROM sessions JOIN agents ON agents.account_id = sessions.account_id JOIN devices ON devices.agent_id = agents.agent_id WHERE sessions.token_hash = ? AND sessions.expires > ? AND agents.agent_id = ? AND devices.device_id = ?",
            sessionHash, Date.now(), body.agentId, body.deviceId).toArray().length;
          if (!allowed) return null;
          this.sql.exec("DELETE FROM device_nonces WHERE expires <= ?", Date.now());
          const fresh = this.sql.exec("INSERT OR IGNORE INTO device_nonces VALUES (?, ?, ?) RETURNING nonce", body.deviceId, body.nonce, Date.now() + 120_000).toArray().length;
          if (!fresh) return null;
          return this.sql.exec<{ envelope_json: string }>("SELECT envelope_json FROM owner_copies WHERE agent_id = ? AND device_id = ? ORDER BY message_id", body.agentId, body.deviceId).toArray().map(row => JSON.parse(row.envelope_json));
        });
        return copies ? response({ copies }) : response({ error: "Device unavailable or request replayed" }, 403);
      }
      if (url.pathname === "/pairing/start") {
        try {
          const pair = createPairingRequest(session.account_id, body.agentId, body.device);
          const existing = this.sql.exec<{ account_id: string }>("SELECT account_id FROM agents WHERE agent_id = ?", pair.agentId).toArray()[0];
          if (existing && existing.account_id !== session.account_id) return response({ error: "Agent unavailable" }, 403);
          this.sql.exec("DELETE FROM pending_pairs WHERE expires <= ?", Date.now());
          this.sql.exec("INSERT INTO pending_pairs VALUES (?, ?, ?, ?, ?)", pair.nonce, session.account_id, sessionHash, JSON.stringify(pair), pair.expiresAt);
          return response({ request: pair }, 201);
        } catch { return response({ error: "Invalid pairing" }, 400); }
      }
      if (url.pathname === "/pairing/deny") {
        if (typeof body.nonce !== "string") return response({ error: "Invalid request" }, 400);
        this.sql.exec("DELETE FROM pending_pairs WHERE nonce = ? AND account_id = ? AND session_hash = ?", body.nonce, session.account_id, sessionHash);
        return response({ ok: true });
      }
      if (url.pathname === "/pairing/complete") {
        try {
          const approval = body.approval as PairingApproval;
          const pair = approval.request;
          const stored = this.sql.exec<{ request_json: string }>(
            "SELECT request_json FROM pending_pairs WHERE nonce = ? AND account_id = ? AND session_hash = ? AND expires > ?",
            pair.nonce, session.account_id, sessionHash, Date.now(),
          ).toArray()[0];
          if (!stored || JSON.stringify(pair) !== stored.request_json) return response({ error: "Invalid pairing" }, 403);
          await verifyPairing(approval, session.account_id, {
            agentId: pair.agentId, signingPublicKey: pair.agentId.slice(4), encryptionPublicKey: "",
          });
          const completed = this.ctx.storage.transactionSync(() => {
            const active = this.sql.exec("SELECT 1 FROM sessions WHERE token_hash = ? AND account_id = ? AND expires > ?",
              sessionHash, session.account_id, Date.now()).toArray().length;
            if (!active) return false;
            const valid = this.sql.exec("DELETE FROM pending_pairs WHERE nonce = ? AND account_id = ? AND session_hash = ? AND expires > ? RETURNING nonce",
              pair.nonce, session.account_id, sessionHash, Date.now()).toArray().length;
            if (!valid) return false;
            this.sql.exec("INSERT OR IGNORE INTO agents VALUES (?, ?, ?)", pair.agentId, session.account_id, JSON.stringify(approval.agent));
            const owner = this.sql.exec<{ account_id: string; agent_json: string }>("SELECT account_id, agent_json FROM agents WHERE agent_id = ?", pair.agentId).toArray()[0];
            if (owner.account_id !== session.account_id || owner.agent_json !== JSON.stringify(approval.agent)) return false;
            const existingDevice = this.sql.exec<{ device_json: string }>("SELECT device_json FROM devices WHERE agent_id = ? AND device_id = ?",
              pair.agentId, pair.device.agentId).toArray()[0];
            if (existingDevice && existingDevice.device_json !== JSON.stringify(pair.device)) return false;
            if (existingDevice) this.sql.exec("DELETE FROM owner_copies WHERE agent_id = ? AND device_id = ?", pair.agentId, pair.device.agentId);
            this.sql.exec("INSERT INTO devices VALUES (?, ?, ?, ?) ON CONFLICT(agent_id, device_id) DO UPDATE SET grant_nonce = excluded.grant_nonce",
              pair.agentId, pair.device.agentId, JSON.stringify(pair.device), pair.nonce);
            return true;
          });
          return completed ? response({ ok: true }) : response({ error: "Invalid pairing" }, 403);
        } catch { return response({ error: "Invalid pairing" }, 403); }
      }
      if (typeof body.agentId !== "string" || typeof body.deviceId !== "string") return response({ error: "Invalid request" }, 400);
      this.ctx.storage.transactionSync(() => {
        const deleted = this.sql.exec("DELETE FROM devices WHERE agent_id = ? AND device_id = ? AND EXISTS (SELECT 1 FROM agents WHERE agent_id = ? AND account_id = ?) RETURNING device_id",
          body.agentId, body.deviceId, body.agentId, session.account_id).toArray().length;
        if (deleted) this.sql.exec("DELETE FROM owner_copies WHERE agent_id = ? AND device_id = ?", body.agentId, body.deviceId);
      });
      return response({ ok: true });
    }
    return response({ error: "Not found" }, 404);
  }
}
