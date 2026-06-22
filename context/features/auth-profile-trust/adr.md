# ADR: Auth, Profile, And Trust Architecture

## Status

Accepted as current architecture.

## Context

The platform needs lightweight rider onboarding while applying stricter requirements to drivers. Some trust checks depend on external services such as Veriff, while local development needs repeatable bypasses for testing.

## Decision

Keep identity, profile, travel preferences, vehicles, and license verification in separate backend modules with explicit route boundaries. Use OTP authentication and JWT sessions. Store verification state in the database and integrate external verification through dedicated callback routes. Gate development bypasses with environment flags.

## Rationale

- OTP keeps authentication compatible with mobile-first flows.
- Separate modules keep profile, preferences, vehicle, and verification responsibilities clear.
- Persisted verification state allows web, admin, and backend policies to make consistent decisions.
- External verification callbacks need isolated validation and logging.

## Consequences

- Driver readiness is a composed state across user profile, vehicle, verification, and payout.
- The web portal must query multiple profile readiness signals rather than relying on a single flag.
- Local testing depends on env flags and seed data to avoid external service dependency.

## Alternatives Considered

- Single profile module for all trust data. Rejected because verification, vehicles, and preferences evolve independently.
- Password authentication. Rejected for the current product direction because OTP fits rider and mobile flows better.
- Web-only verification state. Rejected because backend must enforce trust gates regardless of UI behavior.

## Code References

- `src/app.ts`
- `src/modules/auth`
- `src/modules/vehicles`
- `src/modules/dl-verification`
- `prisma/schema.prisma`

## Decision Trace

- Final decision, alternatives, consequences, open questions, and bottlenecks are summarized in `../../08-feature-decisions-bottlenecks.md#auth-profile-and-trust`.
- Supporting system and domain diagrams are in `../../07-architecture-and-flow-diagrams.md`.
