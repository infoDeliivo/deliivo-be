# PRD: Auth, Profile, And Trust

## Purpose

Provide a trusted identity and profile foundation for riders, drivers, and admins. Users should be able to sign in, complete their profile, add preferences, add vehicles, and complete driver verification before participating in trust-sensitive marketplace flows.

## Users

- Rider: books rides and needs basic identity, communication, payment, and safety controls.
- Driver: publishes rides and needs profile, vehicle, payout, and verification readiness.
- Admin: reviews users, documents, verification state, and safety issues.

## Current Capabilities

- OTP-based authentication and token refresh.
- User profile management.
- Travel preference management.
- Vehicle and vehicle document management.
- Driver license verification through Veriff-compatible backend routes.
- Development bypasses for verification workflows.
- User reporting and blocking concepts in the domain model.

## Functional Requirements

- Users can authenticate with OTP and keep a valid session through refresh tokens.
- Users can update profile fields required for marketplace participation.
- Users can define travel preferences such as chattiness, pets, and other matching signals.
- Drivers can add vehicles with enough metadata for rider confidence and compliance.
- Drivers can upload or connect required verification documents.
- Verification status must be visible in profile and must gate driver actions where required.
- Development mode can bypass external verification only when explicitly enabled through environment configuration.
- Users can report or block unsafe users.

## Non-Functional Requirements

- Authentication failures must not leak sensitive user information.
- Verification states must be auditable.
- Profile and vehicle actions must return typed validation errors that the web portal can render next to fields.
- Dev bypasses must be impossible to enable accidentally in production.

## Success Metrics

- Profile completion rate.
- Vehicle add success rate.
- Verification completion rate.
- Failed verification webhook rate.
- Support tickets for login, profile, or vehicle setup.

## Code References

- `src/modules/auth`
- `src/modules/user`
- `src/modules/travel-preferences`
- `src/modules/vehicles`
- `src/modules/dl-verification`
- `src/modules/otp`
- `web/src/app/auth`
- `web/src/app/profile`
- `web/src/app/onboarding`

## Diagrams, Questions, And Bottlenecks

- See `../../07-architecture-and-flow-diagrams.md` for system and domain diagrams.
- See `../../08-feature-decisions-bottlenecks.md#auth-profile-and-trust` for final decisions, open questions, and bottlenecks.
