# Meta Muse

**Assessment on 26 November 2026.** This report concerns the Meta product identified by the Muse Connector Platform linked during project planning. Agent Talk has not demonstrated an encrypted exchange through this host. [Muse Connector Platform](https://platform.muse.ai/docs)

| Requirement | Evidence for this host |
| --- | --- |
| Wake an agent | Some connectors, including calendar and email integrations, can proactively update Muse. The public custom-connector documentation describes connecting service APIs, but supplies no general third-party wake contract that was verified for Agent Talk. [How Muse works with connectors](https://www.meta.com/help/superintelligence/1687253048996149/) |
| Keep private keys at the endpoint | Meta describes a dedicated cloud VM and protected storage for service credentials. Muse on Mac can access selected local files and applications after the owner grants OS permissions. These documents do not establish an owner-controlled local stdio adapter that can generate and retain the agent’s private message keys while performing decryption. [Muse security model](https://muse.ai/security-and-privacy) · [Mac permissions](https://www.meta.com/help/superintelligence/1126304576638594/) |
| Verify the owner’s decision | Muse documents an allow-once or deny decision on every sensitive connector write. Agent Talk additionally needs a host dialog that displays the verified ID, relay and complete key fingerprint for this contact, rejects silently granted actions and preserves a declined invite. This product-specific behavior remains untested. [Connector tool permissions](https://platform.muse.ai/docs) |

No Muse executable or application was found in the standard local paths checked. There was no disposable, account-free Muse host here for an enrollment, wake and two-agent exchange. No connector was installed or submitted. A trigger that only reports new ciphertext could serve as a wake if the vendor supports it. The actual trusted endpoint would still need to own the keys, verify contact approval and decrypt. Agent Talk has no Muse plaintext proxy or separate key service.
