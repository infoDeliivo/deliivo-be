# Source Map

## Codebase Sources

- Backend application entrypoints: `src/app.ts`, `src/server.ts`, `src/modules/index.ts`
- Backend modules: `src/modules/*`
- Queue and scheduled jobs: `src/queue/*`, `src/jobs/*`, `src/services/*`
- Prisma schema and migrations: `prisma/schema.prisma`, `prisma/migrations/*`
- Web portal: `web/src/app/*`, `web/src/lib/*`, `web/src/components/*`
- API contract: `docs/api/openapi/openapi.yaml` and split path files under `docs/api/openapi/paths/`
- Deployment: `Dockerfile`, `web/Dockerfile`, `docker-compose.yml`, `.env.example`

## Existing Documentation Sources

- `docs/INDEX.md`
- `docs/architecture/DESIGN_DOCUMENT.md`
- `docs/architecture/SYSTEM_DESIGN_ANALYSIS.md`
- `docs/architecture/PRICE_CALCULATION.md`
- `docs/architecture/TECHNICAL_REVIEW.md`
- `docs/architecture/TECHNICAL_REVIEW_V2.md`
- `docs/history/REQUIREMENTS_IMPLEMENTATION_PLAN.md`
- `docs/history/phase-1-ride-operations.md`
- `docs/history/phase-2-payments-pricing.md`
- `docs/history/phase-3-request-expiry.md`
- `docs/history/phase-4-dispute-safety.md`
- `docs/history/phase-5-reconciliation-polish.md`
- `docs/bug-fix/*`
- `docs/decisions/*`
- `docs/decisions/feature-specs/*`
- `docs/guides/frontend-integration-guide.md`
- `docs/testing/*`

## Requirement PDFs Present

These PDFs exist and should be treated as source-of-truth design inputs, but their contents were not fully extracted in this environment.

- `docs/requirements/deliivo_booking_request_expiry_design.pdf`
- `docs/requirements/Carpool_Ride_Start_Complete_Design_Document.pdf`
- `docs/requirements/Carpool_Ride_Start_Complete_Design_Document_RENDERED_DIAGRAMS.pdf`
- `docs/requirements/Carpool_Payment_System_Design.pdf`
- `docs/requirements/Carpool_Payment_Feature_Complete_Design.pdf`
- `docs/requirements/Baltic_Carpooling_V1_Pricing_Design_Developer.pdf`

## Git History Signals

Recent commits show a progression from backend implementation and production readiness toward web portal implementation and Stripe test-account integration.

Relevant recent themes:

- Web portal implementation and fixes
- Stripe test account and booking payment flow
- Production readiness and scaling fixes
- Requirements phase implementation
- Booking API enhancements
- WebSocket notifications and time remaining
- Segment booking fixes
- Veriff driving license verification

