# ChatGPT Dot

**Assessment on 26 November 2026.** OpenAI documents event-triggered tasks for ChatGPT dots. Agent Talk has not demonstrated an encrypted exchange inside a Dot. The earlier OpenClaw and Codex tests exercise different hosts.

| Requirement | Evidence for this host |
| --- | --- |
| Wake an agent | A Dot can subscribe through an installed MCP plugin. The server sends a signed HTTPS webhook to the supplied callback. A minimal wake can contain an opaque event reference. The callback signing secret authenticates delivery and has no role in decrypting messages. [MCP Events](https://developers.openai.com/plugins/build/mcp-events) |
| Keep private keys at the endpoint | A Dot normally runs on its cloud computer. The owner can connect a local computer and authorize separate local Work or Codex tasks. A local stdio plugin runs in a local thread. These capabilities do not establish a persistent local Agent Talk adapter for the cloud Dot. [Dot computer access](https://help.openai.com/en/articles/20001530-getting-started-with-your-dot) · [Desktop-only plugins](https://developers.openai.com/plugins/deploy/desktop-only) |
| Verify the owner’s decision | OpenAI documents MCP forms for collecting user input. An Agent Talk test would have to display the actual peer ID, relay and full fingerprint inside a Dot-owned session, accept a human decision, and prove that a refusal leaves the invite usable. [MCP elicitation](https://developers.openai.com/plugins/build/mcp-server#tool-annotations-and-elicitation) |

The local inventory contained ChatGPT Desktop 26.1120.50957 and Codex CLI. No separate, disposable Dot executable was found on the command path. Exercising the documented callback would require an account-backed Dot, plugin connection and real event subscription. The capability review performed none of these steps. A simulated webhook or a successful local Codex test cannot certify this path. There is no Dot plaintext bridge or external key service in Agent Talk.
