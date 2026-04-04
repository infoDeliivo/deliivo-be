# carpooling-be

Backend service for the carpooling platform.

## OpenAPI Documentation

This repository exposes Swagger UI at `GET /docs` and the raw OpenAPI document at `GET /openapi.json`.

The OpenAPI tooling is wired to the source spec at `docs/openapi/openapi.yaml` and bundles it to `docs/openapi/dist/openapi.json`.

## OpenAPI Commands

```bash
npm run openapi:lint
npm run openapi:bundle
npm run openapi:coverage
npm run openapi:check
```

## Notes

- `openapi:lint` validates the OpenAPI source file with Redocly.
- `openapi:bundle` resolves references and emits the runtime JSON artifact.
- `openapi:coverage` compares mounted `/api/v1` routes from code against documented OpenAPI operations.
- `openapi:check` runs lint, bundle, and coverage in sequence.

## Production SMS Notes

- Use either `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID` as sender.
- `SMS_MOCK_MODE` must stay `false` in production.
- `TWILIO_STATUS_CALLBACK_URL` must be `https://...` in production.
- Tune retries/retention with `SMS_RETRY_*` and `SMS_QUEUE_REMOVE_ON_*` variables in `.env.example`.
