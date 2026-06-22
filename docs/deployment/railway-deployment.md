# Railway Deployment Guide

This app runs as **5 Railway services** backed by 2 managed plugins.
All services are built from the same `Dockerfile` with different start commands.
Migrations run automatically on every deploy via `scripts/docker-entrypoint.sh`.

```
Railway Project
├── Plugins
│   ├── PostgreSQL        (managed — Railway provides DATABASE_URL)
│   └── Redis             (managed — Railway provides REDIS_URL)
└── Services
    ├── api               (main Express server)
    ├── mail-worker       (BullMQ mail queue worker)
    └── sms-worker        (BullMQ SMS queue worker)
```

---

## Prerequisites

- Railway account at railway.app
- Railway CLI installed: `npm install -g @railway/cli`
- Docker installed locally (for testing the image before pushing)
- All env vars from `.env.example` filled in

---

## Step 1 — Create the Railway project

```bash
railway login
railway init          # creates a new project, or link to existing
```

Or via the Railway dashboard: **New Project → Empty Project**.

---

## Step 2 — Add managed plugins

Railway provides Postgres and Redis as fully managed add-ons. You do not run these in Docker.

In the Railway dashboard:

1. Click **+ New** inside your project
2. Add **PostgreSQL** → Railway auto-injects `DATABASE_URL` into all services in the project
3. Add **Redis** → Railway auto-injects `REDIS_URL` into all services

These plugins give you:
- Automatic backups (Postgres)
- Connection pooling
- Private networking (no public exposure needed)
- Environment variables auto-set on all services

---

## Step 3 — Deploy the API service

### 3a. Create the service

In Railway dashboard: **+ New → GitHub Repo** → select your repo.

Railway will detect the `Dockerfile` automatically (via `railway.json`).

### 3b. Set the start command

In **Service Settings → Deploy → Start Command**, set:
```
node dist/server.js
```

The `docker-entrypoint.sh` will run `prisma migrate deploy` first, then hand off to this command.

### 3c. Set environment variables

In **Service Settings → Variables**, add every variable from `.env.example` that is NOT auto-provided by Railway plugins. Railway already injects:
- `DATABASE_URL` (from PostgreSQL plugin)
- `REDIS_URL` (from Redis plugin)

Variables you must set manually:

```bash
# Runtime
NODE_ENV=production
PORT=3000

# Security — generate strong random secrets, e.g. openssl rand -hex 64
ACCESS_TOKEN_SECRET=<generate>
REFRESH_TOKEN_SECRET=<generate>
JWT_SECRET=<generate>
SEGMENT_VIEW_TOKEN_SECRET=<generate>

# CORS — comma-separated list of your frontend origins
ALLOWED_ORIGINS=https://your-app.com,https://www.your-app.com

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PLATFORM_FEE_PERCENT=10
APP_BASE_URL=https://your-app.com
BOOKING_PAYMENT_MODE=stripe

# Twilio SMS
TWILIO_ACCOUNT_SID=ACxxxxxx
TWILIO_AUTH_TOKEN=xxxxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxx
SMS_MOCK_MODE=false

# AWS S3 (for avatar/document uploads)
AWS_ACCESS_KEY_ID=xxxxxx
AWS_SECRET_ACCESS_KEY=xxxxxx
AWS_REGION=eu-north-1
AWS_S3_BUCKET_NAME=your-bucket

# Firebase push notifications
FIREBASE_SERVICE_ACCOUNT_BASE64=<base64-encoded service account JSON>

# Mail
MAIL_HOST=smtp.yourprovider.com
MAIL_PORT=587
MAIL_USER=noreply@yourapp.com
MAIL_PASS=xxxxxx
MAIL_FROM="Your App <noreply@yourapp.com>"

# Google Maps
GOOGLE_MAPS_API_KEY=xxxxxx

# Veriff (DL verification)
VERIFF_API_KEY=xxxxxx
VERIFF_SHARED_SECRET=xxxxxx
VERIFF_BASE_URL=https://stationapi.veriff.com/v1
VERIFF_CALLBACK_URL=https://your-railway-api-url.railway.app/api/v1/dl-verification/webhook

# Pricing
FUEL_EFFICIENCY_KM_PER_LITER=12
FALLBACK_FUEL_PRICE_GB=1.5
FALLBACK_FUEL_PRICE_IN=95

# Do NOT set these — Railway provides them:
# DATABASE_URL
# REDIS_URL
```

### 3d. Configure health check

In **Service Settings → Deploy**:
- Health Check Path: `/health`
- Health Check Timeout: `30`

Railway will only route traffic once `/health` returns 200.

---

## Step 4 — Deploy the mail worker

### 4a. Create the service

Dashboard: **+ New → GitHub Repo** → same repo.

### 4b. Set the start command

In **Service Settings → Deploy → Start Command**:
```
node dist/modules/mail/mail.worker.js
```

The entrypoint will run migrations (idempotent, fast) then start the worker.

### 4c. Set environment variables

Click **Variables → Reference Variables** and select the API service — Railway lets you share variables between services. You need the same set as the API service. Alternatively copy them manually.

The critical ones for the worker:
```
NODE_ENV=production
DATABASE_URL          (shared from plugin)
REDIS_URL             (shared from plugin)
MAIL_HOST
MAIL_PORT
MAIL_USER
MAIL_PASS
MAIL_FROM
```

### 4d. No health check needed

Workers are not HTTP servers. Leave health check blank.

---

## Step 5 — Deploy the SMS worker

### 5a. Create the service

Dashboard: **+ New → GitHub Repo** → same repo.

### 5b. Set the start command

```
node dist/modules/sms/sms.worker.js
```

### 5c. Set environment variables

Same approach as mail worker. Critical vars:
```
NODE_ENV=production
DATABASE_URL          (shared from plugin)
REDIS_URL             (shared from plugin)
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER
SMS_MOCK_MODE=false
```

---

## Step 6 — How migrations work on Railway

Every container start runs `scripts/docker-entrypoint.sh` which does:

```sh
npx prisma migrate deploy   # applies any pending SQL migrations
exec node dist/server.js    # (or whatever the start command is)
```

`prisma migrate deploy`:
- Checks the `_prisma_migrations` table in your DB
- Runs only migrations that haven't been applied yet
- If all migrations are already applied (normal case after first deploy), it completes in < 1 second
- If a migration fails, the container exits — Railway will not route traffic to the failed deployment

**First deploy sequence:**
1. Railway builds the Docker image
2. Container starts
3. Entrypoint runs `prisma migrate deploy` — creates all tables from scratch
4. Server starts, health check passes, traffic routes to new deployment

**Subsequent deploys:**
1. Railway builds new image (if code changed)
2. Container starts
3. Entrypoint runs `prisma migrate deploy` — applies only new migrations, skips existing ones
4. Server starts

**Rolling back a migration:**
Railway doesn't support automatic rollback. If a migration causes a problem:
1. Revert the code change and push — this re-deploys the previous image
2. Manually run the inverse SQL via Railway's Postgres plugin shell or a database client

---

## Step 7 — Set the public domain

In **Service Settings → Networking → Public Networking**, enable a public domain for the API service. Copy this URL — it is what the frontend uses as the API base URL, and what you set as `VERIFF_CALLBACK_URL`.

Workers don't need public domains.

---

## Step 8 — Seed the first admin user

After first deploy, the database has users but none with `role = 'ADMIN'`. Connect to the Railway Postgres plugin and run:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = 'your-admin@email.com';
```

You can connect via:
- Railway dashboard → PostgreSQL plugin → **Query** tab (built-in SQL editor)
- Or a DB client like TablePlus/DBeaver using the connection string from the plugin's **Connect** tab

---

## Environment variable tips

### Firebase service account
Instead of a file path, encode the JSON as base64 and set `FIREBASE_SERVICE_ACCOUNT_BASE64`:
```bash
base64 -i serviceAccount.json | tr -d '\n'
```
Copy the output and paste it as the env var value.

### Generating secrets
```bash
# On macOS/Linux
openssl rand -hex 64

# Or Node.js
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

---

## Local development (docker-compose)

The `docker-compose.yml` is for local development only. It runs Postgres and Redis in containers alongside the app.

```bash
# Copy and fill in your local values
cp .env.example .env

# Build and start everything
docker compose up --build

# View logs
docker compose logs -f api

# Run migrations only (usually not needed — entrypoint handles it)
docker compose run --rm migrate

# Tear down
docker compose down -v   # -v removes volumes (deletes local DB data)
```

The compose setup:
1. Starts Postgres and Redis
2. Runs the `migrate` service (one-shot migration, then exits)
3. Starts `api`, `mail-worker`, `sms-worker` only after migrate exits successfully

---

## Deploying code changes

```bash
# Push to your main branch — Railway auto-deploys on push
git push origin main

# Or trigger manually
railway up
```

Railway builds a new Docker image on every push to the connected branch, then:
1. Starts new containers with the new image
2. Waits for health check to pass
3. Switches traffic to new containers
4. Stops old containers

Zero-downtime deploys. Migrations run before traffic switches.

---

## Checking logs

```bash
# Railway CLI
railway logs               # API service logs
railway logs --service mail-worker

# Or in the dashboard → select service → Logs tab
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Container exits immediately | No CMD / entrypoint crash | Check Railway logs for the error message |
| `prisma: not found` | `prisma` not in dependencies | Confirm `prisma` is in `dependencies` in `package.json`, not `devDependencies` |
| `DATABASE_URL is missing` | Env var not set | Check Railway Variables tab, ensure PostgreSQL plugin is added to project |
| `CORS error` from frontend | Origin not in ALLOWED_ORIGINS | Add frontend URL to `ALLOWED_ORIGINS` env var |
| Health check failing | App not listening on port 3000 | Check `PORT=3000` is set; check app logs for startup errors |
| Migration fails on deploy | Bad SQL in migration file | Check logs for the specific SQL error; fix migration file and redeploy |
| Workers not processing jobs | Wrong REDIS_URL | Ensure workers have the same `REDIS_URL` as the API |
