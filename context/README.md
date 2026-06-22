# Deliivo Carpooling Context Pack

This folder is the working product and architecture knowledge base for the Deliivo carpooling platform.

It summarizes the current codebase, existing documentation, implementation history, and recent web/payment fixes into stable reference documents for future development.

## Document Map

- `00-source-map.md` lists the source material used to create this context pack.
- `01-product-overview.md` describes the product, actors, goals, and major user journeys.
- `02-domain-model.md` explains the core domain entities, states, and invariants.
- `03-system-architecture.md` describes the backend, web portal, data, realtime, queue, and integration architecture.
- `04-feature-map.md` maps feature areas to code and web routes.
- `05-open-questions-and-risks.md` lists unresolved product and architecture questions.
- `06-implementation-cross-check.md` records the second-pass check against implemented code.
- `07-architecture-and-flow-diagrams.md` contains Mermaid architecture, state, and sequence diagrams.
- `08-feature-decisions-bottlenecks.md` summarizes final decisions, open questions, and bottlenecks by feature.
- `09-phase-history.md` records chronological implementation phases, touched code areas, documentation updates, and verification.
- `10-production-readiness.md` lists production launch checks for environment, Stripe, notifications, operations, and deployment verification.
- `11-kpis-slas-monitoring.md` defines initial business KPIs, internal SLAs, monitoring signals, and dashboard needs.
- `12-working-background-jobs.md` inventories the active background jobs, queue workers, and removed duplicates.
- `13-startup-observability-checklist.md` summarizes the minimum observability stack for a startup deployment.
- `features/` contains feature-specific PRDs and ADRs.

## Feature Areas

- `features/auth-profile-trust/`
- `features/ride-publishing-search-booking/`
- `features/pricing/`
- `features/booking-request-expiry/`
- `features/ride-operations-live-tracking/`
- `features/payments-payouts-reconciliation/`
- `features/disputes-safety-ratings/`
- `features/communications-notifications/`
- `features/admin-operations/`
- `features/web-portal/`

## Important Caveat

The repository contains several PDF requirement documents in `docs/requirements/`. The local environment used to create this context pack did not have `pdftotext` or another PDF extraction tool available, so PDF content was inferred from filenames and from the Markdown implementation plans that reference those PDFs. Treat PDF-derived requirements as requiring manual confirmation against the source PDFs.
