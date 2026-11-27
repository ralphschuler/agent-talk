import { createExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createProviderResource, PROVIDER_SCOPE } from "../src/mcp-provider-resource.ts";

const resource = "https://agent-talk-test.nyphon.de/mcp";
const issuer = "https://agent-talk-test.nyphon.de/";
const approvedAgent = "at1_" + "A".repeat(43);
const ctx = createExecutionContext();

describe("OAuth provider resource wrapper", () => {
  it("uses provider validation and requires both scope and server-owned agent grant", async () => {
    const server = createProviderResource(resource, issuer, async (_request, _env, agent) => new Response(agent));
    const env = { AUTH_SERVER: { async validateToken(audience: string, token: string) {
      if (audience !== resource || token === "invalid") return null;
      return { audience, expiresAt: Math.floor(Date.now() / 1000) + 300, userId: "synthetic", clientId: "synthetic", scope: token === "narrow" ? [] : [PROVIDER_SCOPE], props: { agentId: token === "bad-grant" ? "bad" : approvedAgent } };
    } } };
    const call = (token?: string) => server.fetch(new Request(resource, { headers: token ? { authorization: `Bearer ${token}` } : {} }), env, ctx);
    expect((await call()).status).toBe(401);
    expect((await call("invalid")).status).toBe(401);
    expect((await call("narrow")).status).toBe(403);
    expect((await call("bad-grant")).status).toBe(403);
    const valid = await call("valid");
    expect(valid.status).toBe(200);
    expect(await valid.text()).toBe(approvedAgent);
  });
});
