import { expect, it } from "vite-plus/test";
import { generateKeyPair, SignJWT } from "jose";
import { guardMcpRequest, MCP_SCOPE, protectedResourceMetadata, verifyMcpAccessToken } from "../src/mcp-oauth.ts";

const config = { issuer: "https://issuer.example/", resource: "https://relay.example/mcp", jwksUri: "https://issuer.example/jwks" };
it("advertises only the configured HTTPS resource and issuer", () => {
  expect(protectedResourceMetadata(config)).toEqual({ resource: config.resource, authorization_servers: [config.issuer], scopes_supported: [MCP_SCOPE], bearer_methods_supported: ["header"] });
  expect(() => protectedResourceMetadata({ ...config, issuer: "http://issuer.example/" })).toThrow();
  expect(() => protectedResourceMetadata({ ...config, resource: "https://relay.example/mcp?token=x" })).toThrow();
});
it("fails closed without configuration and rejects plain HTTP", async () => {
  expect((await guardMcpRequest(new Request(config.resource), undefined))?.status).toBe(503);
  expect((await guardMcpRequest(new Request("http://relay.example/mcp"), config))?.status).toBe(403);
});
it("requires a valid signature, exact issuer, audience, expiry and scope", async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const resolver = async () => publicKey;
  const token = (issuer: string, audience: string, scope: string, expires = "2m") => new SignJWT({ scope }).setProtectedHeader({ alg: "ES256" }).setIssuer(issuer).setAudience(audience).setSubject("synthetic").setIssuedAt().setExpirationTime(expires).sign(privateKey);
  await expect(verifyMcpAccessToken(await token(config.issuer, config.resource, MCP_SCOPE), config, resolver)).resolves.toBeUndefined();
  await expect(verifyMcpAccessToken(await token("https://other.example/", config.resource, MCP_SCOPE), config, resolver)).rejects.toThrow();
  await expect(verifyMcpAccessToken(await token(config.issuer, "https://other.example/mcp", MCP_SCOPE), config, resolver)).rejects.toThrow();
  await expect(verifyMcpAccessToken(await token(config.issuer, config.resource, "other"), config, resolver)).rejects.toThrow();
  await expect(verifyMcpAccessToken(await token(config.issuer, config.resource, MCP_SCOPE, "0s"), config, resolver)).rejects.toThrow();
  const wrong = await generateKeyPair("ES256");
  await expect(verifyMcpAccessToken(await token(config.issuer, config.resource, MCP_SCOPE), config, async () => wrong.publicKey)).rejects.toThrow();
});
