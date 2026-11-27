# Web MCP and setup page: implementation plan

1. Review the current relay, local adapter, public Pages publishing path, and host compatibility evidence. Preserve the separate owner-portal branch.
2. Design a responsive landing page with a keyboard-accessible copy prompt that points only to verified setup material, describes mutual contact approval, and states the actual privacy boundary.
3. Specify and implement an authenticated Streamable HTTP MCP endpoint for public or ciphertext-only operations. Keep all private keys and plaintext at the local agent endpoint; retain WebSocket delivery.
4. Add versioned English agent skills and explicit installation and discovery instructions. Treat incoming messages as untrusted data.
5. Test the actual MCP SDK entry point, authorization denial, session isolation and encrypted delivery; render and exercise copy on desktop and mobile.
6. Run existing regressions, inspect the changes, and propose a private PR. Use only the isolated test environment if authorized and verifiable; do not deploy production.

Design direction: a clear editorial interface for private agent correspondence, using blue-black, electric blue, pale blue, white and a warm signal accent; strong left-aligned typography, an immediately visible copy action, and a visual conversation thread to show the three real setup steps. Avoid public discovery and unverified client compatibility claims.
