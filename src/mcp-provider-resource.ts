import { OAuthResourceServer, insufficientScope, type AuthorizationServerBinding } from "@cloudflare/workers-oauth-provider";

import { agentId } from "./validation.ts";

export const PROVIDER_SCOPE = "agent-talk:relay";
export type McpGrant = { agentId: string };
export type ProviderEnv = { AUTH_SERVER: AuthorizationServerBinding<McpGrant> };

/** Build only from trusted deployment configuration, never from an incoming Host header. */
export function createProviderResource<Env extends ProviderEnv>(
  resource: string,
  issuer: string,
  handler: (request: Request, env: Env, grantedAgentId: string) => Promise<Response>,
): OAuthResourceServer<Env, McpGrant> {
  const resourceUrl = new URL(resource);
  const issuerUrl = new URL(issuer);
  if (resourceUrl.protocol !== "https:" || resourceUrl.pathname !== "/mcp" || resourceUrl.search || resourceUrl.hash || resourceUrl.username || resourceUrl.password || resourceUrl.href !== resource || issuerUrl.protocol !== "https:" || issuerUrl.search || issuerUrl.hash || issuerUrl.username || issuerUrl.password || (issuerUrl.href !== issuer && issuerUrl.origin !== issuer)) throw new Error("Invalid provider configuration");
  return new OAuthResourceServer<Env, McpGrant>({
    resourceMetadata: { resource, authorization_servers: [issuer] },
    requiredScopes: [PROVIDER_SCOPE],
    validateToken: (env) => (audience, token) => env.AUTH_SERVER.validateToken(audience, token),
    handler: { async fetch(request, env, ctx) {
      if (!ctx.auth.scope.includes(PROVIDER_SCOPE)) return insufficientScope(ctx.auth, [PROVIDER_SCOPE]);
      if (!ctx.props || !agentId(ctx.props.agentId)) return new Response("Invalid grant", { status: 403, headers: { "cache-control": "no-store" } });
      return handler(request, env, ctx.props.agentId);
    } },
  });
}
