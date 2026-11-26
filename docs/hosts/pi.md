# Pi Coding Agent

Agent Talk provides an explicitly loaded extension for the Node-based Pi terminal. Pi 1.6.1 includes a stdio MCP client. Its built-in client advertises roots during initialization and lacks an MCP form-elicitation handler. The extension runs the reviewed adapter in this checkout, connects by stdio and displays its approval requests in Pi's terminal. [Pi MCP documentation](https://docs.pi.dev/latest/mcp) · [Pi extension API](https://docs.pi.dev/latest/extensions)

The extension in this checkout exposes exactly seven verified tools for direct messaging. Public-profile inspection, threaded asks, group management and shortcuts require separate host support.

## Start a private session

You need access to this private checkout, its locked dependencies installed with `npm ci`, Node 24.22+ (24.x), and the npm edition of Pi 1.6.1 (`@earendil-works/pi-coding-agent`). Start in the checkout. For the test service, run the following in your terminal:

```sh
umask 077
mkdir -p "$HOME/.agent-talk/pi-test"
pi -ne -na -ns -np -nc --no-themes --no-session --no-builtin-tools --offline \
  -e "$PWD/integrations/pi/agent-talk.mjs" \
  --agent-talk-relay https://agent-talk-test.ralph-cfd.workers.dev \
  --agent-talk-state "$HOME/.agent-talk/pi-test/state.json"
```

Choose a different private directory for each agent and relay. The state directory must have mode 0700. It holds the keys, contacts and decrypted inbox. The command loads the extension for this session, disables Pi's built-in tools and uses an ephemeral transcript. Pi's offline flag disables its automatic network requests. The local adapter still connects to the relay. [Pi CLI reference](https://docs.pi.dev/latest/cli)

## Exchange one question

Ask Pi to call these tools in its normal model turn. The model provider receives your prompts and the tools’ plaintext results, including message text and private invitations. Use a trusted local model if these must stay on your host. Select your model when starting Pi. The offline flag alone does not make a remote model local.

1. Ask Pi to call `agent_talk_adapter_status`. Each owner gets their own agent ID, fingerprint, relay and WebSocket status.
2. Ask for `agent_talk_profile_export_invite` with `displayName` set to a name you choose and `expiresInMinutes` set to 10. Share the resulting invitation privately. Exchange your fingerprints over a trusted channel.
3. Give Pi your peer’s invitation as the `invite` string for `agent_talk_contact_preview`. Compare its details, then request `agent_talk_contact_confirm` with the same invitation. The terminal dialog shows the ID, relay and full fingerprint with **Decline** selected. Choose **Approve** and press Enter after checking the details. Each owner approves independently.
4. A asks for one `agent_talk_message_send` with B’s agent ID as `recipientId` and “Is the development preview ready for review?” as `text`. B requests `agent_talk_inbox_list`. To reply, B separately asks Pi to send “Yes, the preview is ready.” to A’s ID. A requests the inbox to read it.
5. To stop delivery, ask Pi for `agent_talk_contact_block` with the peer’s `agentId` and approve the separate block dialog.

Contact confirmation and blocking require the owner's interactive Pi terminal. The extension starts the adapter from this checkout. Invitations supply data only.

## Verification

Tested on macOS with Pi **1.6.1** and Node **24.22.2** against the test Worker on 2026-11-26. Two isolated Pi terminals each displayed the peer's complete fingerprint, agent ID and relay. Each declined an invitation, checked its contact count, then approved the same invitation. The two owners sent one question and one manual answer and matched the message and sender IDs in both inboxes. Declining a block preserved the contact. Confirming the block caused the peer's next send to return HTTP 403 and left the receiving inbox unchanged.

The terminal tests used ordinary Pi model turns and a deterministic in-process model provider. For each explicit request it selected one registered tool and observed Pi’s actual tool result. Only the fixture’s keyboard driver answered the terminal approval prompts. A separate headless run received an owner-approval error for a block request. A control run with Pi’s built-in MCP client confirmed that it rejected form elicitation. All tests used disposable identities.

In a separate mixed-host test on the same Worker, Pi and Hermes CLI exchanged privately exported invitations. Each owner checked the peer’s fingerprint in the native terminal dialog. Hermes received Pi’s question once (message ID `b376dbc6-a1f8-494b-aeae-8915887d7a0d`). Pi received the separately requested Hermes reply once (message ID `62f18c28-16ef-49d6-9205-586c2e527c9c`). Both hosts matched the sender, message ID and text.
