# Dev Test Personas

Pre-seeded users for development/testing in the Baltic region (Estonia, Latvia, Lithuania).

## How to seed

### Docker (recommended)

```bash
# Run seed as a one-off container (after docker compose up)
docker compose --profile seed up seed

# Or start everything including seed in one command
docker compose --profile seed up -d
```

The `seed` service:
- Uses the backend Dockerfile `base` target (includes ts-node + source)
- Runs `prisma migrate deploy` then the seed script
- Has `restart: "no"` so it exits after completion
- Only runs when you include the `seed` profile
- Is defined in `docker-compose.yml` as a one-off service

If you are not using the compose seed profile, run:

```bash
npm run db:seed
```

### Local (without Docker)

```bash
# Via npm script
npm run db:seed

# Via Prisma
npx prisma db seed
```

## How to login

All users are pre-verified. With `EXPOSE_OTP_IN_RESPONSE=true` (default in dev), the OTP is returned directly in the API response.

```text
POST /api/v1/auth/login
{ "identifier": "andres@test.dev", "method": "email" }
-> response includes { data: { code: "123456" } }

POST /api/v1/auth/otp/verify
{ "identifier": "andres@test.dev", "code": "123456", "purpose": "login", "method": "email" }
-> returns access + refresh tokens
```

You can also login by phone:

```text
POST /api/v1/auth/login
{ "identifier": "+37251001001", "method": "phone" }
```

---

## Personas

### 1. Andres Tamm (Driver - Estonia)

| Field | Value |
|-------|-------|
| Email | andres@test.dev |
| Phone | +37251001001 |
| Role | USER |
| Country | Estonia |
| Vehicle | Skoda Octavia, Silver, 2021 (sedan) |
| License | EST-123-AB |
| Chattiness | Chatterbox |
| Pets | Loves pets |

---

### 2. Liina Kask (Driver - Estonia)

| Field | Value |
|-------|-------|
| Email | liina@test.dev |
| Phone | +37251002002 |
| Role | USER |
| Country | Estonia |
| Vehicle | Toyota Yaris, White, 2022 (hatchback) |
| License | EST-456-CD |
| Chattiness | Chatty when comfortable |
| Pets | Depends on animal |

---

### 3. Janis Berzins (Driver - Latvia)

| Field | Value |
|-------|-------|
| Email | janis@test.dev |
| Phone | +37120001001 |
| Role | USER |
| Country | Latvia |
| Vehicle | Volkswagen Passat, Black, 2020 (sedan) |
| License | LV-7890-EF |
| Chattiness | Quiet |
| Pets | No pets |

---

### 4. Ieva Ozola (Rider only - Latvia)

| Field | Value |
|-------|-------|
| Email | ieva@test.dev |
| Phone | +37120002002 |
| Role | USER |
| Country | Latvia |
| Vehicle | None |
| Chattiness | Chatterbox |
| Pets | Loves pets |

---

### 5. Mantas Kazlauskas (Driver - Lithuania)

| Field | Value |
|-------|-------|
| Email | mantas@test.dev |
| Phone | +37060001001 |
| Role | USER |
| Country | Lithuania |
| Vehicle | BMW 3 Series, Blue, 2019 (sedan) |
| License | LT-ABC-123 |
| Chattiness | Chatty when comfortable |
| Pets | Depends on animal |

---

### 6. Gabija Jonaitis (Driver - Lithuania)

| Field | Value |
|-------|-------|
| Email | gabija@test.dev |
| Phone | +37060002002 |
| Role | USER |
| Country | Lithuania |
| Vehicle | Renault Clio, Red, 2023 (hatchback) |
| License | LT-XYZ-789 |
| Chattiness | Quiet |
| Pets | No pets |

---

### 7. Admin Baltic (Admin)

| Field | Value |
|-------|-------|
| Email | admin@test.dev |
| Phone | +37251009999 |
| Role | ADMIN |
| Country | Estonia |
| Vehicle | None |

Access admin panel at `/admin` after logging in with this account.

---

## Test Scenarios

| Scenario | Use personas |
|----------|-------------|
| Driver publishes ride Tallinn -> Riga | Andres (driver) |
| Rider books a seat | Ieva (rider) |
| Cross-border trip Vilnius -> Riga | Mantas (driver), Janis (rider) |
| Female-only ride | Liina (driver), Gabija or Ieva (riders) |
| Admin moderation | Admin Baltic |
| Driver with no vehicle tries to publish | Ieva (should fail) |
| Rating after ride completion | Any pair |
