# CompanyBrain

Enterprise-grade, **federated organization knowledge platform** for the AI-agent era: governed hybrid search over your source systems with permission-aware retrieval, provenance on every answer, and an immutable audit trail. See the [architecture RFC](docs/rfc/0001-companybrain-architecture.md).

**Guiding principles:** source systems stay authoritative (for content _and_ authorization), CompanyBrain may restrict access but never expand it, plugins run with least privilege, and every answer carries citations.

## Repository layout

| Path              | Contents                                                                                                                                                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/`           | Deployables: `api` (HTTP), `mcp-server` (MCP tools over stdio), `worker` (crawls + Pub/Sub webhooks), `plugin-runner` (isolated plugin execution)                                                                                                                           |
| `packages/`       | Domain and platform libraries: `domain`, `knowledge-model`, `authorization`, `policy`, `retrieval`, `ranking`, `indexing`, `plugin-sdk`, `plugin-protocol`, `audit`, `provenance`, `model-gateway`, `mcp-adapter`, `a2a-adapter`, `application`, `observability`, `testing` |
| `plugins/`        | Source-system plugins: `github`, `google-workspace`, `slack`, `notion`, `bigquery`                                                                                                                                                                                          |
| `infrastructure/` | Terraform for Google Cloud (Cloud Run, Pub/Sub, Secret Manager, Cloud Storage, Logging)                                                                                                                                                                                     |
| `docs/`           | `rfc/` and `adr/`                                                                                                                                                                                                                                                           |

## Getting started

### Prerequisites

- [pnpm](https://pnpm.io/) **11.x** (see `packageManager` in `package.json`; use [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`)
- Node.js **22+** (see `engines` in `package.json`; `.node-version` pins the version used for local dev and CI)

Dependency installs follow pnpm 11 supply-chain settings in [`pnpm-workspace.yaml`](pnpm-workspace.yaml): **minimum release age** (a **7-day** quarantine, stricter than pnpm’s built-in 24-hour default), **blocking exotic transitive dependencies**, and an **`allowBuilds`** allowlist for packages that run install scripts.

Linting and formatting use [Trunk](https://trunk.io/) (ESLint, Prettier, and more). The Trunk **launcher** is installed with project dependencies.

### Install, build, test

```bash
pnpm install
pnpm build   # packages build topologically; required before tests
pnpm test    # Vitest across all workspaces
pnpm lint    # Trunk linters
```

### Run the API locally

```bash
pnpm --filter @companybrain/api build
node apps/api/dist/main.js
# then, with the demo corpus:
curl -s -X POST localhost:8080/v1/search \
  -H 'x-user-id: alice' -H 'x-user-groups: engineering' \
  -d '{"query": "onboarding checklist"}'
```

The API trusts `x-user-id` / `x-user-groups` from the fronting OAuth/OIDC gateway — never expose it without one.

### Run the MCP server

```bash
pnpm --filter @companybrain/mcp-server build
COMPANYBRAIN_USER_ID=alice node apps/mcp-server/dist/main.js
```

Phase 1 tools: `search`, `get_object`, `resolve_citation`, `list_sources`, `explain_access`.

## How a query flows

1. **Retrieval** (`packages/retrieval`): BM25 + vector search fused with reciprocal rank fusion, metadata filters, then **permission filtering** against the source-system ACL snapshot.
2. **Policy** (`packages/policy`): rules may further deny (by source, type, metadata) but can never grant what the source denied.
3. **Provenance** (`packages/provenance`): every result carries a resolvable citation back to the source system.
4. **Audit** (`packages/audit`): every search, lookup, and ingestion appends to a hash-chained, tamper-evident log.

## License

Apache-2.0
