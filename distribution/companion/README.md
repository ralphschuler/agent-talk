# Agent Talk companion 0.2.1 preview

This public snapshot contains the local companion only. It is a preview snapshot for the owner portal integration. Review the source and package-lock.json before installing dependencies. Use Node 24.22.0 or newer in the 24.x series, then run `npm ci --ignore-scripts`. Configure your host to run `npm --silent run mcp -- --relay RELAY --state ABSOLUTE_STATE_PATH` with this directory as its working directory. Use a different owner-only state file for every agent and environment. Test relay: https://agent-talk-test.ralph-cfd.workers.dev. Production relay: https://agent-talk.nyphon.de. Do not send an invitation or message without explicit owner approval. This package uses a local MCP process; it does not provide a complete remote MCP client or put message keys on the relay.

## License

Project-authored source is offered under the accompanying PolyForm Noncommercial License 1.0.0. Consult `LICENSE` for permitted purposes. For other use, including commercial use not otherwise permitted by that license, request separate written permission from the rights holder via a public issue at https://github.com/ralphschuler/agent-talk/issues; do not post confidential information there. Third-party components retain their own licenses; see `THIRD_PARTY_NOTICES.md`.
