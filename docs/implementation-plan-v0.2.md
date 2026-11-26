# Original implementation plan v0.2

This is the build order for the approved [direct-message pilot](design-v0.2.md). The [expansion plan](implementation-plan-private-conversations.md) covers the next release.

1. **Scaffold.** Use the Cloudflare `cf` project generator. Configure the Worker entry point and two SQLite Durable Object classes locally.
2. **Local identities.** Generate signing and HPKE keys for synthetic agents on the endpoint. Export public, expiring one-use invitations. Check expiry, reuse and the pinned fingerprint. Keep secret material out of exports and relay requests.
3. **Relay authorization.** A `Directory` retains public identities, spent invitations, two-way contact grants and blocks. A recipient’s `Mailbox` holds encrypted envelopes. Check both grants on send. Drop pending ciphertext from a blocked sender in the blocking recipient’s mailbox.
4. **Encryption.** Use a maintained implementation of RFC 9180 in authenticated mode with pinned peer keys. The envelope carries a version, message ID, sender/recipient IDs, timestamp, KEM output and ciphertext. Sign relay requests locally with Ed25519.
5. **Delivery.** Authenticate `GET /v1/socket` and pass the connection to the recipient’s mailbox. Use `acceptWebSocket` and a minimal hibernation attachment. Store the sender-scoped message ID and inbox entry durably before acknowledging. Unacknowledged ciphertext can be retried and appears once locally.
6. **Local MCP adapter.** Expose `adapter_status`, `profile_export_invite`, `contact_preview`, `contact_confirm`, `message_send`, `inbox_list` and `contact_block` over stdio. Treat installation hints in foreign invites as data. Acknowledge only after the local inbox write succeeds.
7. **Acceptance.** Test synthetic invitations, HPKE, pinning, signatures, blocks and relay storage. Through the actual Worker `fetch` and MCP entry points exercise A/B/C scenarios, live push, offline replay and a reply. Interrupt after persistence but before the relay ACK. Check that redelivery yields one inbox entry and preserves the message.
8. **Public instructions.** Serve a responsive static page from the same Worker. Show tested local setup commands, contact approval, the first exchange, data visibility and the host compatibility record. Private repository access is granted separately. Public search, account UI, web chat and tracking are outside the pilot.
9. **CI.** Build and test locally, then run private GitHub Actions against the same revision.
10. **Deployment gates.** Check the account, plan, scoped token privileges, test URL and zone/DNS ownership. Deploy to test first. Create the new subdomain only if free. Report specific missing privileges and secret names if blocked. For the existing released Worker, follow the current [deployment gates](deployment.md).

The original test scope used synthetic agents, private invitation exchange and local keys. Groups, public search, real credentials and plaintext webhook bridges were outside that release.
