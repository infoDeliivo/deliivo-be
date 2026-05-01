# DL Verification API Reference

## Create Veriff Session

**Endpoint:** `POST /api/v1/dl-verification`  
**Auth:** Required (JWT Bearer token)

### Request Body

All fields except `firstName` and `lastName` are optional.

#### Required Fields

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `firstName` | string | Person's first name | Required, 1-100 characters |
| `lastName` | string | Person's last name | Required, 1-100 characters |

#### Optional Person Fields

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `email` | string | Person's email address | Valid email format |
| `phoneNumber` | string | Person's phone number | 1-20 characters |
| `dateOfBirth` | string | Person's date of birth | Format: YYYY-MM-DD |
| `gender` | string | Person's gender | Enum: 'M', 'MALE', 'F', 'FEMALE' |
| `idNumber` | string | National identification number | 1-50 characters |
| `fullName` | string | Person's full name (for unstructured docs) | 1-200 characters |

#### Optional Document Fields

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `documentNumber` | string | Driver's license number | 1-50 characters |
| `documentCountry` | string | Document issuing country | ISO 3166-1 Alpha-2 (2 chars) |
| `documentValidFrom` | string | Document issue date | Format: YYYY-MM-DD |
| `documentValidUntil` | string | Document expiry date | Format: YYYY-MM-DD |

#### Optional Address Fields

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `fullAddress` | string | Complete address | 1-500 characters |

#### Optional Session Configuration

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `callback` | string | Custom callback URL | Valid URL format |
| `endUserId` | string | UUID for your system | Valid UUID format |
| `consents` | array | Array of consent objects | See consent schema below |
| `tag` | string | Custom marker for session | 1-64 characters |

#### Consent Object Schema

```typescript
{
  type: 'ine' | 'bipa' | 'aadhaar' | 'general' | 'dvs',
  approved: boolean
}
```

### Example Request - Minimal

```json
POST /api/v1/dl-verification
Authorization: Bearer <token>

{
  "firstName": "John",
  "lastName": "Smith"
}
```

### Example Request - Full

```json
POST /api/v1/dl-verification
Authorization: Bearer <token>

{
  "firstName": "John",
  "lastName": "Smith",
  "email": "john.smith@example.com",
  "phoneNumber": "8888888888",
  "dateOfBirth": "1990-01-01",
  "gender": "M",
  "idNumber": "DL1234567890",
  "fullName": "John Smith",
  "documentNumber": "DL1234567890",
  "documentCountry": "IN",
  "documentValidFrom": "2020-01-01",
  "documentValidUntil": "2030-01-01",
  "fullAddress": "123, Main Street, Mumbai, Maharashtra 400001",
  "endUserId": "c1de400b-1877-4284-8494-071d37916197",
  "consents": [
    {
      "type": "general",
      "approved": true
    }
  ],
  "tag": "dl_verification"
}
```

### Success Response

```json
{
  "success": true,
  "message": "Veriff session created successfully",
  "data": {
    "verificationId": "uuid",
    "sessionId": "veriff-session-id",
    "sessionUrl": "https://magic.veriff.me/v/..."
  }
}
```

### Error Responses

#### Already Verified
```json
{
  "success": false,
  "message": "ALREADY_VERIFIED",
  "status": 409
}
```

#### Validation Error
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ],
  "status": 400
}
```

## Get Verification Status

**Endpoint:** `GET /api/v1/dl-verification/status`  
**Auth:** Required (JWT Bearer token)

### Success Response

```json
{
  "success": true,
  "message": "DL verification status retrieved",
  "data": {
    "status": "PENDING" | "APPROVED" | "DECLINED" | "RESUBMISSION_REQUESTED" | "EXPIRED" | "NOT_STARTED",
    "verificationId": "uuid",
    "sessionId": "veriff-session-id",
    "sessionUrl": "https://magic.veriff.me/v/...",
    "createdAt": "2024-01-01T00:00:00.000Z",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## Webhook (Internal)

**Endpoint:** `POST /api/v1/dl-verification/webhook`  
**Auth:** HMAC signature validation

This endpoint is called by Veriff to notify about verification decisions. It's validated using HMAC-SHA256 signature.
