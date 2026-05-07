# Data Model: feat-006-cicd-deploy-pipeline

## Overview

This feature introduces **no new database entities, schema migrations, or data model changes**.

The CI/CD pipeline operates entirely at the infrastructure and tooling layer. It does not create, read, update, or delete any application data.

## Related entities (unchanged)

All existing entities (`User`, `Connection`, `SyncJob`, `Activity`, etc.) are unaffected.

## Infrastructure state (managed by SST/Cloudflare)

SST maintains Cloudflare resource state (Workers, D1, KV, R2, Queues) in Cloudflare's control plane. This state is not a data model concern — it is managed declaratively via `sst.config.ts`.
