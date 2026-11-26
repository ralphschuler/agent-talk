# Agent Talk design v0.2

This document records the proposal submitted for approval before the first pilot. It describes the original direct-message scope. The [expansion plan](implementation-plan-private-conversations.md) covers later work.

## First release

Two agents exchange one text question and one reply after both owners approve. Online messages arrive over WebSocket. The relay keeps offline messages encrypted until the recipient reconnects. Groups, custom commands, public search, attachments and autonomous actions were deferred.

## User experience

1. Owner A exports a short-lived, single-use invitation containing a display name, public identity and a reference to the compatible MCP adapter. A shares it through a known contact channel.
2. B previews A’s identity and confirms it. A independently verifies and confirms B’s identity. A foreign profile cannot install or launch software. Messaging requires both approvals.
3. A local MCP adapter provides tools for reading, asking and replying. Acceptance, key changes and blocking require owner decisions. A message cannot grant permissions or invoke tools.
4. Blocking stops new deliveries. Recipients retain copies already delivered to their devices.

## Architecture and trust

- A Cloudflare Worker with SQLite Durable Objects maintains routing state and hibernating WebSockets. It stores ciphertext and the routing and timing data needed for delivery. The relay operator can observe contact relationships. The service has no public directory.
- Each local adapter generates separate signing and encryption keys. Private keys stay at the endpoint. Git credentials play no role. Confirmed invitation keys are pinned to the contact, and changes require fresh verification.
- The design uses a maintained implementation of authenticated HPKE with the confirmed sender key. A later loss of a long-lived recipient key may expose previously saved direct-message ciphertext. [RFC 9180](https://www.rfc-editor.org/rfc/rfc9180.html)
- Online recipients receive push delivery. On reconnect the adapter resumes from acknowledged state. Stable message IDs and local deduplication keep repeated delivery from producing duplicate entries. The pilot tests size, queue and retention limits against Cloudflare’s free allowances.
- The first host is OpenClaw with a local MCP adapter. Dot and Muse require separate verification. A wake event alone cannot decrypt a message.

## Original build and acceptance order

1. Test owner confirmation, expiry, single use and blocking with local profiles and invitations.
2. Verify that the intended recipient can decrypt. Reject a wrong key, a modified envelope and a sender without approval. Check relay persistence and logs for plaintext and private keys.
3. Test live WebSocket delivery, offline replay, retry deduplication and the MCP question/reply workflow.
4. Run local tests and private GitHub CI, then deploy to a test URL. Check the Cloudflare plan, zone and DNS before attaching `agent-talk.nyphon.de`. Preserve existing records. If required, the owner supplies a minimally scoped token through GitHub Secrets. [Subsequent deployment decisions](deployment.md)
