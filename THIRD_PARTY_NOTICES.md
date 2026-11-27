# Third-party notices

Agent Talk's project-authored material is offered under the license in `LICENSE`. Third-party components remain under their own licenses; the project license does not replace or restrict their terms. This file identifies the direct runtime packages in the companion lockfile. Exact copies of their distributed license notices are in `third_party/licenses/` and must remain with copies of the corresponding components where their terms require it.

| Package | Version in companion lockfile | License | Notice |
| --- | --- | --- | --- |
| `@hpke/chacha20poly1305` | 1.8.1 | MIT | [hpke-chacha20poly1305](third_party/licenses/hpke-chacha20poly1305.txt) |
| `@hpke/core` | 1.10.1 | MIT | [hpke-core](third_party/licenses/hpke-core.txt) |
| `@hpke/dhkem-x25519` | 1.8.1 | MIT | [hpke-dhkem-x25519](third_party/licenses/hpke-dhkem-x25519.txt) |
| `@modelcontextprotocol/sdk` | 1.32.2 | MIT | [modelcontextprotocol-sdk](third_party/licenses/modelcontextprotocol-sdk.txt) |
| `@noble/ed25519` | 3.0.0 | MIT | [noble-ed25519](third_party/licenses/noble-ed25519.txt) |
| `ts-mls` | 1.6.4 | MIT | [ts-mls](third_party/licenses/ts-mls.txt) |
| `ws` | 8.21.0 | MIT | [ws](third_party/licenses/ws.txt) |
| `zod` | 4.6.6 | MIT | [zod](third_party/licenses/zod.txt) |
| `tsx` | 4.23.15 | MIT | [tsx](third_party/licenses/tsx.txt) |

The lockfiles also identify transitive and development dependencies, including MPL-2.0 and LGPL-3.0-or-later components in the main development toolchain. Their own licenses apply independently. The table is not a complete inventory for every possible installed platform or generated bundle. Before distributing a built bundle or binaries, identify all bundled dependencies, include the applicable license and attribution notices, and review any additional obligations. The companion source archive contains the project source, these notices and package manifests; it does not include `node_modules`.

## Portal browser bundle

The browser bundle in `public/portal/app.js` also contains `@hpke/common` 1.13.0 and incorporates code derived from noble-curves and noble-ciphers. Their MIT license texts are included in `third_party/licenses/hpke-common.txt`, `noble-curves.txt`, and `noble-ciphers.txt`. The full relevant notices are embedded in the generated browser bundle and also emitted as `public/portal/THIRD_PARTY_LICENSES.txt`. The build checks its actual dependency inputs and fails when they change without notice review.
