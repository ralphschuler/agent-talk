import { OAuthAuthorizationServer } from "@cloudflare/workers-oauth-provider";
import { PROVIDER_SCOPE } from "./mcp-provider-resource.ts";

export interface IssuerEnv { OAUTH_KV: KVNamespace; PORTAL_ORIGIN: string; }

/** Only trusted configuration supplies the issuer and its one allowed resource. */
export function oauthIssuer(env: IssuerEnv): OAuthAuthorizationServer<IssuerEnv> {
  const origin = new URL(env.PORTAL_ORIGIN);
  if (origin.protocol !== "https:" || origin.origin !== env.PORTAL_ORIGIN || origin.pathname !== "/" || origin.username || origin.password || origin.search || origin.hash) throw new Error("Invalid issuer configuration");
  return new OAuthAuthorizationServer<IssuerEnv>({
    issuer: env.PORTAL_ORIGIN,
    resources: [env.PORTAL_ORIGIN + "/mcp"],
    scopesSupported: [PROVIDER_SCOPE],
    clientRegistrationEndpoint: "/oauth/register",
  });
}
