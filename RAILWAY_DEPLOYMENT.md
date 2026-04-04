# Railway Deployment

This repo should run on Railway as 3 separate services from the same GitHub repo:

- `carpooling-api`
- `carpooling-mail-worker`
- `carpooling-sms-worker`

The API enqueues jobs into Redis. The mail worker and SMS worker consume those jobs.

## 1. Create PostgreSQL and Redis in Railway Console

Inside one Railway project:

1. Click `New`
2. Add `PostgreSQL`
3. Add `Redis`

Railway will create plugin services for both. Keep their service names simple, for example:

- `Postgres`
- `Redis`

## 2. Create the 3 App Services

Still in the same Railway project:

1. Click `New`
2. Choose `GitHub Repo`
3. Select this repository
4. Repeat until you have 3 app services

Recommended service names:

- `carpooling-api`
- `carpooling-mail-worker`
- `carpooling-sms-worker`

## 3. Build and Start Commands

Set the same build command on all 3 services:

```bash
npm run build
```

Use these start commands:

- API: `npm run start`
- Mail worker: `npm run start:worker`
- SMS worker: `npm run start:sms-worker`

These scripts are defined in [package.json](/home/agile/Downloads/carpooling-backend/carpooling-backend/package.json).

## 4. Shared Environment Variables

Set these on all 3 app services:

- `NODE_ENV=production`
- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `REDIS_URL=${{Redis.REDIS_URL}}`
- `ACCESS_TOKEN_SECRET=...`
- `REFRESH_TOKEN_SECRET=...`
- `MAIL_HOST=...`
- `MAIL_PORT=...`
- `MAIL_USER=...`
- `MAIL_PASS=...`
- `MAIL_FROM=...`
- `TWILIO_ACCOUNT_SID=...`
- `TWILIO_AUTH_TOKEN=...`
- `TWILIO_PHONE_NUMBER=...` (or use messaging service SID below)
- `TWILIO_MESSAGING_SERVICE_SID=...` (recommended for production)
- `TWILIO_STATUS_CALLBACK_URL=...` (optional)
- `SMS_MOCK_MODE=false`
- `AWS_ACCESS_KEY_ID=...`
- `AWS_SECRET_ACCESS_KEY=...`
- `AWS_REGION=...`
- `AWS_S3_BUCKET_NAME=...`
- `GOOGLE_MAPS_API_KEY=...`

If your Railway database or Redis service has a different name, adjust the variable references to match that name.

Optional compatibility variable:

- `JWT_SECRET=...`

`ACCESS_TOKEN_SECRET` is the main access-token secret. `JWT_SECRET` is only a legacy fallback.

## 5. Firebase Configuration

For Railway, prefer one of these:

- `FIREBASE_SERVICE_ACCOUNT_JSON=...`
- `FIREBASE_SERVICE_ACCOUNT_BASE64=...`

Local file-based fallback is also supported:

- `FIREBASE_SERVICE_ACCOUNT_PATH=...`
- `GOOGLE_APPLICATION_CREDENTIALS=...`

On Railway, do not set `FIREBASE_SERVICE_ACCOUNT_PATH` or `GOOGLE_APPLICATION_CREDENTIALS` unless that JSON file really exists inside the deployed container. Remove stale local paths such as `/app/...firebase-adminsdk....json`; use `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_BASE64` instead.

If Firebase is not configured, the app still starts, but push notifications stay disabled.

## 6. Service-Specific Notes

For `carpooling-api`:

1. Set healthcheck path to `/health`
2. Add pre-deploy command:

```bash
npx prisma migrate deploy
```

3. Generate a Railway domain or attach a custom domain

For `carpooling-mail-worker`:

- No public domain needed
- No HTTP healthcheck needed

For `carpooling-sms-worker`:

- No public domain needed
- No HTTP healthcheck needed

## 7. How Mail and SMS Work

The API adds jobs to Redis:

- Mail jobs are queued in [src/modules/mail/mail.service.ts](/home/agile/Downloads/carpooling-backend/carpooling-backend/src/modules/mail/mail.service.ts)
- SMS jobs are queued in [src/modules/sms/sms.service.ts](/home/agile/Downloads/carpooling-backend/carpooling-backend/src/modules/sms/sms.service.ts)

The worker services process those jobs:

- Mail worker entrypoint: [src/modules/mail/mail.worker.ts](/home/agile/Downloads/carpooling-backend/carpooling-backend/src/modules/mail/mail.worker.ts)
- SMS worker entrypoint: [src/modules/sms/sms.worker.ts](/home/agile/Downloads/carpooling-backend/carpooling-backend/src/modules/sms/sms.worker.ts)

If a worker service is not running, jobs remain queued in Redis and nothing is sent.

## 8. Deploy Verification

After deployment:

1. API logs should show the server starting on Railway's assigned port
2. `GET /health` should return `{"status":"ok"}`
3. Mail worker logs should show `Mail worker booting...` and `Mail worker is ready`
4. SMS worker logs should show `SMS worker booting...` and `SMS worker is ready`
5. API-created jobs should be consumed by the worker services

## 9. Database Check from Railway Console

To verify PostgreSQL is connected:

1. Open the `Postgres` service in Railway
2. Open its `Variables` tab and confirm `DATABASE_URL` exists
3. Open the `carpooling-api` service
4. Confirm `DATABASE_URL` is linked from PostgreSQL
5. Deploy the API and check logs for successful startup

If the API fails at Prisma startup, the first thing to check is whether `DATABASE_URL` is set correctly on all services that need database access.

## 10. Postgres Connection in Railway Console

To view the Postgres connection from the Railway dashboard:

1. Open your Railway project
2. Click the `Postgres` service
3. Open the `Variables` tab
4. Confirm Railway has generated database variables such as:

- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`
- `DATABASE_URL`

5. Open `carpooling-api` -> `Variables`
6. Set `DATABASE_URL=${{Postgres.DATABASE_URL}}`
7. Redeploy the API service

If you want to inspect tables and records in Railway itself:

1. Open the `Postgres` service
2. Open the database view
3. Use the table view to inspect tables and rows

## 11. Postgres Console with Railway CLI

If you want a real Postgres shell instead of the dashboard:

1. Install `psql` locally
2. Install and log in to the Railway CLI
3. Link the project locally
4. Run:

```bash
railway connect
```

If your project has multiple database services, Railway will prompt you to choose one. This opens an interactive Postgres console using the service's public database connection.
