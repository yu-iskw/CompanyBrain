# RFC 0001: CompanyBrain delegated-retrieval MVP

> Status: Implemented Slack and GitHub vertical slices

## 1. Intent and issue analysis

### Stated problem (X)

Implement the proposed enterprise CompanyBrain architecture in the existing TypeScript repository.

### Underlying intent (Y)

Deliver a trustworthy and extensible organizational knowledge access layer that humans and agents can use without bypassing source-system authorization.

### XY problem check

Implementing every package and connector in the original draft would optimize for architectural completeness before validating the central security and product behavior. The first implementation instead proves one complete delegated-retrieval path while retaining ports for later storage, audit, and connector adapters.

### Context and impact

Slack and GitHub are the reference connectors; other sources follow incrementally. CompanyBrain authenticates through generic OIDC in deployed environments and links source identities independently. Source content remains authoritative and is fetched live; only non-sensitive metadata may be indexed later. PostgreSQL provides durable encrypted credential, session, OAuth-state, and audit storage, while Google Cloud infrastructure remains deferred.

## 2. Evaluation criteria

- **Authorization fidelity:** likelihood that revocation and source ACLs remain authoritative.
- **Vertical-slice value:** usefulness to a real user or MCP client.
- **Extensibility:** ability to add GitHub and later connectors without rewriting the core.
- **Maintainability:** operational and code complexity appropriate to the current stage.
- **Delivery confidence:** ability to test the critical behavior without external infrastructure.

## 3. Approaches

### Approach 1: Full RFC package matrix

Implement all proposed packages, deployables, and connector skeletons. Broad, but creates many abstractions before their requirements are known.

### Approach 2: Platform-only SDK

Implement contracts and plugin tooling without a complete connector. Fast and clean, but does not validate delegated authorization or retrieval semantics.

### Approach 3: Slack vertical slice in a compact modular monolith

Implement typed contracts, plugin SDK, application orchestration, Slack delegated retrieval, and all three product surfaces. Validates the highest-risk security path while retaining boundaries.

### Approach 4: Broad shallow multi-connector MVP

Implement minimal Slack, GitHub, Workspace, Notion, and BigQuery behavior. Demonstrates breadth but multiplies OAuth and API edge cases before the core stabilizes.

### Approach 5: Central ACL index first

Build hybrid retrieval and synchronized ACL filtering before live connectors. Improves ranking potential, but conflicts with the selected metadata-only persistence constraint and raises stale-authorization risk.

## 4. Scoring matrix

| Approach             | Authorization fidelity | Vertical-slice value | Extensibility | Maintainability | Delivery confidence | Average |
| :------------------- | ---------------------: | -------------------: | ------------: | --------------: | ------------------: | ------: |
| Full package matrix  |                     78 |                   45 |            88 |              40 |                  42 |      59 |
| Platform-only SDK    |                     80 |                   30 |            86 |              82 |                  78 |      71 |
| Slack vertical slice |                     94 |                   91 |            88 |              85 |                  90 |  **90** |
| Broad shallow MVP    |                     75 |                   76 |            80 |              48 |                  50 |      66 |
| Central ACL index    |                     62 |                   70 |            83 |              52 |                  45 |      62 |

Scores are 0–100 and reflect the agreed first-cycle constraints rather than long-term theoretical capability.

## 5. Recommendation

Use Approach 3. It establishes a real product boundary and validates delegated identity, partial source failures, citations, transport reuse, and a second connector without expanding the core contracts. The full matrix becomes appropriate only after further connectors expose stable shared requirements. A central index becomes attractive if live source latency or recall proves unacceptable and the organization accepts ACL synchronization and revocation-lag controls.

## Implemented security invariants

1. A plugin call requires a credential linked to the requesting subject and source.
2. Slack calls use `authed_user.access_token`; bot tokens are not silently substituted.
3. Source errors remain visible as typed partial failures.
4. Audit records contain a SHA-256 query fingerprint, not raw search text.
5. Every result contains source ID, object ID, URL, title, and retrieval timestamp.
6. Local unauthenticated mode cannot start with `NODE_ENV=production`.
7. Browser login uses PKCE, expiring state, and hardened cookies.

## Current production boundary

PostgreSQL now provides a durable encrypted `CredentialVault`, append-only `AuditSink`, and session/state stores. Before an internet-facing production deployment, add rate limiting, managed key rotation, explicit database migrations, retention jobs, HTTP MCP transport, and Google Cloud infrastructure. The next connector should reuse the current delegated-user contract without expanding it unless a concrete incompatibility is found.
