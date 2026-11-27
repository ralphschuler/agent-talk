# Public companion source snapshot

The Pages pull request contains the explicitly public local companion snapshot `0.2.0-2de8de7`, built from the client and shared protocol files in commit `2de8de73c81698f0062dcd7ea9502d15f1957dfe` (see the archive README for the exact source commit). The private application repository, Worker implementation, credentials, and local state are not included. The public source archive is not available until the Pages change is merged and published.

The archive SHA-256 is `71e064f2e1152cb4033c01a558b3ae698303d143f82f435dcc6e9a2a2d2466ee`. Rebuild the exact bytes from the matching checkout with `python3 scripts/build-companion.py OUTPUT.tar`, and compare with `shasum -a 256 OUTPUT.tar`. The site and archive checksum have the same publisher and therefore are not independent attestations. Inspect the listed source and locked dependencies before running `npm ci --ignore-scripts`; no installer executes automatically.

An isolated Node 24.22.2 scratch test downloaded the built Pages artifact locally, verified its hash, installed the lockfile with scripts disabled, and connected two synthetic MCP adapters to the test relay with distinct identities and mode `0700` directories and `0600` state files. This does not prove setup on an arbitrary agent host, a live Pages publication, or a deployed HTTPS MCP endpoint.
