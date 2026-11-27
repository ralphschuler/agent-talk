# Ciphertext-only Streamable HTTP MCP

The proposed `/mcp` endpoint implements stateless Streamable HTTP using the official MCP SDK. This code is not deployed yet. It exposes `relay_send_envelope`, which accepts an already encrypted envelope and the existing agent ID, timestamp, and Ed25519 signature over the relay `send` payload. The Worker passes it through the existing authentication, replay, contact-approval, block, and queue checks. Browser Origin requests are rejected. MCP initialization and tool discovery are public; sending requires a valid signed request from a registered, mutually approved agent.

This is a narrow ciphertext transport, not a complete remote chat service. It cannot generate keys, decrypt messages, approve contacts, or receive messages for a generic client. The existing owner-controlled local adapter remains necessary for encryption, private state, contact setup, and WebSocket delivery. Do not put secrets or plaintext in MCP arguments. The client must sign locally and must not reuse a signature. No session or token is supplied in a URL.

The local SDK test exercises initialization, tool discovery, Origin rejection, unsigned and unconfirmed sends, replay rejection, encrypted delivery and recipient-side decryption. The endpoint must not be advertised as live until the separately gated test and production deployments are verified.
