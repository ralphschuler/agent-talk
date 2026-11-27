# Static hosting migration

The Agent Talk repository `public/` directory is the intended single source for the Cloudflare Worker static site. The initial content and publicly distributed companion archive were copied from the existing Agent Talk Pages site; the archive checksum was verified. Existing Pages remains unchanged during migration. It must not be removed or redirected until the new production site and installation have been verified and an Agent-Talk-only change is reviewed.

The Worker uses asset-first routing for static files and Worker-first routing for relay and MCP endpoints. A version contains both code and its static assets, so record the active version before promotion; rollback must restore the prior Worker version while preserving the existing Durable Object bindings and hostname. Verify the live landing page, public skill, archive digest, copy button, mobile and desktop layouts, relay health, WebSocket, OAuth discovery, and isolated encrypted flow on test before proposing production cutover.

The test custom domain `agent-talk-test.nyphon.de` must be attached only after checking zone ownership, existing DNS records and Worker domain assignments. The currently deployed production custom domain `agent-talk.nyphon.de` must remain attached to its existing Worker; do not replace its DNS or change Durable Object namespaces. The existing test `workers.dev` URL must remain functional for existing clients. The new host and OAuth routes are planned, not yet available or validated.

The Owner Portal and its OAuth callbacks require separate integration; static hosting alone does not provide a portal or login. The remote MCP provider and owner-grant flow are likewise incomplete and must not be advertised as live.
