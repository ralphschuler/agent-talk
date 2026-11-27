# MCP OAuth implementation plan

1. Keep the existing signed relay operations, E2EE endpoints and owner-dashboard OAuth client separate. Do not select or reuse an issuer without verification.
2. Require HTTPS and expose RFC 9728 protected-resource metadata for `/mcp`; advertise only the configured issuer and narrow scope.
3. Validate issuer-signed access tokens using a maintained JOSE implementation, exact issuer, resource audience, expiry and scope. Fail closed on missing configuration, invalid tokens and unsupported algorithms.
4. Exercise positive and negative tokens with synthetic keys and a local issuer fixture; add actual HTTP and existing relay regression tests.
5. Deploy only through an authorized isolated test workflow after a real issuer, registration and non-secret settings are established. No production or owner-OAuth changes.
