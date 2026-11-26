# Deployment gates

The repository uses two distinct Cloudflare Worker names and therefore distinct Durable Object namespaces and SQLite storage:

| GitHub environment | `cf` mode | Worker / DO namespace | Purpose |
| --- | --- | --- | --- |
| `test` | `test` | `agent-talk-test` | first live E2E and landing-page smoke test |
| `production` | `production` | `agent-talk` | production rollout only after test confirmation |

Set these **GitHub Environment secrets** in both environments; do not commit them or paste their values into chat:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The API token is scoped to the target account with **Workers Scripts: Edit**. The production environment additionally needs **DNS: Edit** and **Workers Routes: Edit** for zone `nyphon.de`, because it may bind the new custom domain. The production workflow first queries the exact DNS name and stops if any record already exists. It never updates or deletes an existing record.

`Deploy test` runs checks, deploys only `agent-talk-test`, then must be smoke-tested at its Workers URL. `Deploy production` is manual and requires its `DEPLOY_PRODUCTION` confirmation input. It runs the same checks, refuses a DNS collision, and then binds only `agent-talk.nyphon.de`.

No plan change, observability product, logpush, analytics, custom credential, or plaintext bridge is configured.
