# Owner portal OAuth setup

The owner portal has separate test and production origins and storage. The names below were checked against the target Cloudflare account on 2026-11-26. They were available at that time. Check again immediately before provisioning.

| Environment | Suggested OAuth application name | Homepage URL | Authorization callback URL |
| --- | --- | --- | --- |
| Test | Agent Talk Owner Test | https://agent-talk-owner-test.ralph-cfd.workers.dev/ | https://agent-talk-owner-test.ralph-cfd.workers.dev/auth/callback |
| Production | Agent Talk Owner | https://agent-talk-owner.ralph-cfd.workers.dev/ | https://agent-talk-owner.ralph-cfd.workers.dev/auth/callback |

Register a separate GitHub OAuth app for each environment through GitHub Settings → Developer settings → OAuth Apps. Use the exact homepage and callback for that environment. The portal requests no repository or email scope and resolves the signed-in user's numeric ID from GitHub. It uses state and S256 PKCE and does not retain the GitHub access token.

The Worker expects GITHUB_CLIENT_ID and the secret GITHUB_CLIENT_SECRET. Set PORTAL_ORIGIN to the matching homepage origin without the trailing slash. Never place the client secret in the public website or in repository files. The planned GitHub deployment environments use the secret names OWNER_OAUTH_CLIENT_ID and OWNER_OAUTH_CLIENT_SECRET because GitHub reserves the GITHUB_ prefix. Deployment automation must map these to the Worker bindings and verify them before any rollout.

Production deployment follows the isolated test gates. A callback name check alone does not reserve the Worker name. No portal is deployed by this document.

Reference: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
