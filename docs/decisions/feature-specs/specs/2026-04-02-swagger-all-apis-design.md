# Swagger/OpenAPI Design for All Mounted APIs

Date: 2026-04-02
Status: Approved (design)
Owner: API platform

## 1. Objective
Create production-grade Swagger documentation for all currently mounted backend APIs, with public docs access and comprehensive schema coverage.

## 2. Scope
This design covers only mounted routes under `/api/v1` as wired in `src/app.ts`.

Included modules:
- Auth
- Users
- Publish Ride
- Search Rides
- Bookings (passenger)
- Driver Bookings
- Vehicles
- Travel Preferences
- Maps
- Chat
- Notifications
- Payments Webhook (Stripe)

Coverage target:
- 100% of mounted operations documented
- Comprehensive request/response schemas
- Auth requirements and reusable error models
- Endpoint examples for success and failure paths

## 3. Explicit Non-Goals
- No documentation for unmounted legacy routes
- No API behavior changes in this phase
- No auth hardening changes to docs endpoints (public access is intentional)

## 4. Constraints and Decisions
- Source of truth: OpenAPI files in repo (file-based)
- Strategy: modular OpenAPI files bundled into one runtime artifact
- Depth: comprehensive mode
- Docs visibility: public read-only in production

## 5. Alternatives Considered

### Approach A: Single monolithic `openapi.yaml`
Pros:
- Fastest initial setup
- Minimal tooling complexity

Cons:
- Hard to maintain with ~77 operations
- Large merge conflicts
- Poor ownership boundaries

### Approach B: Modular spec + bundled output (selected)
Pros:
- Scales to many modules and endpoints
- Clean review boundaries by domain
- Still produces one artifact for runtime/UI
- Better long-term maintainability

Cons:
- Slightly higher setup effort
- Requires bundling and lint scripts

### Approach C: Code annotations/code-first only
Pros:
- Can colocate docs near handlers

Cons:
- Harder for non-engineering reviewers
- Drift risk if generator conventions are weak
- Less explicit reusable component governance

Selected approach: **B**.

## 6. Target Architecture

### 6.1 Filesystem Layout
```text
docs/openapi/
  openapi.yaml
  paths/
    auth.yaml
    users.yaml
    publish-ride.yaml
    search-rides.yaml
    bookings.yaml
    driver-bookings.yaml
    vehicles.yaml
    travel-preferences.yaml
    maps.yaml
    chat.yaml
    notifications.yaml
    payments-webhook.yaml
  components/
    schemas/
      *.yaml
    responses/
      *.yaml
    parameters/
      *.yaml
    security/
      bearer.yaml
    examples/
      *.yaml
  dist/
    openapi.json
```

### 6.2 Runtime Exposure
- `GET /openapi.json` serves bundled spec artifact
- `GET /docs` serves Swagger UI consuming `/openapi.json`
- Both endpoints are public
- Auth rules in API operations are still encoded in spec using bearer security

### 6.3 Security Semantics in Spec
- Protected endpoints: declare bearer auth
- Public endpoints: explicit `security: []`
- Stripe webhook operation explicitly unauthenticated and documented as raw-body webhook endpoint

## 7. Route Inventory Baseline (Mounted Surface)
Baselined from route modules currently mounted in `src/app.ts`:

- `auth.routes.ts` (7)
- `chat.routes.ts` (7)
- `driver-booking.routes.ts` (5)
- `google.routes.ts` (6)
- `notification.routes.ts` (5)
- `stripe.webhook.routes.ts` (1)
- `publish-ride.routes.ts` (17)
- `ride-booking.routes.ts` (5)
- `search-ride.routes.ts` (5)
- `travelPreference.routes.ts` (2)
- `user.routes.ts` (5)
- `vehicle.routes.ts` (12)

Total baseline operations: **77**.

## 8. OpenAPI Content Rules (Comprehensive)
For every operation:
- `summary`, `description`, `operationId`, `tags`
- Path/query/header parameters with constraints
- Request body schemas (JSON, multipart, raw where applicable)
- Response schemas for success states
- Standardized error responses with reusable components
- At least one success example and one failure example

Global conventions:
- OpenAPI 3.1
- Reuse components aggressively for common envelopes/errors/pagination
- Operation IDs follow stable naming convention (`module_actionResource` style)
- Tags aligned to module boundaries above

## 9. Tooling and Build Integration
Add scripts in `package.json`:
- `openapi:lint` validates style/spec
- `openapi:bundle` resolves refs and emits `docs/openapi/dist/openapi.json`
- `openapi:check` runs lint + bundle + coverage check

Recommended tooling:
- Lint/bundle: Redocly CLI (or equivalent capable of robust multi-file bundling)
- Coverage check: custom script comparing mounted routes against documented operations

## 10. Coverage and Drift Detection
Create a route coverage check that:
- Reads mounted route definitions from route modules
- Normalizes Express-style paths to OpenAPI path templates
- Fails when any mounted operation is missing in spec
- Fails when spec contains operations for unmounted routes in the selected scope

This gate ensures docs cannot silently drift from runtime APIs.

## 11. Error Model Standardization
Define shared response components for:
- BadRequest (400)
- Unauthorized (401)
- Forbidden (403)
- NotFound (404)
- Conflict (409)
- ValidationError (422 or 400 based on current API behavior)
- InternalError (500)

Each includes:
- Stable top-level fields used by API response utility
- Machine-consumable code/message semantics where available
- Example payloads

## 12. Rollout Plan
1. Scaffold modular OpenAPI structure and root document
2. Document all 77 operations by module
3. Add bundling/linting/coverage scripts
4. Mount `/openapi.json` and `/docs`
5. Run checks locally and in CI
6. Release with public docs enabled

## 13. Testing Strategy
Validation tests:
- OpenAPI schema validation passes
- No unresolved `$ref`
- Coverage check passes against mounted routes

Runtime smoke tests:
- `/openapi.json` returns valid JSON with expected metadata
- `/docs` renders and loads schema successfully

Security checks:
- Protected operations require bearer in docs
- Public webhook operation explicitly unauthenticated

## 14. Risks and Mitigations
Risk: Large initial documentation effort across 77 operations.
Mitigation: Module-by-module ownership and strict coverage automation.

Risk: Spec drift after future endpoint changes.
Mitigation: CI `openapi:check` hard gate and PR checklist requiring docs update.

Risk: Public docs exposing internal naming details.
Mitigation: Keep examples sanitized and avoid leaking sensitive internals.

## 15. Acceptance Criteria
- Modular OpenAPI structure committed
- Bundled `openapi.json` generated from modular source
- Public `/docs` and `/openapi.json` endpoints functional
- 100% mounted `/api/v1` route coverage confirmed by automated check
- Comprehensive request/response/security/examples included for all covered operations

## 16. Implementation Handoff
After user confirms this spec, next step is to generate a detailed implementation plan (task breakdown, file-level changes, and sequencing) before coding.
