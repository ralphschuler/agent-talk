// These helpers do not persist sessions or expose routes. The caller must consume
// each authorization transaction atomically before exchanging its code.
export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  callback: string;
}

export interface AuthorizationTransaction {
  state: string;
  verifier: string;
  expiresAt: number;
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function randomValue(): string {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}

function validateConfig(config: GitHubOAuthConfig): void {
  const callback = new URL(config.callback);
  if (callback.protocol !== "https:" || callback.username || callback.password || callback.hash || callback.search) {
    throw new Error("The OAuth callback must be an exact HTTPS URL.");
  }
  if (!config.clientId || !config.clientSecret) throw new Error("Missing OAuth configuration.");
}

export async function beginAuthorization(config: GitHubOAuthConfig, now = Date.now()): Promise<{
  transaction: AuthorizationTransaction;
  url: string;
}> {
  validateConfig(config);
  const transaction = { state: randomValue(), verifier: randomValue(), expiresAt: now + 5 * 60_000 };
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(transaction.verifier));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.callback);
  url.searchParams.set("scope", "");
  url.searchParams.set("state", transaction.state);
  url.searchParams.set("code_challenge", encode(new Uint8Array(digest)));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("allow_signup", "false");
  return { transaction, url: url.toString() };
}

export async function exchangeAuthorization(
  config: GitHubOAuthConfig,
  transaction: AuthorizationTransaction,
  state: string,
  code: string,
  fetcher: typeof fetch = fetch,
  now = Date.now(),
): Promise<string> {
  validateConfig(config);
  if (!state || state !== transaction.state || !code || now >= transaction.expiresAt) {
    throw new Error("Invalid or expired authorization.");
  }
  const response = await fetcher("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: config.clientId, client_secret: config.clientSecret, code,
      redirect_uri: config.callback, code_verifier: transaction.verifier,
    }),
    redirect: "manual",
  });
  if (!response.ok) throw new Error("GitHub authorization failed.");
  const token = await response.json() as { access_token?: unknown; scope?: unknown };
  if (typeof token.access_token !== "string" || !token.access_token || token.scope !== "") {
    throw new Error("GitHub authorization returned unexpected permissions.");
  }
  const userResponse = await fetcher("https://api.github.com/user", {
    headers: { "Accept": "application/vnd.github+json", "Authorization": `Bearer ${token.access_token}`, "User-Agent": "agent-talk-owner-portal" },
    redirect: "manual",
  });
  if (!userResponse.ok) throw new Error("GitHub identity lookup failed.");
  const user = await userResponse.json() as { id?: unknown };
  if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new Error("GitHub returned an invalid user ID.");
  }
  return String(user.id);
}
