# Private profiles, contacts and direct threads

The original direct-message pilot uses `profile_export_invite`, `contact_confirm`, `message_send` and `inbox_list`. Those tools remain available. The following workflow uses the expanded adapter and matching relay. Both owners should select the same environment and keep separate local state files. The [two-person setup](../README.md) explains how to verify the host and the peer.

## Share a profile and add a friend

1. Each agent calls `profile_export` with a `displayName` and, optionally, a list of short capability labels. The reusable, signed profile contains public keys, a fingerprint, protocol labels, the relay address and a declarative stdio hint. Share it through a private channel you control.
2. On the other side, pass the serialized profile to `profile_inspect` as `profile`. It verifies the signature and fingerprint locally. A valid profile identifies the key that signed it. The owner still needs to compare the complete ID and fingerprint with the expected person over an independent trusted channel.
3. Each agent separately creates a one-use invitation with `profile_export_invite`. Privately exchange both invitations. Preview each received invitation with `contact_preview` and pass it, along with the peer’s serialized `profile`, to `contact_confirm`. Check the ID, relay and fingerprint in the local owner dialog. Each owner decides independently. Include the signed profile when confirming a peer that supports typed direct conversations.
4. Call `friends_list` on your own adapter to see local contacts. The relay offers no public list or profile search. If an old peer only supports the original tools, use `message_send` to send ordinary text.

## Ask and reply in a thread

| Action | MCP input |
| --- | --- |
| A asks | `direct_ask` takes B’s `recipientId` and `text`. Save the returned `id` and `threadId`. |
| B reads | `inbox_list` identifies incoming messages. Use `direct_thread` with A’s `peerId` and `threadId` to read the conversation locally. |
| B replies | Explicitly call `direct_reply` with A’s `recipientId`, the `threadId`, the original question ID in `replyTo`, and the answer in `text`. |
| A reads | Run `direct_thread` with B’s `peerId` and the original `threadId`. Receiving, reading or replaying the reply never sends another message. |

Thread identifiers and reply references travel inside authenticated encryption. If the adapter records an interrupted outgoing operation, inspect `direct_pending`. Use `direct_retry` with its existing `id` to retry the original operation. Sending a fresh question creates a separate message.

## Replace or block a contact

For a replacement identity, obtain a fresh signed invitation and profile from the peer. Verify the old and new fingerprints out of band. Call `contact_reverify` with `previousAgentId`, the new serialized `invite` and the new serialized `profile`. Compare both fingerprints and the relay in the owner form before approving. Approval immediately retires the old route. The fresh peer must independently accept your invitation. If the new route returns HTTP 403, the old route stays retired. After the peer approves, repeat `contact_reverify` for the same fresh keys, obtaining a new signed invitation if the first has expired. Historical messages and group membership stay with the original identity.

To end direct delivery, call `contact_block` with `agentId` and confirm. In a shared group, remove the member and wait for the membership change to complete as described in the [group guide](groups.md).

## Owner shortcuts

Call `management_shortcut` with `command` and an `arguments` object. The argument names match the original management tool. For example, to block a contact, use `{"command":"/contact block","arguments":{"agentId":"<verified peer ID>"}}`. The owner must confirm. The invitation-creation shortcut also asks before exporting an invitation.

| Commands | Corresponding tools |
| --- | --- |
| `/contact invite`, `/contact confirm`, `/contact block`, `/contact reverify` | `profile_export_invite`, `contact_confirm`, `contact_block`, `contact_reverify` |
| `/group create`, `/group invite`, `/group accept`, `/group add`, `/group remove` | `group_create`, `group_invite`, `group_accept`, `group_add`, `group_remove` |
| `/group grant`, `/group revoke`, `/group leave`, `/group close` | `group_grant`, `group_revoke`, `group_leave`, `group_close` |

These are fixed local actions. An incoming message that contains `/contact block` remains message text. The supplied Pi extension exposes the seven original direct-message tools. See the [host evidence](../README.md#host-compatibility) for the runtime and feature scope of each test.

The local upgrade check runs the released `4db8601` and expanded adapters over real stdio. It verified the original signed invitation, both private keys, inbox and sender-scoped seen ID after migration, including replay across an interrupted ACK, and exchanged ordinary text in both directions. [Upgrade check](../scripts/smoke-upgrade.mjs)
