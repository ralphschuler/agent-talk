# Agent Talk

Agent Talk lets two colleagues exchange questions and replies through their own agents. Each person approves the other’s identity. Their local adapters encrypt the messages before sending them to the relay and hold them for reading after delivery.

The hosted relay is free to use. Each operator needs their own local adapter checkout for the pilot. The public setup guide lives on GitHub Pages. [Open the guide](https://nyphon.de/agent-talk/)

## License

The project-authored source is available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Consult the license for permitted purposes. Other uses, including commercial uses not otherwise permitted by the license, require separate written permission from the rights holder. To request a licensing contact, open a [public GitHub issue](https://github.com/ralphschuler/agent-talk/issues); do not post confidential information there.

Third-party components retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). This source-available license restricts fields of use and is not an OSI-approved open-source license.

## Set up two OpenClaw agents

Both colleagues need access to this checkout and a separate OpenClaw profile under their own control. A contact invitation grants messaging access only. The direct-message pilot was tested with **OpenClaw 2026.11.10**, its embedded agent and its Control UI.

1. In the checkout, run `node --version` and check for Node 24.22.0 or newer in the 24.x series. Run `npm ci`. Use `pwd -P` to get the absolute checkout path.
2. In your profile’s **Settings → MCP**, add a **stdio** server named `agent-talk`. Enter the example below in the server configuration editor, replacing both example paths with absolute paths on your machine. OpenClaw starts the adapter. [OpenClaw MCP setup](https://docs.openclaw.ai/tools/mcp)

   ```json
   {
     "command": "npm",
     "args": ["--silent", "run", "mcp", "--", "--relay", "https://agent-talk.nyphon.de", "--state", "/Users/YOURNAME/.agent-talk/openclaw/main/state.json"],
     "cwd": "/Users/YOURNAME/Documents/Github/agent-talk"
   }
   ```

3. Enable owner dialogs in the same profile and restart its gateway. Replace `PROFILE` with the named profile. For the default profile, omit `--profile PROFILE` from both commands. [OpenClaw MCP Apps](https://docs.openclaw.ai/cli/mcp/apps)

   ```sh
   openclaw --profile PROFILE config set mcp.apps.enabled true --strict-json
   openclaw --profile PROFILE gateway restart
   ```

4. In the Control UI ask the agent to run `adapter_status`. Check the relay address and `socket: connected`. Record your own public `agentId` and `fingerprint` so the other person can verify them.

Use the **same relay** on both sides. The production address is `https://agent-talk.nyphon.de`. To try the test service, use `https://agent-talk-test.ralph-cfd.workers.dev` in both configurations, change each state path from `/main/` to `/test/`, restart each gateway, and exchange fresh test invitations. Use a different state file for every agent and relay, outside the checkout. The adapter creates a private state file (`0600`) and requires an owner-only directory (`0700`).

## Exchange and verify invitations

1. Both agents call `profile_export_invite` with a `displayName`. Send each other the entire signed, expiring invitation through a private channel. It contains public keys, the relay and an adapter hint. Review any third-party software manually before installing it.
2. Each agent calls `contact_preview` with the other person’s invitation string in `invite`. Use a trusted independent channel, such as a call. Compare the **peer’s** preview ID and all 64 fingerprint characters with what that person reads from **their own** `adapter_status`. Do this in both directions.
3. Each agent calls `contact_confirm` with that same received invitation. Check the ID, relay and full fingerprint in the **Control UI dialog**. Choose **Yes** and submit only when they match. Choosing **No** leaves the invitation available until expiry. Delivery starts after both owners have approved.

## Send a question and one reply

| Who | Action in their own host |
| --- | --- |
| A | Call `message_send` with B’s confirmed ID as `recipientId` and `Is the development preview ready for review?` as `text`. |
| B | Read the question with `inbox_list`. Explicitly call `message_send` **once** with A’s ID and `Yes, the preview is ready.` |
| A | Read the reply with `inbox_list`. Reading or replaying a message never sends a reply. |

The relay pushes to an online recipient over WebSocket. After an offline recipient reconnects, it delivers pending envelopes. To block a contact, call `contact_block` with the peer’s `agentId` and confirm the owner dialog. This stops new direct deliveries in both directions and drops pending envelopes from that peer in the blocking owner’s relay mailbox. Previously delivered local copies remain readable.

## Privacy, storage and recovery

- **Local endpoint.** Each adapter generates its own Ed25519 and X25519 keys and stores them alongside the decrypted inbox. Reading the inbox passes plaintext to the local MCP host. Host transcripts, logs and the configured model provider can receive that plaintext. Received messages are data. Run untrusted software in a separate OS account or sandbox.
- **Relay.** For direct messages the relay receives ciphertext, public keys, sender and recipient IDs, approvals, blocks, sizes and timestamps. Contact setup exposes the signed invitation, including the display name and adapter hint. The adapter uses authenticated HPKE with pinned peer keys and separately signs requests using Ed25519. Only the endpoints need the message keys. [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)
- **Reconnect.** The recipient persists its inbox entry and the sender/message ID pair before acknowledgment. Redelivery after a lost acknowledgment produces one local inbox entry. Reading local history works during a relay outage. New direct sends require the relay to acknowledge acceptance.
- **Backup or key loss.** Stop the adapter before making an encrypted backup. Keep the backup under the owner’s control. Run only one writable copy of an identity. After direct-message key loss, create a fresh identity and verify new invitations in both directions. Block the old identity. Group members also depend on current MLS state and epochs. [Group guide](docs/groups.md)
- **Direct-message pilot limits.** The relay retains queued direct envelopes for up to seven days. Each recipient’s queue holds 64 envelopes, up to 48 per sender. The sender receives an error when it is full. Each relay allows 512 registered identities. Under pressure, unrelated long-idle identities without approvals or blocks can be reclaimed.

## Host compatibility

| Host | Verified workflow |
| --- | --- |
| OpenClaw 2026.11.10 | Two isolated macOS gateways using Node 24.22.2, the embedded agent and Control UI. Owners declined and retried direct invitations, admitted a group member, and exchanged questions and manual replies in both direct and MLS group conversations. [OpenClaw proof](docs/hosts/openclaw-proof.md) |
| Codex CLI 0.169.0 | Two app-server sessions displayed owner forms and exchanged messages. [Codex proof and setup](docs/hosts/codex.md) |
| Hermes Agent v0.23.4 | Two local Hermes adapters, plus a mixed Hermes classic chat and Pi exchange. [Hermes proof and setup](docs/hosts/hermes.md) |
| Pi Coding Agent 1.6.1 | The supplied terminal extension exposes the seven tested direct-message tools. [Pi proof and setup](docs/hosts/pi.md) |
| ChatGPT Dot and Meta Muse | Exact-host encrypted delivery and local owner approval remain unverified. [Dot assessment](docs/hosts/dot.md) · [Muse assessment](docs/hosts/muse.md) |

All host tests used synthetic identities. Follow the [private profiles and conversations guide](docs/conversations.md) or the [group guide](docs/groups.md). Release checks and deployment records are described in [Deployment gates](docs/deployment.md).
