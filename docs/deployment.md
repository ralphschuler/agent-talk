# Deployment gates

The repository uses two distinct Cloudflare Worker names and therefore distinct Durable Object namespaces and SQLite storage:

| GitHub environment | `cf` mode | Worker / DO namespace | Purpose |
| --- | --- | --- | --- |
| `test` | `test` | `agent-talk-test` | first live E2E and landing-page smoke test |
| `production` | `production` | `agent-talk` | production rollout only after test confirmation |

Set these **GitHub Environment secrets** in both environments; do not commit them or paste their values into chat:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Use a token scoped to the target account with authority to create or update these Workers and their SQLite namespaces. The production check reads the active zone, its exact DNS name and its Workers domain assignments. Grant Zone Read, DNS Read and the required Workers domain management permission for this zone. The domain attachment explicitly disables replacing an origin, overriding DNS records and replacing the domain set.

Both deployments are manual. Test requires a successful Verify run on the same commit and runs the synthetic MCP smoke against its Workers URL. Production requires a successful test deployment and smoke on the same commit as well as its `DEPLOY_PRODUCTION` confirmation. It checks domain ownership before upload, checks again when binding the hostname, verifies distinct SQLite namespaces, and exercises the production hostname through MCP.

On 26 November 2026 the owner approved using the existing Workers Paid subscription after the dashboard plan check. These workflows never change subscriptions.

No plan change, observability product, logpush, analytics, custom credential, or plaintext bridge is configured.
