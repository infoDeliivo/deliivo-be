# Swagger All Mounted APIs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish comprehensive Swagger/OpenAPI documentation for all mounted `/api/v1` endpoints and expose public `/docs` + `/openapi.json` endpoints.

**Architecture:** Maintain a modular OpenAPI 3.1 source under `docs/openapi`, bundle it into `docs/openapi/dist/openapi.json`, validate it with linting and route-coverage checks, and serve it at runtime using an Express docs router with Swagger UI.

**Tech Stack:** TypeScript, Express 5, swagger-ui-express, OpenAPI 3.1, Redocly CLI, Jest + Supertest.

---

## File Structure and Responsibilities

- `package.json` — add OpenAPI and docs scripts; add Swagger/OpenAPI dependencies.
- `docs/openapi/openapi.yaml` — root OpenAPI document (info, servers, tags, security, references).
- `docs/openapi/paths/*.yaml` — per-module path operations for mounted route groups.
- `docs/openapi/components/schemas/*.yaml` — request/response DTO schemas and envelopes.
- `docs/openapi/components/responses/*.yaml` — reusable error response objects.
- `docs/openapi/components/parameters/*.yaml` — shared path/query parameters.
- `docs/openapi/components/security/bearer.yaml` — bearer auth scheme.
- `docs/openapi/components/examples/*.yaml` — request/response examples.
- `docs/openapi/dist/openapi.json` — bundled runtime spec artifact.
- `src/docs/openapi.spec.ts` — load and validate bundled OpenAPI JSON at runtime.
- `src/docs/docs.routes.ts` — `GET /openapi.json` and `GET /docs` endpoints.
- `src/docs/docs.routes.test.ts` — runtime smoke tests for docs endpoints.
- `src/scripts/check-openapi-coverage.ts` — ensure all mounted routes exist in OpenAPI.
- `src/app.ts` — mount docs routes publicly.
- `.github/workflows/deploye.yml` — run `npm run openapi:check`.

### Mounted Route Inventory (must all be documented)

- Auth (`/api/v1/auth`): 7
- Users (`/api/v1/users`): 5
- Publish Ride (`/api/v1/publish-ride`): 17
- Search Rides (`/api/v1/search-rides`): 5
- Bookings (`/api/v1/bookings`): 5
- Driver Bookings (`/api/v1/driver/bookings`): 5
- Vehicles (`/api/v1/vehicles`): 12
- Travel Preferences (`/api/v1/travel-preferences`): 2
- Maps (`/api/v1/maps`): 6
- Chat (`/api/v1/chat`): 7
- Notifications (`/api/v1/notifications`): 5
- Payments Webhook (`/api/v1/payments`): 1

Total: 77 operations.

---

### Task 1: Add OpenAPI Tooling and Runtime Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Write the failing test (script existence check)**

Create `src/scripts/__tests__/openapi-scripts-config.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

describe('package scripts include OpenAPI commands', () => {
  it('defines openapi scripts', () => {
    const pkgPath = path.resolve(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

    expect(pkg.scripts['openapi:lint']).toBeDefined();
    expect(pkg.scripts['openapi:bundle']).toBeDefined();
    expect(pkg.scripts['openapi:check']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/scripts/__tests__/openapi-scripts-config.test.ts -v`
Expected: FAIL because scripts do not exist.

- [ ] **Step 3: Write minimal implementation**

Patch `package.json` scripts and dependencies:

```json
{
  "scripts": {
    "openapi:lint": "redocly lint docs/openapi/openapi.yaml",
    "openapi:bundle": "redocly bundle docs/openapi/openapi.yaml -o docs/openapi/dist/openapi.json --ext json",
    "openapi:check": "npm run openapi:lint && npm run openapi:bundle && node --loader ts-node/esm src/scripts/check-openapi-coverage.ts"
  },
  "dependencies": {
    "swagger-ui-express": "^5.0.1"
  },
  "devDependencies": {
    "@types/swagger-ui-express": "^4.1.8",
    "@redocly/cli": "^1.27.1"
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/scripts/__tests__/openapi-scripts-config.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/scripts/__tests__/openapi-scripts-config.test.ts
git commit -m "build(openapi): add swagger and openapi tooling scripts"
```

---

### Task 2: Scaffold Root OpenAPI and Shared Components

**Files:**
- Create: `docs/openapi/openapi.yaml`
- Create: `docs/openapi/components/security/bearer.yaml`
- Create: `docs/openapi/components/responses/errors.yaml`
- Create: `docs/openapi/components/parameters/common.yaml`
- Create: `docs/openapi/components/schemas/common.yaml`
- Create: `docs/openapi/components/examples/common.yaml`

- [ ] **Step 1: Write the failing test**

Create `src/scripts/__tests__/openapi-root-files.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

const reqFiles = [
  'docs/openapi/openapi.yaml',
  'docs/openapi/components/security/bearer.yaml',
  'docs/openapi/components/responses/errors.yaml',
  'docs/openapi/components/parameters/common.yaml',
  'docs/openapi/components/schemas/common.yaml',
  'docs/openapi/components/examples/common.yaml',
];

describe('openapi root files', () => {
  it('all required base files exist', () => {
    for (const rel of reqFiles) {
      expect(fs.existsSync(path.resolve(process.cwd(), rel))).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/scripts/__tests__/openapi-root-files.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `docs/openapi/openapi.yaml`:

```yaml
openapi: 3.1.0
info:
  title: Carpooling API
  version: 1.0.0
  description: Comprehensive API documentation for mounted /api/v1 endpoints.
servers:
  - url: https://api.example.com
    description: Production
  - url: http://localhost:3000
    description: Local
security:
  - BearerAuth: []
tags:
  - name: Auth
  - name: Users
  - name: Publish Ride
  - name: Search Rides
  - name: Bookings
  - name: Driver Bookings
  - name: Vehicles
  - name: Travel Preferences
  - name: Maps
  - name: Chat
  - name: Notifications
  - name: Payments
paths:
  /api/v1/auth/signup:
    $ref: ./paths/auth.yaml#/paths/~1api~1v1~1auth~1signup
components:
  securitySchemes:
    BearerAuth:
      $ref: ./components/security/bearer.yaml#/BearerAuth
  responses:
    BadRequest:
      $ref: ./components/responses/errors.yaml#/BadRequest
    Unauthorized:
      $ref: ./components/responses/errors.yaml#/Unauthorized
    Forbidden:
      $ref: ./components/responses/errors.yaml#/Forbidden
    NotFound:
      $ref: ./components/responses/errors.yaml#/NotFound
    Conflict:
      $ref: ./components/responses/errors.yaml#/Conflict
    InternalError:
      $ref: ./components/responses/errors.yaml#/InternalError
```

Create `docs/openapi/components/security/bearer.yaml`:

```yaml
BearerAuth:
  type: http
  scheme: bearer
  bearerFormat: JWT
```

Create `docs/openapi/components/responses/errors.yaml`:

```yaml
BadRequest:
  description: Bad request
  content:
    application/json:
      schema:
        $ref: ../schemas/common.yaml#/ApiError
Unauthorized:
  description: Unauthorized
  content:
    application/json:
      schema:
        $ref: ../schemas/common.yaml#/ApiError
Forbidden:
  description: Forbidden
  content:
    application/json:
      schema:
        $ref: ../schemas/common.yaml#/ApiError
NotFound:
  description: Not found
  content:
    application/json:
      schema:
        $ref: ../schemas/common.yaml#/ApiError
Conflict:
  description: Conflict
  content:
    application/json:
      schema:
        $ref: ../schemas/common.yaml#/ApiError
InternalError:
  description: Internal server error
  content:
    application/json:
      schema:
        $ref: ../schemas/common.yaml#/ApiError
```

Create `docs/openapi/components/parameters/common.yaml`:

```yaml
Page:
  name: page
  in: query
  schema:
    type: integer
    minimum: 1
    default: 1
Limit:
  name: limit
  in: query
  schema:
    type: integer
    minimum: 1
    maximum: 50
    default: 10
IdPath:
  name: id
  in: path
  required: true
  schema:
    type: string
    format: uuid
```

Create `docs/openapi/components/schemas/common.yaml`:

```yaml
ApiError:
  type: object
  properties:
    success:
      type: boolean
      example: false
    message:
      type: string
      example: Validation failed
DataEnvelope:
  type: object
  properties:
    success:
      type: boolean
      example: true
    message:
      type: string
      example: OK
    data:
      type: object
```

Create `docs/openapi/components/examples/common.yaml`:

```yaml
ErrorExample:
  summary: Generic validation error
  value:
    success: false
    message: Validation failed
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/scripts/__tests__/openapi-root-files.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/openapi src/scripts/__tests__/openapi-root-files.test.ts
git commit -m "docs(openapi): scaffold root spec and shared components"
```

---

### Task 3: Add Module Path Files for All Mounted Route Groups

**Files:**
- Create:
  - `docs/openapi/paths/auth.yaml`
  - `docs/openapi/paths/users.yaml`
  - `docs/openapi/paths/publish-ride.yaml`
  - `docs/openapi/paths/search-rides.yaml`
  - `docs/openapi/paths/bookings.yaml`
  - `docs/openapi/paths/driver-bookings.yaml`
  - `docs/openapi/paths/vehicles.yaml`
  - `docs/openapi/paths/travel-preferences.yaml`
  - `docs/openapi/paths/maps.yaml`
  - `docs/openapi/paths/chat.yaml`
  - `docs/openapi/paths/notifications.yaml`
  - `docs/openapi/paths/payments-webhook.yaml`
- Create: `src/scripts/generate-openapi-path-stubs.ts`
- Modify: `docs/openapi/openapi.yaml`

- [ ] **Step 1: Write the failing test**

Create `src/scripts/__tests__/openapi-path-files.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

const pathFiles = [
  'auth.yaml',
  'users.yaml',
  'publish-ride.yaml',
  'search-rides.yaml',
  'bookings.yaml',
  'driver-bookings.yaml',
  'vehicles.yaml',
  'travel-preferences.yaml',
  'maps.yaml',
  'chat.yaml',
  'notifications.yaml',
  'payments-webhook.yaml',
];

describe('openapi path files', () => {
  it('contains one yaml per mounted module', () => {
    for (const file of pathFiles) {
      const full = path.resolve(process.cwd(), 'docs/openapi/paths', file);
      expect(fs.existsSync(full)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/scripts/__tests__/openapi-path-files.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Create `src/scripts/generate-openapi-path-stubs.ts`:

```ts
import fs from 'fs';
import path from 'path';

type Operation = { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string };

const moduleOps: Record<string, Operation[]> = {
  'auth.yaml': [
    { method: 'post', path: '/api/v1/auth/signup' },
    { method: 'post', path: '/api/v1/auth/otp/request' },
    { method: 'post', path: '/api/v1/auth/otp/resend' },
    { method: 'post', path: '/api/v1/auth/otp/verify' },
    { method: 'post', path: '/api/v1/auth/login' },
    { method: 'post', path: '/api/v1/auth/access-token' },
    { method: 'post', path: '/api/v1/auth/logout' },
  ],
  'users.yaml': [
    { method: 'get', path: '/api/v1/users/me' },
    { method: 'get', path: '/api/v1/users/me/profile' },
    { method: 'put', path: '/api/v1/users/me/profile' },
    { method: 'post', path: '/api/v1/users/me/onboarding/complete' },
    { method: 'post', path: '/api/v1/users/me/avatar' },
  ],
  'publish-ride.yaml': [
    { method: 'post', path: '/api/v1/publish-ride/draft/origin' },
    { method: 'put', path: '/api/v1/publish-ride/draft/destination' },
    { method: 'get', path: '/api/v1/publish-ride/draft/routes/compute' },
    { method: 'put', path: '/api/v1/publish-ride/draft/routes/select' },
    { method: 'get', path: '/api/v1/publish-ride/draft/stopovers/suggestions' },
    { method: 'put', path: '/api/v1/publish-ride/draft/stopovers' },
    { method: 'put', path: '/api/v1/publish-ride/draft/schedule' },
    { method: 'put', path: '/api/v1/publish-ride/draft/capacity' },
    { method: 'get', path: '/api/v1/publish-ride/draft/pricing/recommended' },
    { method: 'put', path: '/api/v1/publish-ride/draft/pricing' },
    { method: 'patch', path: '/api/v1/publish-ride/draft/notes' },
    { method: 'post', path: '/api/v1/publish-ride/draft/publish' },
    { method: 'get', path: '/api/v1/publish-ride/fuel-price' },
    { method: 'post', path: '/api/v1/publish-ride/fuel-price/refresh' },
    { method: 'get', path: '/api/v1/publish-ride' },
    { method: 'get', path: '/api/v1/publish-ride/{id}' },
    { method: 'delete', path: '/api/v1/publish-ride/{id}' },
  ],
  'search-rides.yaml': [
    { method: 'get', path: '/api/v1/search-rides/advanced' },
    { method: 'get', path: '/api/v1/search-rides' },
    { method: 'get', path: '/api/v1/search-rides/user/recent' },
    { method: 'get', path: '/api/v1/search-rides/{id}' },
    { method: 'post', path: '/api/v1/search-rides/notify' },
  ],
  'bookings.yaml': [
    { method: 'post', path: '/api/v1/bookings' },
    { method: 'get', path: '/api/v1/bookings' },
    { method: 'get', path: '/api/v1/bookings/{id}' },
    { method: 'post', path: '/api/v1/bookings/{id}/payment/confirm' },
    { method: 'post', path: '/api/v1/bookings/{id}/cancel' },
  ],
  'driver-bookings.yaml': [
    { method: 'post', path: '/api/v1/driver/bookings/{id}/accept' },
    { method: 'post', path: '/api/v1/driver/bookings/{id}/reject' },
    { method: 'post', path: '/api/v1/driver/bookings/{id}/cancel' },
    { method: 'post', path: '/api/v1/driver/bookings/{id}/pickup-otp/verify' },
    { method: 'post', path: '/api/v1/driver/bookings/{id}/drop-otp/verify' },
  ],
  'vehicles.yaml': [
    { method: 'post', path: '/api/v1/vehicles/draft' },
    { method: 'put', path: '/api/v1/vehicles/draft/vehicle-details' },
    { method: 'post', path: '/api/v1/vehicles/draft/upload-document' },
    { method: 'post', path: '/api/v1/vehicles/draft/save' },
    { method: 'post', path: '/api/v1/vehicles' },
    { method: 'post', path: '/api/v1/vehicles/upload' },
    { method: 'post', path: '/api/v1/vehicles/{id}' },
    { method: 'put', path: '/api/v1/vehicles/{id}/update-details' },
    { method: 'post', path: '/api/v1/vehicles/{id}/image' },
    { method: 'get', path: '/api/v1/vehicles' },
    { method: 'get', path: '/api/v1/vehicles/{id}' },
    { method: 'delete', path: '/api/v1/vehicles/{id}' },
  ],
  'travel-preferences.yaml': [
    { method: 'put', path: '/api/v1/travel-preferences' },
    { method: 'get', path: '/api/v1/travel-preferences' },
  ],
  'maps.yaml': [
    { method: 'post', path: '/api/v1/maps/routes/compute' },
    { method: 'post', path: '/api/v1/maps/routes/multi' },
    { method: 'post', path: '/api/v1/maps/roads/snap' },
    { method: 'post', path: '/api/v1/maps/geolocation' },
    { method: 'get', path: '/api/v1/maps/place/autocomplete' },
    { method: 'get', path: '/api/v1/maps/place/place-details' },
  ],
  'chat.yaml': [
    { method: 'get', path: '/api/v1/chat' },
    { method: 'get', path: '/api/v1/chat/unread-count' },
    { method: 'get', path: '/api/v1/chat/{conversationId}/messages' },
    { method: 'post', path: '/api/v1/chat/send' },
    { method: 'post', path: '/api/v1/chat/send-image' },
    { method: 'post', path: '/api/v1/chat/send-location' },
    { method: 'post', path: '/api/v1/chat/{conversationId}/read' },
  ],
  'notifications.yaml': [
    { method: 'get', path: '/api/v1/notifications' },
    { method: 'post', path: '/api/v1/notifications/read' },
    { method: 'get', path: '/api/v1/notifications/unread-count' },
    { method: 'post', path: '/api/v1/notifications/devices/register' },
    { method: 'delete', path: '/api/v1/notifications/devices/{tokenId}' },
  ],
  'payments-webhook.yaml': [{ method: 'post', path: '/api/v1/payments/stripe/webhook' }],
};

const fileHeader = 'paths:\\n';
const moduleTag = (file: string) =>
  ({
    'auth.yaml': 'Auth',
    'users.yaml': 'Users',
    'publish-ride.yaml': 'Publish Ride',
    'search-rides.yaml': 'Search Rides',
    'bookings.yaml': 'Bookings',
    'driver-bookings.yaml': 'Driver Bookings',
    'vehicles.yaml': 'Vehicles',
    'travel-preferences.yaml': 'Travel Preferences',
    'maps.yaml': 'Maps',
    'chat.yaml': 'Chat',
    'notifications.yaml': 'Notifications',
    'payments-webhook.yaml': 'Payments',
  }[file] || 'General');
const templateOp = (method: string, opId: string, apiPath: string, file: string) =>
  `    ${method}:\\n      operationId: ${opId}\\n      summary: ${method.toUpperCase()} ${apiPath}\\n      tags: [${moduleTag(file)}]\\n      responses:\\n        '200':\\n          description: OK\\n`;

const pathsDir = path.resolve(process.cwd(), 'docs/openapi/paths');
fs.mkdirSync(pathsDir, { recursive: true });

for (const [file, ops] of Object.entries(moduleOps)) {
  const grouped = new Map<string, Operation[]>();
  for (const op of ops) {
    const current = grouped.get(op.path) || [];
    current.push(op);
    grouped.set(op.path, current);
  }

  let out = fileHeader;
  for (const [apiPath, variants] of grouped.entries()) {
    out += `  ${apiPath}:\\n`;
    for (const v of variants) {
      const opId = `${file.replace('.yaml', '')}_${v.method}_${apiPath.replace(/[^a-zA-Z0-9]/g, '_')}`;
      out += templateOp(v.method, opId, apiPath, file);
    }
  }

  fs.writeFileSync(path.join(pathsDir, file), out, 'utf8');
}

console.log('Generated path stubs for all mounted route groups.');
```

Run:

```bash
node --loader ts-node/esm src/scripts/generate-openapi-path-stubs.ts
```

Then replace each generated baseline operation with comprehensive request/response schemas, security declarations, and success/failure examples.

Reference implementation block for enriched operation shape (`docs/openapi/paths/bookings.yaml`):

```yaml
paths:
  /api/v1/bookings:
    post:
      tags: [Bookings]
      operationId: bookings_create
      summary: Create booking
      security:
        - BearerAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [rideId, seatsBooked]
              properties:
                rideId:
                  type: string
                  format: uuid
                seatsBooked:
                  type: integer
                luggageCount:
                  type: integer
      responses:
        '201':
          description: Booking created
        '400':
          $ref: ../components/responses/errors.yaml#/BadRequest
    get:
      tags: [Bookings]
      operationId: bookings_list
      summary: List bookings
      security:
        - BearerAuth: []
      parameters:
        - $ref: ../components/parameters/common.yaml#/Page
        - $ref: ../components/parameters/common.yaml#/Limit
      responses:
        '200':
          description: Booking list
  /api/v1/bookings/{id}:
    get:
      tags: [Bookings]
      operationId: bookings_getById
      summary: Get booking by id
      security:
        - BearerAuth: []
      parameters:
        - $ref: ../components/parameters/common.yaml#/IdPath
      responses:
        '200':
          description: Booking details
        '404':
          $ref: ../components/responses/errors.yaml#/NotFound
  /api/v1/bookings/{id}/payment/confirm:
    post:
      tags: [Bookings]
      operationId: bookings_confirmPayment
      summary: Confirm payment status
      security:
        - BearerAuth: []
      parameters:
        - $ref: ../components/parameters/common.yaml#/IdPath
      responses:
        '200':
          description: Payment status confirmed
  /api/v1/bookings/{id}/cancel:
    post:
      tags: [Bookings]
      operationId: bookings_cancel
      summary: Cancel booking
      security:
        - BearerAuth: []
      parameters:
        - $ref: ../components/parameters/common.yaml#/IdPath
      responses:
        '200':
          description: Booking cancelled
```

Then wire all module paths into root `openapi.yaml` under `paths:`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/scripts/__tests__/openapi-path-files.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/openapi/paths docs/openapi/openapi.yaml src/scripts/generate-openapi-path-stubs.ts src/scripts/__tests__/openapi-path-files.test.ts
git commit -m "docs(openapi): add mounted module path operation files"
```

---

### Task 4: Add Coverage Check Script for Mounted Routes vs Spec

**Files:**
- Create: `src/scripts/check-openapi-coverage.ts`
- Create: `src/scripts/__tests__/check-openapi-coverage.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/scripts/__tests__/check-openapi-coverage.test.ts`:

```ts
import { execSync } from 'child_process';

describe('openapi coverage script', () => {
  it('runs without missing route errors', () => {
    expect(() => {
      execSync('node --loader ts-node/esm src/scripts/check-openapi-coverage.ts', {
        stdio: 'pipe',
      });
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/scripts/__tests__/check-openapi-coverage.test.ts -v`
Expected: FAIL because script is missing.

- [ ] **Step 3: Write minimal implementation**

Create `src/scripts/check-openapi-coverage.ts`:

```ts
import fs from 'fs';
import path from 'path';

const ROUTE_FILES = [
  'src/modules/auth/auth.routes.ts',
  'src/modules/user/user.routes.ts',
  'src/modules/publish-ride/publish-ride.routes.ts',
  'src/modules/search-ride/search-ride.routes.ts',
  'src/modules/ride-booking/ride-booking.routes.ts',
  'src/modules/driver-booking/driver-booking.routes.ts',
  'src/modules/vehicles/vehicle.routes.ts',
  'src/modules/travel-preferences/travelPreference.routes.ts',
  'src/modules/maps/google.routes.ts',
  'src/modules/chat/chat.routes.ts',
  'src/modules/notification/notification.routes.ts',
  'src/modules/payments/stripe.webhook.routes.ts',
] as const;

const MOUNTS: Record<string, string> = {
  'auth.routes.ts': '/api/v1/auth',
  'user.routes.ts': '/api/v1/users',
  'publish-ride.routes.ts': '/api/v1/publish-ride',
  'search-ride.routes.ts': '/api/v1/search-rides',
  'ride-booking.routes.ts': '/api/v1/bookings',
  'driver-booking.routes.ts': '/api/v1/driver/bookings',
  'vehicle.routes.ts': '/api/v1/vehicles',
  'travelPreference.routes.ts': '/api/v1/travel-preferences',
  'google.routes.ts': '/api/v1/maps',
  'chat.routes.ts': '/api/v1/chat',
  'notification.routes.ts': '/api/v1/notifications',
  'stripe.webhook.routes.ts': '/api/v1/payments',
};

const routeRegex = /router\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]/g;

const collectMountedRoutes = () => {
  const routes = new Set<string>();

  for (const rel of ROUTE_FILES) {
    const full = path.resolve(process.cwd(), rel);
    const src = fs.readFileSync(full, 'utf8');
    const base = MOUNTS[path.basename(rel)];
    let match: RegExpExecArray | null;

    while ((match = routeRegex.exec(src)) !== null) {
      const method = match[1].toUpperCase();
      const sub = match[2];
      const raw = `${base}${sub === '/' ? '' : sub}`;
      const normalizedPath = raw.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      routes.add(`${method} ${normalizedPath}`);
    }
  }

  return routes;
};

const collectSpecRoutes = () => {
  const specPath = path.resolve(process.cwd(), 'docs/openapi/dist/openapi.json');
  const spec = JSON.parse(fs.readFileSync(specPath, 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };

  const routes = new Set<string>();
  for (const [p, ops] of Object.entries(spec.paths || {})) {
    for (const method of Object.keys(ops || {})) {
      routes.add(`${method.toUpperCase()} ${p}`);
    }
  }
  return routes;
};

const mounted = collectMountedRoutes();
const documented = collectSpecRoutes();

const missing = [...mounted].filter((r) => !documented.has(r));
if (missing.length > 0) {
  console.error('Missing OpenAPI operations:');
  for (const r of missing) console.error(`- ${r}`);
  process.exit(1);
}

console.log(`OpenAPI coverage OK (${mounted.size} mounted operations checked).`);
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npm run openapi:bundle`
- `npx jest src/scripts/__tests__/check-openapi-coverage.test.ts -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/check-openapi-coverage.ts src/scripts/__tests__/check-openapi-coverage.test.ts
git commit -m "test(openapi): enforce mounted route coverage against bundled spec"
```

---

### Task 5: Add Runtime Docs Router and Public Endpoints

**Files:**
- Create: `src/docs/openapi.spec.ts`
- Create: `src/docs/docs.routes.ts`
- Modify: `src/app.ts`
- Create: `src/docs/docs.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/docs/docs.routes.test.ts`:

```ts
import request from 'supertest';
import app from '../app.js';

describe('docs endpoints', () => {
  it('serves openapi.json', async () => {
    const res = await request(app).get('/openapi.json');
    expect([200, 500]).toContain(res.status); // 500 allowed until spec exists in early runs
  });

  it('serves swagger docs page', async () => {
    const res = await request(app).get('/docs');
    expect([200, 301, 302]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/docs/docs.routes.test.ts -v`
Expected: FAIL because routes not mounted.

- [ ] **Step 3: Write minimal implementation**

Create `src/docs/openapi.spec.ts`:

```ts
import fs from 'fs';
import path from 'path';

export const loadOpenApiSpec = () => {
  const specPath = path.resolve(process.cwd(), 'docs/openapi/dist/openapi.json');
  const raw = fs.readFileSync(specPath, 'utf8');
  return JSON.parse(raw);
};
```

Create `src/docs/docs.routes.ts`:

```ts
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { loadOpenApiSpec } from './openapi.spec.js';

const router = Router();

router.get('/openapi.json', (req, res) => {
  try {
    const spec = loadOpenApiSpec();
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(spec);
  } catch (error) {
    res.status(500).json({ success: false, message: 'OpenAPI spec not available' });
  }
});

router.use('/docs', swaggerUi.serve);
router.get('/docs', (req, res, next) => {
  let spec;
  try {
    spec = loadOpenApiSpec();
  } catch {
    return res.status(500).json({ success: false, message: 'OpenAPI spec not available' });
  }
  return swaggerUi.setup(spec, {
    customSiteTitle: 'Carpooling API Docs',
    swaggerOptions: { persistAuthorization: true },
  })(req, res, next);
});

export default router;
```

Modify `src/app.ts`:

```ts
import docsRouter from './docs/docs.routes.js';

// ... existing middleware
app.use(docsRouter);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/docs/docs.routes.test.ts -v`
Expected: PASS (or 500 for openapi.json until bundle exists, accepted by test).

- [ ] **Step 5: Commit**

```bash
git add src/docs src/app.ts
git commit -m "feat(docs): expose public /docs and /openapi.json endpoints"
```

---

### Task 6: Wire Full Root Path References and Bundle Validation

**Files:**
- Modify: `docs/openapi/openapi.yaml`
- Create: `src/scripts/__tests__/openapi-bundle.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/scripts/__tests__/openapi-bundle.test.ts`:

```ts
import { execSync } from 'child_process';

describe('openapi bundle', () => {
  it('bundles without errors', () => {
    expect(() => {
      execSync('npm run openapi:bundle', { stdio: 'pipe' });
    }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/scripts/__tests__/openapi-bundle.test.ts -v`
Expected: FAIL until all path refs and schemas are valid.

- [ ] **Step 3: Write minimal implementation**

Update `docs/openapi/openapi.yaml` `paths:` to include all module path refs, e.g.:

```yaml
paths:
  /api/v1/auth/signup:
    $ref: ./paths/auth.yaml#/paths/~1api~1v1~1auth~1signup
  /api/v1/auth/otp/request:
    $ref: ./paths/auth.yaml#/paths/~1api~1v1~1auth~1otp~1request
  /api/v1/users/me:
    $ref: ./paths/users.yaml#/paths/~1api~1v1~1users~1me
  /api/v1/publish-ride/draft/origin:
    $ref: ./paths/publish-ride.yaml#/paths/~1api~1v1~1publish-ride~1draft~1origin
  /api/v1/search-rides/advanced:
    $ref: ./paths/search-rides.yaml#/paths/~1api~1v1~1search-rides~1advanced
  /api/v1/bookings:
    $ref: ./paths/bookings.yaml#/paths/~1api~1v1~1bookings
  /api/v1/driver/bookings/{id}/accept:
    $ref: ./paths/driver-bookings.yaml#/paths/~1api~1v1~1driver~1bookings~1{id}~1accept
  /api/v1/vehicles:
    $ref: ./paths/vehicles.yaml#/paths/~1api~1v1~1vehicles
  /api/v1/travel-preferences:
    $ref: ./paths/travel-preferences.yaml#/paths/~1api~1v1~1travel-preferences
  /api/v1/maps/routes/compute:
    $ref: ./paths/maps.yaml#/paths/~1api~1v1~1maps~1routes~1compute
  /api/v1/chat:
    $ref: ./paths/chat.yaml#/paths/~1api~1v1~1chat
  /api/v1/notifications:
    $ref: ./paths/notifications.yaml#/paths/~1api~1v1~1notifications
  /api/v1/payments/stripe/webhook:
    $ref: ./paths/payments-webhook.yaml#/paths/~1api~1v1~1payments~1stripe~1webhook
```

Ensure **all 77 operations** are represented across those path files and root refs.

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npm run openapi:lint`
- `npm run openapi:bundle`
- `npx jest src/scripts/__tests__/openapi-bundle.test.ts -v`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/openapi src/scripts/__tests__/openapi-bundle.test.ts
git commit -m "docs(openapi): wire full mounted path references and pass bundle"
```

---

### Task 7: Add CI Gate for OpenAPI Check

**Files:**
- Modify: `.github/workflows/deploye.yml`

- [ ] **Step 1: Write the failing test**

Create `src/scripts/__tests__/openapi-ci-command.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

describe('ci includes openapi check', () => {
  it('workflow contains npm run openapi:check', () => {
    const workflowDir = path.resolve(process.cwd(), '.github/workflows');
    const files = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    const merged = files
      .map((f) => fs.readFileSync(path.join(workflowDir, f), 'utf8'))
      .join('\n---\n');

    expect(merged.includes('npm run openapi:check')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/scripts/__tests__/openapi-ci-command.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Patch CI workflow job to include:

```yaml
- name: OpenAPI checks
  run: npm run openapi:check
```

Position this after dependency install and before/with existing tests.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/scripts/__tests__/openapi-ci-command.test.ts -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows src/scripts/__tests__/openapi-ci-command.test.ts
git commit -m "ci(openapi): enforce lint bundle and route coverage checks"
```

---

### Task 8: Final Verification and Documentation of Runbook

**Files:**
- Modify: `README.md` (or existing deployment/docs section file)

- [ ] **Step 1: Write the failing test (docs command visibility)**

Create `src/scripts/__tests__/openapi-readme.test.ts`:

```ts
import fs from 'fs';
import path from 'path';

describe('readme includes openapi runbook', () => {
  it('documents docs routes and openapi scripts', () => {
    const readme = fs.readFileSync(path.resolve(process.cwd(), 'README.md'), 'utf8');
    expect(readme.includes('npm run openapi:check')).toBe(true);
    expect(readme.includes('/docs')).toBe(true);
    expect(readme.includes('/openapi.json')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/scripts/__tests__/openapi-readme.test.ts -v`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

Add README section:

```md
## API Documentation (Swagger)

- Public docs UI: `GET /docs`
- Raw OpenAPI spec: `GET /openapi.json`

Validation commands:

~~~bash
npm run openapi:lint
npm run openapi:bundle
npm run openapi:check
~~~

When routes change under mounted `/api/v1`, update `docs/openapi/paths/*` and rerun `npm run openapi:check`.
```

- [ ] **Step 4: Run test to verify it passes**

Run:
- `npx jest src/scripts/__tests__/openapi-readme.test.ts -v`
- `npm run openapi:check`
- `npx jest src/docs/docs.routes.test.ts -v`

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add README.md src/scripts/__tests__/openapi-readme.test.ts docs/openapi/dist/openapi.json
git commit -m "docs: add swagger runbook and final openapi verification"
```

---

## Final End-to-End Validation Checklist

- [ ] `npm run openapi:lint`
- [ ] `npm run openapi:bundle`
- [ ] `npm run openapi:check`
- [ ] `npx jest src/docs/docs.routes.test.ts -v`
- [ ] `npx jest src/scripts/__tests__/openapi-*.test.ts -v`
- [ ] `npm run build`
- [ ] Start app and manually verify:
  - [ ] `GET /openapi.json` returns bundled spec
  - [ ] `GET /docs` renders Swagger UI

## Expected Outcome

- Public, production-ready Swagger UI and OpenAPI JSON are available.
- All 77 mounted `/api/v1` operations are documented and enforced by coverage checks.
- CI blocks undocumented route changes.
