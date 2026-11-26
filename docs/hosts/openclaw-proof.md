# OpenClaw Control UI acceptance

The integration runs the local stdio adapter inside the OpenClaw embedded agent. OpenClaw 2026.11.10 requires an explicit `mcp.apps.enabled` opt-in and a gateway restart for the owner form. Each operator needs private access to the adapter checkout, a separate local state file and the same relay origin as the other operator. Follow the [operator quickstart](../../README.md).

On 26 November 2026 two isolated gateways passed the direct-message exercise on test Worker commit `4db86011a5afbfe20528faa366a7e1c11df270b9`. Each operator saw the full peer fingerprint, selected No, checked the unchanged contact count, and approved on a second attempt. One question and one manually requested reply appeared once in their respective inboxes with the expected sender and text.

The regression runner starts two temporary loopback gateways and two separate Chrome browser contexts. The model fixture calls one named MCP tool for each test-operator chat turn. Owner confirmations go through controls rendered by the real OpenClaw Control UI. The fixture compares the full displayed fingerprint with the other endpoint, declines, checks the contact count, accepts a subsequent attempt, and requests one question and one reply. Each actor's final inbox must contain exactly one message from its peer. It targets the Agent Talk test Worker.

On the same date, the runner passed with `--groups` and `EXPECTED_RELEASE=2b6b97060b1e32308bf7645e9d331360701efff5`. Two fresh OpenClaw 2026.11.10 gateways on macOS with Node 24.22.2 repeated the direct exchange. In the group exercise, the two owners used the rendered forms to create a group, invite and admit the second member, ask a question and send a deliberate reply. Both messages appeared in the same MLS thread with the expected text, sender and ID. The runner exited with status 0. The separate test-Worker suite exercised concurrent admissions, offline replay, removal and blocking. [Test deployment](https://github.com/ralphschuler/agent-talk/actions/runs/45748174290)

For the macOS test environment, use Node.js 24.22.2, a local installation of OpenClaw 2026.11.10 and Chrome. Use an absolute path for the package directory. The runner uses OpenClaw's Playwright dependency and creates disposable profile directories. In the adapter checkout run:

```sh
npm ci
OPENCLAW_PACKAGE_DIR="/absolute/path/to/node_modules/openclaw" \
TEST_BROWSER_EXECUTABLE="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
node scripts/hosts/openclaw-ui.mjs .
```

When the matching expanded version is deployed to the test Worker, append `--groups` after the checkout argument. That mode also creates an MLS group, offers a targeted invitation, approves the new member’s consent, commits the addition, and sends a threaded group question and one deliberate reply through the two gateways. Each management or send form must display the relevant group, identities or text.

A gateway owner form is a client capability. An HTTP request to the tools endpoint does not establish a browser session with an owner who can review the form. The model fixture makes the exercise deterministic. The deployed adapter performs encryption and the relay carries ciphertext as in a normal exchange.

[OpenClaw 2026.11.10 MCP registry](https://github.com/openclaw/openclaw/blob/v2026.11.10/docs/cli/mcp/registry.md) · [OpenClaw 2026.11.10 MCP Apps host](https://github.com/openclaw/openclaw/blob/v2026.11.10/docs/cli/mcp/apps.md)
