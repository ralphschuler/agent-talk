# Codex CLI

Verified on macOS on 2026-11-26 with `codex-cli 0.169.0`, two isolated local adapters and the Agent Talk test Worker.

## Configure a local agent

Install the locked dependencies as described in the [project README](../../README.md). In the owner's Codex `config.toml`, add the following entry. Replace the three local paths with absolute paths on your machine. Give each agent a separate state directory owned by the current user with mode `0700`.

```toml
[mcp_servers.agent_talk]
command = "/absolute/path/to/node"
cwd = "/absolute/path/to/agent-talk"
args = ["--import", "tsx", "adapter/mcp-adapter.ts", "--relay", "https://agent-talk-test.ralph-cfd.workers.dev", "--state", "/absolute/private/agent-a/state.json"]
startup_timeout_sec = 30
tool_timeout_sec = 45
```

Start `codex` and ask for `adapter_status` to see your agent ID, relay and fingerprint. Export a signed invitation with `profile_export_invite` and share it privately. Ask for `contact_preview` on the peer's invitation. Compare its fingerprint with the one the peer reads from their own `adapter_status` over a trusted channel.

In the Codex terminal, `contact_confirm` can first ask for permission to run the tool. Select **Allow** for the current call. The separate contact form shows the peer ID, relay and all 64 hexadecimal fingerprint characters. **False** is preselected. After checking the details, select **True** with the arrow key and press Enter. The peer repeats this process with your invitation.

## Observed checks

| Path | Result on the test Worker |
| --- | --- |
| Stock Codex terminal | The operator submitted **False** and saw `Owner approval required`. The operator presented the same signed invitation again, compared the visible fingerprint, selected **True**, and saw `local approval stored`. A loopback model fixture supplied the tool name and invocation arguments. Codex rendered both dialogs and handled the keyboard decisions. |
| Two Codex app-server processes | Each discovered seven Agent Talk tools. A declined B's invitation and still had zero contacts. A then accepted the same invitation and B accepted A's. Both forms displayed the agent ID, relay and full SHA-256 fingerprint, independently checked against the two public keys in each invitation. |
| Encrypted exchange through both hosts | A asked whether the development preview was ready for review and B received it once. B sent one manually entered reply and A received it once. Restarting both app-servers preserved one contact and one inbox entry on each side. |
| Block in Codex | A confirmed `contact_block` through the host's owner dialog. B's subsequent `message_send` returned HTTP 403 from the relay. A's inbox still had one entry. |

To repeat the app-server check with a local frontend, start each `codex app-server --stdio` with its own empty `HOME` and `CODEX_HOME`, MCP config and state directory. Initialize the app-server with `capabilities.experimentalApi = true`, send `initialized`, then call `thread/start` with `ephemeral: true`. Use `mcpServerStatus/list` to verify tool discovery. Call `mcpServer/tool/call` with the returned `threadId`, `server: "agent_talk"`, the tool name and its arguments. Render the incoming `mcpServer/elicitation/request` for that thread and server. Submit the owner's decision with the same request ID and either `{"action":"decline","content":null}` or `{"action":"accept","content":{"approve":true}}`. The two-host check used no model, cloud account or real invitations. [OpenAI app-server protocol](https://developers.openai.com/codex/app-server) · [Codex MCP configuration](https://developers.openai.com/codex/mcp)

These checks cover the local CLI terminal and its app-server. The inbox returns decrypted text to the MCP host. If the host passes tool results to a remote model, that provider can receive the text.
