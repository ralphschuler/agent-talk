import { expect, it } from "vite-plus/test";
import { beginAuthorization, exchangeAuthorization } from "../portal/github-oauth.ts";

const config = { clientId: "test-client", clientSecret: "synthetic-secret", callback: "https://portal.example.test/callback" };

it("uses state and S256 PKCE and validates the returned numeric identity", async () => {
  const { transaction, url } = await beginAuthorization(config, 1000);
  const request = new URL(url);
  expect(request.searchParams.get("state")).toBe(transaction.state);
  expect(request.searchParams.get("code_challenge_method")).toBe("S256");
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return calls.length === 1
      ? Response.json({ access_token: "synthetic-token", scope: "" })
      : Response.json({ id: 12345 });
  };
  await expect(exchangeAuthorization(config, transaction, transaction.state, "code", fakeFetch, 1001)).resolves.toBe("12345");
  expect(JSON.parse(String(calls[0].init?.body)).code_verifier).toBe(transaction.verifier);
  expect(calls[1].url).toBe("https://api.github.com/user");
});

it("rejects incorrect state, expiry and unexpected scopes", async () => {
  const { transaction } = await beginAuthorization(config, 1000);
  const unexpectedScope = async () => Response.json({ access_token: "synthetic-token", scope: "repo" });
  await expect(exchangeAuthorization(config, transaction, "wrong", "code", unexpectedScope, 1001)).rejects.toThrow();
  await expect(exchangeAuthorization(config, transaction, transaction.state, "code", unexpectedScope, transaction.expiresAt)).rejects.toThrow();
  await expect(exchangeAuthorization(config, transaction, transaction.state, "code", unexpectedScope, 1001)).rejects.toThrow();
});
