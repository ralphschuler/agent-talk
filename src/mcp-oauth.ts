import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const MCP_SCOPE = "agent-talk:relay";
export type OAuthConfig = { issuer: string; resource: string; jwksUri: string };

function httpsUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Invalid OAuth URL");
  return url;
}

export function validateOAuthConfig(config: OAuthConfig): OAuthConfig {
  const issuer = httpsUrl(config.issuer);
  const resource = httpsUrl(config.resource);
  const jwks = httpsUrl(config.jwksUri);
  if (issuer.href !== config.issuer || resource.href !== config.resource || jwks.href !== config.jwksUri || resource.pathname !== "/mcp") {
    throw new Error("Invalid OAuth configuration");
  }
  return config;
}

export function protectedResourceMetadata(config: OAuthConfig) {
  validateOAuthConfig(config);
  return { resource: config.resource, authorization_servers: [config.issuer], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ["header"] };
}

export async function verifyMcpAccessToken(token: string, config: OAuthConfig, getKey?: JWTVerifyGetKey): Promise<void> {
  validateOAuthConfig(config);
  if (typeof token !== "string" || token.length > 8192) throw new Error("Invalid access token");
  const resolver = getKey ?? createRemoteJWKSet(new URL(config.jwksUri), { timeoutDuration: 5000 });
  const { payload } = await jwtVerify(token, resolver, {
    issuer: config.issuer, audience: config.resource, algorithms: ["RS256", "ES256", "EdDSA"], requiredClaims: ["exp", "iat", "sub"], maxTokenAge: "1h",
  });
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.scope !== "string" || !payload.scope.split(" ").includes(MCP_SCOPE)) {
    throw new Error("Insufficient scope");
  }
}
