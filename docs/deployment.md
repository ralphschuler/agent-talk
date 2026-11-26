# Deployment gates

The repository uses two distinct Cloudflare Worker names and therefore distinct Durable Object namespaces and SQLite storage:

| GitHub environment | `cf` mode | Worker / DO namespace | Purpose |
| --- | --- | --- | --- |
| `test` | `test` | `agent-talk-test` | first live E2E and landing-page smoke test |
| `production` | `production` | `agent-talk` | production rollout only after test confirmation |

Set these **GitHub Environment secrets** in both environments; do not commit them or paste their values into chat:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Use a token scoped to the target account with permission to read and update the existing Workers and inspect their SQLite namespaces. Production additionally reads the active zone and the existing Workers custom domain assignment.

Both deployments are manual. Test requires a successful Verify run on the same commit. Production requires a successful test deployment on that commit and the `DEPLOY_PRODUCTION` confirmation.

Each preflight requires the existing Worker and its exact `PROJECT_OWNER` marker. Production also requires the existing binding for `agent-talk.nyphon.de` on the active `nyphon.de` zone in the selected account. The workflow uploads a version and activates that exact version at 100% on the owned Worker. It checks the target again before and after activation. These updates leave DNS records, trigger configuration and custom domain bindings untouched.

Each environment verifies its SQLite namespaces and runs the synthetic MCP exchange against its live URL. The smoke compares the full Git commit in `/healthz` with the workflow commit and checks the live landing page bytes against the built static asset. CI logs record the commit, Cloudflare version ID and HTML SHA-256.

## Upgrade and recovery

The released 1:1 adapter at `4db86011a5afbfe20528faa366a7e1c11df270b9` can continue using its own version-1 profile on the expanded relay. The new adapter upgrades a stopped endpoint's profile atomically on first use. After that upgrade, use an adapter that understands version 2 for that file. CI starts the released adapter, upgrades its actual saved inbox and identity, and checks old invitations and messages across both versions.

Group tables and indexes are additive. Keep the Directory and Mailbox bindings attached to the existing stores when recovering a Worker. A Worker rollback to the original pilot pauses group and typed-message operations until the expanded protocol returns. Preserve pending operations and deployed storage. Record the current Worker version ID and exact Git SHA before any operator-authorized recovery. For a lost or rolled-back MLS endpoint, use a fresh identity and an owner-approved removal and readmission; an earlier sending state can reuse a message generation.

On 26 November 2026 the owner approved using the existing Workers Paid subscription after the dashboard plan check. These workflows never change subscriptions.

No plan change, observability product, logpush, analytics, custom credential, or plaintext bridge is configured.
