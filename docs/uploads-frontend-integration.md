# Upload API — Frontend Integration Guide

Presigned-upload flow. Frontend uploads bytes **directly to storage** (S3 or local dev receiver), then confirms with the backend. The backend never receives the file body — it only issues a signed URL and verifies the result.

Base path: `/api/v1/uploads`
Auth: all endpoints (except the local receiver) require `Authorization: Bearer <JWT>`.

---

## Quick start — pick target by screen

3-step flow (all uploads):

```
1. POST /api/v1/uploads/presign  → { key, uploadUrl, method:"PUT", headers, expiresIn:300 }
2. PUT  uploadUrl  (raw bytes, headers from step 1, NO auth header, NOT FormData)
3. POST /api/v1/uploads/confirm   → persists + returns final url/key
```

| Frontend screen | `target` | extra fields | confirm returns |
|---|---|---|---|
| User avatar | `avatar` | – | `{ avatarUrl }` |
| Vehicle photo (existing vehicle) | `vehicle_image` | `vehicleId` | `{ imageUrl }` |
| Vehicle doc (existing vehicle) | `vehicle_document` | `vehicleId`, `documentType` | `{ documentId, documentType }` (201) |
| Chat image | `chat_image` | – | `{ url, key }` (attach in send-message) |
| Draft car photo (no vehicleId yet) | `vehicle_draft_document` | – | `{ url, key }` → send `imageUrl` to draft |
| Draft KYC licence/insurance | `vehicle_draft_document_private` | – | `{ key }` → send `imageKey` to draft |

Constraints: `image/jpeg|png`, ext `jpg|jpeg|png`, max 5MB, presign URL TTL 300s.

Special flows (detail below): private KYC in draft → `/vehicles/draft/upload-document` with `imageKey`; view private doc → `documents[].previewKey` → `GET /uploads/read?key=`.

---

## The 2-step flow

```
1. POST /presign   → get { key, uploadUrl, method, headers }
2. PUT  uploadUrl  (raw file bytes, direct to storage)  → 200
3. POST /confirm   → backend verifies + persists, returns final URL
```

Never skip step 2 before step 3. Confirm checks the object actually exists, and validates its type/size.

---

## Targets

| target | needs `vehicleId` | needs `documentType` | visibility | confirm persists to |
|--------|:---:|:---:|--------|--------|
| `avatar` | – | – | public | user avatar |
| `vehicle_image` | ✅ | – | public | vehicle record |
| `vehicle_document` | ✅ | ✅ | **private** | vehicle document row |
| `chat_image` | – | – | public | nothing — returns `{ url, key }` to attach yourself |
| `vehicle_draft_document` | – | – | public | nothing — returns `{ url, key }` |
| `vehicle_draft_document_private` | – | – | **private** | nothing — returns `{ key }` only |

`chat_image` / `vehicle_draft_document` / `vehicle_draft_document_private` are one-shot: confirm just promotes the object and hands back a reference. You attach it via the chat-send or draft-upload-document endpoint.

> **Sensitive documents (driving licence, insurance) must use `vehicle_draft_document_private`** during vehicle creation — never `vehicle_draft_document`. The public target makes the object world-readable via its URL. The private target stores it in the private folder and returns only a `key`, which you send to `POST /vehicles/draft/upload-document` as `imageKey`. Only the rider-visible car photo (`VEHICLE_IMAGE`) should use the public `vehicle_draft_document`.

---

## Constraints

- Allowed content types: `image/jpeg`, `image/png`
- Allowed extensions: `jpg`, `jpeg`, `png`
- Max size: **5 MB** (enforced at confirm)
- Presigned URL TTL: **300 s** — upload promptly after presign
- `documentType` enum: `VEHICLE_IMAGE`, `VEHICLE_DOCUMENT`, `DRIVING_LICENSE`, `INSURANCE_DOCUMENT`

---

## 1. POST `/presign`

Request body:

```json
{
  "target": "avatar",
  "contentType": "image/png",
  "fileExtension": "png",
  "vehicleId": "<uuid>"        // only for vehicle_* targets
  // "documentType": "..."      // only for vehicle_document
}
```

Response:

```json
{
  "success": true,
  "message": "Presigned upload URL generated",
  "data": {
    "key": "tmp/avatar/<userId>/<uuid>.png",
    "uploadUrl": "https://...",
    "method": "PUT",
    "headers": { "Content-Type": "image/png" },
    "expiresIn": 300
  }
}
```

Keep `key` — you pass it back in step 3.

---

## 2. PUT to `uploadUrl`

Upload raw bytes. Use the exact `method` and `headers` returned.

```js
await fetch(uploadUrl, {
  method: 'PUT',
  headers,          // { 'Content-Type': contentType }
  body: file,       // File / Blob — raw, NOT FormData
});
```

Rules:
- Body is the **raw file** (Blob/File). Do **not** wrap in `FormData`.
- Send the same `Content-Type` you presigned with — a mismatch breaks the S3 signature.
- No `Authorization` header on this request (the URL is pre-signed).

---

## 3. POST `/confirm`

```json
{
  "target": "avatar",
  "key": "tmp/avatar/<userId>/<uuid>.png",
  "vehicleId": "<uuid>",        // vehicle_* targets
  "documentType": "..."          // vehicle_document only
}
```

Response varies by target:

```jsonc
// avatar
{ "data": { "avatarUrl": "https://..." } }

// vehicle_image
{ "data": { "imageUrl": "https://..." } }

// vehicle_document
{ "data": { "documentId": "...", "documentType": "..." } }   // 201

// chat_image / vehicle_draft_document
{ "data": { "url": "https://...", "key": "uploads/..." } }
```

Confirm errors:
- `400` — object not found (you skipped the PUT), unsupported type, or over 5 MB
- `403` — key doesn't belong to you / wrong target folder
- `404` — vehicle not found

---

## 4. GET `/read` — view a private object you own

Private objects (e.g. `vehicle_document`) have no public URL. Fetch a short-lived signed GET URL by key alone — no `target`/`vehicleId` needed. Authorization is by the owner id embedded in the key (`uploads/<folder>/<ownerId>/...`); you may only read objects stored under your own owner segment.

```
GET /api/v1/uploads/read?key=<key>
```

```json
{ "data": { "url": "https://...", "expiresIn": 300 } }
```

URL expires in 300 s — request on demand, don't cache. A key you don't own returns `404`.

Where do you get the key? `GET /api/v1/vehicles/:id` returns each document as `documents[].previewKey` — pass that value as `key` here.

---

## 5. DELETE `/`

```
DELETE /api/v1/uploads?target=avatar
DELETE /api/v1/uploads?target=vehicle_image&vehicleId=<uuid>
DELETE /api/v1/uploads?target=vehicle_document&vehicleId=<uuid>&key=<key>
```

Only `avatar`, `vehicle_image`, `vehicle_document` are deletable. `chat_image`/`vehicle_draft_document` are managed by their owning feature.

---

## End-to-end example (avatar)

```js
async function uploadAvatar(file, token) {
  const authHeaders = { Authorization: `Bearer ${token}` };
  const ext = file.name.split('.').pop().toLowerCase();

  // 1. presign
  const p = await fetch('/api/v1/uploads/presign', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'avatar', contentType: file.type, fileExtension: ext }),
  }).then(r => r.json());
  const { key, uploadUrl, method, headers } = p.data;

  // 2. upload bytes direct to storage
  await fetch(uploadUrl, { method, headers, body: file });

  // 3. confirm
  const c = await fetch('/api/v1/uploads/confirm', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'avatar', key }),
  }).then(r => r.json());

  return c.data.avatarUrl;
}
```

Vehicle image/document: same flow + `vehicleId` (and `documentType` for documents) in both presign and confirm.

---

## End-to-end example (private vehicle document — e.g. driving licence / insurance)

Private documents (`target: vehicle_document`) have **no public URL**. You upload them the same way, then view them through a short-lived signed URL. Two phases:

### Phase A — upload the document

```js
// documentType: 'DRIVING_LICENSE' | 'INSURANCE_DOCUMENT' | 'VEHICLE_DOCUMENT'
async function uploadVehicleDocument(file, vehicleId, documentType, token) {
  const authHeaders = { Authorization: `Bearer ${token}` };
  const ext = file.name.split('.').pop().toLowerCase();

  // 1. presign — vehicleId + documentType are required for vehicle_document
  const p = await fetch('/api/v1/uploads/presign', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target: 'vehicle_document',
      contentType: file.type,
      fileExtension: ext,
      vehicleId,
      documentType,
    }),
  }).then(r => r.json());
  const { key, uploadUrl, method, headers } = p.data;

  // 2. upload raw bytes straight to storage (no auth header, not FormData)
  await fetch(uploadUrl, { method, headers, body: file });

  // 3. confirm — persists a private VehicleDocument row
  const c = await fetch('/api/v1/uploads/confirm', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'vehicle_document', key, vehicleId, documentType }),
  }).then(r => r.json());

  return c.data; // { documentId, documentType }
}
```

### Phase B — list documents and view one

`GET /api/v1/vehicles/:id` returns every document. Each carries `documentType` (so you can tell a licence from insurance) and `previewKey` (the key you exchange for a signed URL).

```js
async function getVehicleDocuments(vehicleId, token) {
  const res = await fetch(`/api/v1/vehicles/${vehicleId}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then(r => r.json());
  return res.data.documents; // [{ id, documentType, previewKey, image, createdAt }, ...]
}

// Exchange a previewKey for a short-lived signed view URL (valid 300 s).
async function viewDocument(previewKey, token) {
  const res = await fetch(
    `/api/v1/uploads/read?key=${encodeURIComponent(previewKey)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  ).then(r => r.json());
  return res.data.url; // put straight into <img src> / open in a tab
}

// Example: render the driving licence
const docs = await getVehicleDocuments(vehicleId, token);
const licence = docs.find(d => d.documentType === 'DRIVING_LICENSE');
if (licence) {
  const url = await viewDocument(licence.previewKey, token);
  imgEl.src = url;
}
```

Rules for the view URL:
- Expires in **300 s** — fetch it **on demand** right before showing the image; do not cache or persist it.
- The key is authorized by its embedded owner — a `previewKey` you don't own returns `404`.
- `image` is `null` for private documents (that's expected); always use `previewKey` → `/read` for them.

### Attaching private docs during vehicle creation (draft flow)

When creating a vehicle via the draft flow (`/vehicles/draft/*`) there is no `vehicleId` yet, so use the private one-shot target instead of `vehicle_document`:

```js
// Upload a licence/insurance during draft creation → returns { key }
async function uploadDraftPrivateDoc(file, documentType, token) {
  const authHeaders = { Authorization: `Bearer ${token}` };
  const ext = file.name.split('.').pop().toLowerCase();

  const p = await fetch('/api/v1/uploads/presign', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target: 'vehicle_draft_document_private',
      contentType: file.type,
      fileExtension: ext,
    }),
  }).then(r => r.json());
  const { key, uploadUrl, method, headers } = p.data;

  await fetch(uploadUrl, { method, headers, body: file });

  const c = await fetch('/api/v1/uploads/confirm', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 'vehicle_draft_document_private', key }),
  }).then(r => r.json());

  // Attach to the draft by KEY (not URL)
  await fetch('/api/v1/vehicles/draft/upload-document', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageKey: c.data.key, documentType }),
  });
}
```

- Public car photo (`VEHICLE_IMAGE`): still upload via `vehicle_draft_document` and send `imageUrl` to `/vehicles/draft/upload-document`.
- Private KYC (`DRIVING_LICENSE`, `INSURANCE_DOCUMENT`): upload via `vehicle_draft_document_private` and send `imageKey`.
- `/vehicles/draft/upload-document` requires **exactly one** of `imageUrl` or `imageKey`.
- After `/vehicles/draft/save`, the private docs appear in `GET /vehicles/:id` with a populated `previewKey` and `image: null`.

---

## Notes for local dev

When S3 is not configured, `uploadUrl` points at `/api/v1/uploads/local/:token` on the same backend. The flow is identical — PUT raw bytes to that URL, then confirm. No frontend change needed; just use whatever `uploadUrl` presign returns.
