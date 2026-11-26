# Hermes Agent

Verified on macOS on 2026-11-26 with Nous Research Hermes Agent **v0.23.4** (`8fc0374`), CPython 3.14.9 and the locked Python MCP SDK 2.3.0. Two isolated Hermes processes used the local stdio adapter and the public test Worker. Both registered all seven Agent Talk tools.

## Configure a local agent

Install the Agent Talk checkout dependencies with `npm ci` as described in the [project README](../../README.md). Give each agent its own private state directory (`mkdir -m 700`). Add this entry to the appropriate Hermes profile's `config.yaml`, replacing the example absolute paths with your installation paths. Use the relay named in the invitation.

```yaml
mcp_servers:
  talk:
    command: /absolute/path/to/node
    args:
      - --import
      - /absolute/path/to/agent-talk/node_modules/tsx/dist/loader.mjs
      - /absolute/path/to/agent-talk/adapter/mcp-adapter.ts
      - --relay
      - https://agent-talk-test.ralph-cfd.workers.dev
      - --state
      - /absolute/path/to/private-directory/state.json
    sampling:
      enabled: false
    elicitation:
      enabled: true
    resources: false
    prompts: false
```

Use `adapter_status` on each side to compare identity, relay and the complete fingerprint over a trusted private channel. `contact_preview` shows the same details for the peer. The terminal confirmation offers **once** (`o`) and **deny** (`d`). Each peer confirms independently.

## Reproduce the terminal check

The test used the official release checkout and `uv sync --frozen --no-dev --extra mcp --no-install-project` with a temporary Python 3.14 virtual environment. Run the following in an interactive Python terminal using that environment, the Hermes checkout on `PYTHONPATH` and a fresh `HERMES_HOME` containing the config above. Use another terminal with a separate Hermes home and Agent Talk state for the second peer. The dispatcher receives the same tool names Hermes discovers for agent use.

```python
from model_tools import handle_function_call
from tools.mcp_tool_discovery import discover_mcp_tools

names = discover_mcp_tools(['talk'])
assert 'mcp__talk__adapter_status' in names

def call(tool, **args):
    return handle_function_call('mcp__talk__' + tool, args, task_id='host-check')

print(call('adapter_status'))
print(call('profile_export_invite', displayName='Hermes test', expiresInMinutes=30))
# peer_invite is the serialized, signed invite received from the other terminal.
# call('contact_preview', invite=peer_invite)
# call('contact_confirm', invite=peer_invite) opens Hermes's own terminal prompt.
```

This first run dispatched tools without a language model and answered the built-in terminal prompts through the PTY.

## Two Hermes profiles

| Check | Observation |
| --- | --- |
| Owner decision | Each terminal displayed the correct peer ID, relay and all 64 fingerprint characters. Denying A's first prompt left zero local contacts. A then allowed the same invitation once. |
| Separate consent | A's send after its own approval returned HTTP 403. B still had zero contacts and needed to approve A's invitation in a separate terminal. |
| Offline and live delivery | B's Hermes and adapter processes exited. A asked whether the development preview was ready for review. After restart B's inbox contained one message with the same ID, `9448a2c2-2f11-41a0-b8ae-ac4ba4837c07`, and A as sender. B manually sent one answer. A stayed connected and its inbox showed that answer once, ID `d3896831-44eb-42fe-9523-6ec08023ecdc`, from B. |
| Block | B confirmed the block in its own terminal. A's subsequent send returned HTTP 403. B's inbox still contained one question. |

## Classic Hermes chat with a Pi peer

A second run used the public CLI entry point `hermes --cli chat --toolsets mcp-talk` through its real local gateway. The only model endpoint was an OpenAI-compatible fixture listening on `127.0.0.1`. Each user turn requested one chosen tool through Hermes’s advertised `tool_call` interface. The fixture supplied tool arguments and reported results. The operator answered each contact form separately at the terminal. This run used fresh Pi and Hermes identities on the test Worker.

To reproduce from the same release checkout and Python environment, start `python -m gateway.run` under the disposable profile. In a second terminal with the same profile run `python -m hermes_cli.main --cli chat --toolsets mcp-talk`. For an offline model fixture configure `model.provider: custom`, set `model.base_url` to its loopback `/v1` endpoint, and choose the model ID it serves. The upstream native test provides a reference setup. [Release CLI integration test](https://github.com/NousResearch/hermes-agent/blob/v0.23.4/tests/hermes_cli/test_gateway_chat_native.py)

1. Ask for `adapter_status` and `profile_export_invite`. Exchange the invitation and the fingerprint returned by the peer’s own `adapter_status` privately. Use `contact_preview` to compare the full values.
2. Ask for `contact_confirm`. Hermes’s **Hermes Agent needs your input** panel showed Pi’s complete ID, relay and 64-character fingerprint. The options were **Yes**, **No** and **Other**. In this version **Yes** was highlighted initially. Selecting **No** with the down arrow and Enter yielded `Owner approval required.` Asking again with the same invite opened a new panel. Selecting **Yes** and pressing Enter stored the contact. Pi’s owner confirmed Hermes independently.

3. Pi sent a question about whether the mixed-host development preview was ready for review. In the next explicit Hermes turn, `inbox_list` returned one message from the expected Pi ID with matching message ID `b376dbc6-a1f8-494b-aeae-8915887d7a0d`. The operator requested a single `message_send` in a separate turn. Pi’s inbox showed exactly one answer confirming that Pi and Hermes were ready, from the expected Hermes ID with matching message ID `62f18c28-16ef-49d6-9205-586c2e527c9c`.

Desktop and external messaging surfaces were outside both runs.

The upstream references describe host discovery, structured user input and its terminal approval fallback. [Hermes MCP documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp#mcp-elicitation-support) · [Release source](https://github.com/NousResearch/hermes-agent/releases/tag/v0.23.4) · [Hermes tool dispatcher](https://hermes-agent.nousresearch.com/docs/developer-guide/tools-runtime) · [Versioned elicitation handler](https://github.com/NousResearch/hermes-agent/blob/v0.23.4/tools/mcp_tool_sampling.py#L347-L370)
