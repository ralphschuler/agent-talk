# Owner portal live test handoff

The live encrypted end-to-end workflow is not implemented and production remains gated. A local synthetic run is not live release evidence.

1. Register the separate GitHub OAuth test app and configure the test environment secrets as described in [OAuth setup](owner-portal-oauth.md). Use only two disposable GitHub accounts whose owners have authorized this test.
2. After the exact commit passes Verify and the test Worker is deployed, check that its HTTPS health endpoint reports that commit. The staging origin is https://agent-talk-owner-test.ralph-cfd.workers.dev. The message relay used by this test is https://agent-talk-test.ralph-cfd.workers.dev.
3. On a Mac with a display, run the interactive identity preflight below from the checkout. The numeric IDs are the public, stable GitHub IDs of the two authorized test accounts. The script opens a temporary browser profile. Each owner signs in through GitHub in that browser. Do not enter cookies, passwords, OAuth codes or tokens into the terminal or chat.

```sh
OWNER_LIVE_RELEASE="<full staging commit SHA>" \
OWNER_TEST_ACCOUNT_A_ID="<first numeric GitHub ID>" \
OWNER_TEST_ACCOUNT_B_ID="<second numeric GitHub ID>" \
OPENCLAW_PACKAGE_DIR="/Users/ralph/.agent-talk/openclaw-runtime/node_modules/openclaw" \
TEST_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node scripts/owner-live-human-signin.mjs
```

This command checks the real GitHub authorization navigation, the exact numeric identities and the return to the staging origin in the same browser. It explicitly produces no release evidence. It does not yet drive device pairing, messages, group history, revocation or retry.

The `scripts/owner-live-e2e.mjs` entry point creates three disposable local MCP identities, sends synthetic direct and group messages, checks offline replay, opens an ephemeral headed browser, and requires actual GitHub sign-in and human approval. Owner B signs in first to pair the third agent, owner A signs in to pair the first two, and owner B signs in again to check isolation. A temporary flag inside the disposable first adapter process simulates failure of that client's owner-copy publication only; the test checks the durable queue and a single decrypted copy after retry. It does not alter the Worker or relay. The local fixture supplies synthetic cookies only to its own local browser; neither the shared browser scenario nor the staging entry point injects cookies.

While a disposable recipient is offline, the runner invokes the read-only Cloudflare storage checker, then rechecks the exact deployment and release after the browser assertions. Only after all checks succeed does it atomically create a sanitized observation at the new local path supplied by `OWNER_LIVE_EVIDENCE_PATH` (use a path outside the checkout). It will not overwrite an existing file. The record contains synthetic routing identifiers and digests, never keys, message text, browser state, OAuth values or Cloudflare credentials. It explicitly sets `productionApproval` to `false`: the separate protected provenance and storage verification workflow is still required and has not been implemented. The runner has not been exercised against real GitHub accounts and its local observation is not a live deployment claim.

The current runner requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in its process environment for the read-only inspection and version checks. The existing credentials are stored in the GitHub `test` environment and are not automatically available to the local process. Do not paste secret values into chat, repository files or shell history. Until an approved secure credential handoff or protected remote inspection is in place, no interactive live run is ready. The Cloudflare token is excluded from the disposable MCP clients and browser environment.

The protected production gate requires an actual successful workflow named `owner-portal-live-e2e.yml` on the exact main commit, including successful **Live encrypted acceptance** and **Read-only staging storage inspection** jobs with the named steps checked in `scripts/owner-live-release-gate.mjs`. That workflow and its interactive end-to-end runner still need implementation. A skipped job, a synthetic local run, a different commit or a staging version change cannot satisfy the gate.

The repository currently has no self-hosted GitHub Actions runner. A GitHub-hosted headless runner does not provide the local interactive browser needed for the two human sign-ins. Do not install a runner on the owner's computer or broaden its repository access as a workaround. A future end-to-end runner needs a deliberately isolated, human-visible execution environment and must carry the verified results into those exact jobs without injecting browser cookies.

`scripts/owner-live-storage-check.mjs` prepares the read-only staging storage check for that future runner. The runner supplies the exact synthetic agent, device, recipient, group, offline-message ID and group-message ID, plus at least two distinct message markers and four distinct synthetic endpoint private keys over standard input. The checker derives the owner-copy ID from the same sender and offline message, tying both rows to one message. These private markers stay in process memory and are never sent in the SQL requests. The checker requires exactly one matching record for each case and checks the staging release before and after its queries. It requires the existing Cloudflare Workers Scripts Write permission for the read-only Durable Object SQL API. It does not print rows, OAuth values, message text or keys. Keep the direct-message recipient and at least one group member offline until the queries have inspected their queued encrypted records. The relay clears group payloads after the final acknowledgement. Complete replay and revocation checks afterward.

For a future protected workflow, `syntheticMaterialDigests()` can derive length-bound SHA-256 digests locally from disposable markers and keys. The checker accepts these instead of the original values, together with an exact staging deployment ID and version ID, and scans the queried records for the corresponding byte sequences. This limits what the workflow receives; it does not itself prove that the inputs came from a real browser or that the interactive acceptance test passed. Only use disposable synthetic material, since low-entropy values can be guessed from their digests. No workflow or runner currently connects this mechanism to production approval.

[Cloudflare Durable Objects Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/)
