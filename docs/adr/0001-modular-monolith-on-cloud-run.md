# 1. Modular monolith with Cloud Run workload isolation

Date: 2026-07-11

## Status

Accepted

## Context

The CompanyBrain RFC (docs/rfc/0001-companybrain-architecture.md) calls for a
governed, federated knowledge platform with several runtime surfaces (HTTP
API, MCP server, ingestion worker, plugin runner). A microservices split
would multiply operational cost before the domain boundaries are proven; a
single process would let plugin code share a trust domain with the API.

## Decision

Build a **modular monolith**: one pnpm workspace where domain logic lives in
`packages/*` with enforced dependency direction (domain → retrieval/policy →
application → adapters), and where `apps/*` are thin deployables that wire
those packages together. Each deployable ships as its own Cloud Run service
with its own service account, so the **plugin-runner executes third-party
connector code in a separately-permissioned workload** even though it is
built from the same repository.

## Consequences

- Refactoring across module boundaries stays cheap (single repo, typed
  contracts, one test run).
- Security isolation happens at the workload level (Cloud Run + IAM), not the
  process level, matching RFC guiding principle 10.
- Extracting a package into a standalone service later only requires a new
  `apps/*` entrypoint; package contracts already forbid back-references.
