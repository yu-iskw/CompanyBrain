# RFC: CompanyBrain

> Status: Draft
>
> Repository: https://github.com/yu-iskw/CompanyBrain

# 1. Executive Summary

This RFC proposes **CompanyBrain**, an enterprise-grade, federated
organization knowledge platform for the AI-agent era.

## Goals

- Governed enterprise search
- Federated knowledge (source systems remain authoritative)
- Permission-aware retrieval
- Plugin SDK
- MCP support first
- Future A2A support
- Cloud-native deployment on Google Cloud
- Model-agnostic AI
- Comprehensive auditability
- Security-by-default

## Non-goals (Phase 1)

- Autonomous write agents
- Centralized data lake
- Replacing source-system authorization
- Full enterprise knowledge graph
- Organization-wide workflow automation

# 2. Guiding Principles

1.  Federated architecture.
2.  Source systems remain authorization authority.
3.  CompanyBrain may restrict access but never expand it.
4.  Typed Knowledge Objects.
5.  Hybrid search.
6.  Plugins execute with least privilege.
7.  Every answer includes provenance.
8.  Everything is auditable.
9.  Model agnostic.
10. Modular monolith with Cloud Run workload isolation.

# 3. High-Level Architecture

```text
Clients
  |
Web/API/MCP
  |
Application Layer
  |
Retrieval + Policy + Audit
  |
Plugin Runtime
  |
Google Workspace
GitHub
Slack
Notion
BigQuery
Semantic Layer
```

# 4. Repository Layout

```text
CompanyBrain/
  apps/
    api/
    mcp-server/
    worker/
    plugin-runner/
  packages/
    domain/
    application/
    authorization/
    policy/
    retrieval/
    ranking/
    indexing/
    knowledge-model/
    plugin-sdk/
    plugin-protocol/
    audit/
    provenance/
    model-gateway/
    mcp-adapter/
    a2a-adapter/
    observability/
    testing/
  plugins/
    github/
    google-workspace/
    slack/
    notion/
    bigquery/
  infrastructure/
    terraform/
  docs/
    adr/
    rfc/
```

# 5. Domain Model

Core entity:

- KnowledgeObject

Representative object types:

- Document
- Repository
- File
- Symbol
- Issue
- Pull Request
- Slack Thread
- Dataset
- Table
- Dashboard
- Metric
- Semantic Model
- Person
- Team
- Project
- Service
- MCP Resource
- MCP Tool

# 6. Security

- OAuth/OIDC
- Delegated user identity
- Source authorization enforcement
- Policy engine
- Plugin sandbox
- Secret isolation
- Immutable audit log

# 7. Search

Hybrid retrieval:

- BM25
- Vector search
- Metadata filters
- Permission filtering
- Reranking
- Citation generation

# 8. Plugin SDK

Plugins expose:

- crawler
- retriever
- metadata provider
- webhook handler
- capability manifest

Plugins never receive unrestricted credentials.

# 9. MCP

Initial tools:

- search
- get_object
- resolve_citation
- list_sources
- explain_access

# 10. Deployment

Deployables:

- api
- mcp-server
- worker
- plugin-runner

Google Cloud:

- Cloud Run
- Pub/Sub
- BigQuery
- Cloud Storage
- Secret Manager
- Cloud Logging
- Cloud Monitoring

# 11. Testing

- Unit
- Integration
- Contract
- Authorization
- Retrieval evaluation
- Security
- Performance

# 12. Roadmap

Phase 1 - Federated search - Plugins - MCP - Audit

Phase 2 - Analytics assets - Semantic layer integration - Better ranking

Phase 3 - A2A - Research agent - Knowledge graph enrichment

# Appendix

This RFC intentionally favors maintainability and strong governance over
early architectural complexity.
