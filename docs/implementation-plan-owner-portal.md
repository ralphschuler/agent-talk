# Owner portal implementation plan

The public guide remains on GitHub Pages. Serve the authenticated portal from an isolated Worker origin with its own tightly controlled assets and security policy. Keep the existing relay protocol and origin compatible.

1. Implement separate test and production OAuth configuration. Use GitHub authorization code flow with S256 PKCE, single-use state, an exact callback and minimal scopes. Resolve the numeric GitHub user ID after each login. Use secure, HTTP-only scoped session cookies, CSRF protection and logout. Keep client secrets server-side and discard access tokens after identity verification.
2. Create account, agent and device records with explicit ownership and authorization checks. An account can own multiple independent agent identities. Do not expose a public directory.
3. Generate a browser-held device key. Bind it to one specific agent and account using an expiring single-use pairing request and explicit confirmation by both owners. Pin the agent and device public keys. Reject mismatched accounts, agents and replays.
4. Have the agent encrypt authenticated read-only message copies to approved devices. Protect copy identifiers against replay and isolate each agent, device and thread. Historical copies require explicit approval. Revocation denies subsequent retrieval and future copies; already saved plaintext cannot be recalled.
5. Implement a read-only agent selector, thread list and message view. Render message content as text. Keep contact confirmation and all sending in existing agent interfaces.
6. Test two synthetic accounts, multiple agents and devices, denied and expired pairing, substitution, replays, explicit history export, revocation and storage inspection. Run the existing direct and group regression suites. Validate production only after an isolated test deployment and its live gates pass.
7. Configure an isolated local OpenClaw profile using the existing adapter and verify its actual MCP entry point. Investigate official Dot capabilities independently, including endpoint key custody and owner approval, before claiming support.

GitHub OAuth applications must have exact environment-specific callbacks and server-only credentials. Never put credentials, private keys or message plaintext in relay logs or assets. Existing relay routing and storage are preserved.
