# Documentation Index

## Structure

```
docs/
├── INDEX.md                          ← You are here
├── FEEDBACK_LIST.md                  ← Execution-tracked feedback backlog
├── architecture/                     ← System design & diagrams
│   ├── DESIGN_DOCUMENT.md           ← Full architecture doc with embedded diagrams
│   ├── PRICE_CALCULATION.md         ← Pricing algorithm & fuel cost model
│   └── diagrams/                    ← Mermaid sources (.mmd) + rendered PNGs
│       ├── 01-high-level-architecture
│       ├── 02-use-case-diagram
│       ├── 03-auth-flow
│       ├── 04-ride-publishing-flow
│       ├── 05-search-booking-flow
│       ├── 06-ride-execution-otp
│       ├── 07-realtime-chat-flow
│       ├── 08-ride-state-machine
│       ├── 09-booking-state-machine
│       ├── 10-entity-relationship
│       ├── 11-search-algorithm
│       ├── 12-notification-pipeline
│       ├── 13-deadline-flow
│       ├── 14-cancellation-refund
│       ├── 15-component-interaction
│       └── 16-deployment-architecture
│
├── api/                              ← API specification
│   └── openapi/                     ← OpenAPI 3.0 spec (YAML, split by path)
│       ├── openapi.yaml             ← Root spec file
│       ├── paths/                   ← Per-module endpoint definitions
│       └── components/              ← Shared schemas, params, responses
│
├── guides/                           ← Developer guides
│   ├── frontend-integration-guide.md ← API usage guide for frontend teams
│   └── logging-guide.md            ← Winston logging conventions & best practices
│
├── testing/                          ← Test documentation
│   ├── e2e-guide.md                ← How to run E2E tests, env vars, troubleshooting
│   └── MANUAL_TEST_PLAN.md         ← Manual QA test plan & checklist
│
├── deployment/                       ← Deployment & infrastructure
│   └── railway-deployment.md       ← Railway deployment guide + Docker setup
│
└── decisions/                        ← ADRs, proposals, changelogs
    ├── PRODUCTION_READINESS.md      ← Full production readiness audit & fix plan
    ├── SCALING_FIXES.md             ← P0/P1 scaling fixes implementation notes
    ├── backlog.md                   ← Deferred work items
    ├── NESTJS_MIGRATION_PLAN.md     ← Future NestJS migration proposal
    ├── BOOKING_API_ENHANCEMENTS.md  ← Booking API improvements
    ├── BOOKING_STATUS_VERIFICATION.md ← Status transition verification
    ├── NOTIFICATION_DRIVER_NAME_FIX.md ← Driver name in notifications fix
    ├── WEBSOCKET_NOTIFICATION_TIME_REMAINING.md ← WS time remaining feature
    ├── ORIGIN_DESTINATION_CITY_FLOW_PROPOSAL.md ← City-based publish flow proposal
    ├── phase-a-completion.md        ← Phase A (critical fixes) completion notes
    ├── phase-b-completion.md        ← Phase B (security & config) completion notes
    ├── phase-c-completion.md        ← Phase C (revenue & operations) completion notes
    ├── phase-d-completion.md        ← Phase D (cost controls) completion notes
    ├── phase-e-completion.md        ← Phase E (legal & safety) completion notes
    └── feature-specs/               ← AI-generated feature specs & implementation plans
        ├── plans/                   ← Implementation plans
        └── specs/                   ← Design specifications
```

---

## Quick Links

### Getting Started
- [Architecture Overview](architecture/DESIGN_DOCUMENT.md) — start here to understand the system
- [Frontend Integration Guide](guides/frontend-integration-guide.md) — for frontend developers consuming the API
- [E2E Testing Guide](testing/e2e-guide.md) — running and writing tests

### Day-to-Day Development
- [Logging Guide](guides/logging-guide.md) — how to use the Winston logger
- [OpenAPI Spec](api/openapi/openapi.yaml) — full API reference
- [Price Calculation](architecture/PRICE_CALCULATION.md) — pricing algorithm details
- [Feedback List](FEEDBACK_LIST.md) — tracked execution list for active product feedback

### Operations
- [Railway Deployment](deployment/railway-deployment.md) — deploy to production
- [Production Readiness](decisions/PRODUCTION_READINESS.md) — audit results and status
- [Scaling Fixes](decisions/SCALING_FIXES.md) — P0/P1 bottleneck fixes (graceful shutdown, pooling, clustering)
- [Technical Review v1](architecture/TECHNICAL_REVIEW.md) — Initial bottleneck analysis (pre-fixes)
- [Technical Review v2](architecture/TECHNICAL_REVIEW_V2.md) — Post-fixes assessment for 50K users / 10K DAU

### Background Reading
- [Backlog](decisions/backlog.md) — deferred items and tech debt
- [NestJS Migration Plan](decisions/NESTJS_MIGRATION_PLAN.md) — future framework migration
- [Phase Completion Notes](decisions/) — `phase-a` through `phase-e` completion records

---

## Other Documentation Locations

| Location | Contents |
|----------|----------|
| `tests/e2e/README.md` | E2E test README (same content as `docs/testing/e2e-guide.md`) |
| `postman/README.md` | Postman collection usage |
| `.kiro/specs/` | Kiro AI-generated specs (booking/ratings feature) |
