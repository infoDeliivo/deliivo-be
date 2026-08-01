# DL Verification — How the Flow Works

Driving-licence KYC runs through Veriff. **Two session paths exist**, and which one runs is
decided in the webapp at `src/components/DlVerification.tsx` (`start`), by whether
`NEXT_PUBLIC_VERIFF_API_KEY` is set:

| Key | Path | What the driver sees |
|---|---|---|
| empty | **A** — backend creates the session | full-page redirect to `alchemy.veriff.com` |
| set | **B** — browser SDK creates the session | in-app overlay, never leaves the site |

Today the key is not set in `.env.local`, so **path A is what actually runs**.

Both paths end at the same decision webhook, and only that webhook can set
`dlVerified = true`.

---

## Path A — hosted redirect (active today)

```mermaid
sequenceDiagram
    autonumber
    participant U as Driver
    participant W as Webapp
    participant B as Backend
    participant V as Veriff

    U->>W: click "Verify licence"
    W->>W: firstName + lastName present?
    Note over W: missing, status needs-profile and stop
    W->>W: veriffApiKey empty, use hosted redirect
    W->>B: POST /api/v1/dl-verification
    B->>B: already APPROVED, respond 409
    B->>B: profile has dob and MALE/FEMALE, else 400 PROFILE_INCOMPLETE
    B->>B: name equals profile name, else 400 NAME_DOES_NOT_MATCH_PROFILE
    B->>V: POST /v1/sessions signed with the shared secret
    Note over B,V: vendorData is the user id, person.dateOfBirth<br/>and gender come from the profile, not the request
    V-->>B: verification id and url
    B->>B: DlVerification row created, status PENDING
    B-->>W: 201 with sessionId and sessionUrl
    W->>U: window.location.href = sessionUrl
    U->>V: completes the flow on Veriff
    V-->>U: returns to the callback URL, dropped if not HTTPS
```

Gate lives in `createVeriffSession` — `src/modules/dl-verification/dl-verification.service.ts`.
It refuses up front anything the webhook would refuse later, so a doomed check is never
paid for.

---

## Path B — browser SDK creates the session

```mermaid
sequenceDiagram
    autonumber
    participant U as Driver
    participant W as Webapp
    participant B as Backend
    participant V as Veriff

    U->>W: click "Verify licence"
    W->>V: js-sdk creates the session with the publishable key
    Note over W,V: person and vendorData are set client-side
    V-->>W: onSession returns verification id and url
    W->>B: POST /api/v1/dl-verification/register
    B->>B: already APPROVED, respond 409
    B->>B: session owned by another user, respond 409
    B->>B: same user again, idempotent 201
    B->>B: DlVerification row created, status PENDING
    B-->>W: 201
    W->>U: createVeriffFrame opens the overlay in-app
    U->>W: MESSAGES.FINISHED, status submitted
    Note over W: submitted is not approved, only the webhook decides
```

`registerVeriffSession` exists because the backend never sees a client-created session
otherwise, and a decision with no row has nothing to attach to.

**The pre-flight gate does not run on this path.** The profile-completeness and name checks
live in `createVeriffSession`, which path B never calls, so a driver can burn a Veriff check
on data that the webhook will then refuse.

---

## Decision webhook — identical for both paths

```mermaid
flowchart TD
    V[Veriff decision] -->|POST /api/v1/dl-verification/webhook| RAW[express.raw mount<br/>ahead of express.json]
    RAW --> SIG{x-hmac-signature valid}
    SIG -->|no header| E401[401 missing signature]
    SIG -->|unset secret, not 64 hex,<br/>or digest mismatch| E401b[401 invalid signature]
    SIG -->|valid| PARSE{body parses as JSON}
    PARSE -->|no| ACK[200 received with warning]
    PARSE -->|yes| OWNER[resolve the user:<br/>vendorData when it maps to one,<br/>otherwise the stored row]
    OWNER -->|neither| NF[200 SESSION_NOT_FOUND]
    OWNER --> MAP[map the Veriff status:<br/>approved, declined,<br/>resubmission_requested, expired]
    MAP -->|not approved| SAVE[write the status to the row]
    MAP -->|approved| ID{name, dob and gender<br/>match the profile}
    ID -->|no| MM[IDENTITY_MISMATCH<br/>the user stays unverified]
    ID -->|yes| OK[APPROVED<br/>dlVerified set to true]
    SAVE --> R200[200 received]
    MM --> R200
    OK --> R200
```

- The signature covers the **raw bytes**. The route is mounted at the exact path
  `/api/v1/dl-verification/webhook` with `express.raw()` ahead of `express.json()` in
  `src/app.ts` — re-serialising a parsed body changes the digest and rejects every real
  decision.
- Every processing outcome answers `200` so Veriff does not retry. Only signature problems
  return `401`.
- `vendorData` is set by the backend on path A and by the client on path B. Either way an
  approval is honoured only when the document identity matches the stored profile, so a
  client cannot verify itself by choosing what it sends.

---

## After the flow

```mermaid
flowchart LR
    S[Webapp polls<br/>GET /api/v1/dl-verification/status] --> ST{status}
    ST -->|PENDING| S
    ST -->|APPROVED| GATE[dlVerified is true]
    ST -->|RESUBMISSION_REQUESTED| RETRY[run the flow again]
    ST -->|DECLINED or EXPIRED| NEW[start a new session]
    ST -->|IDENTITY_MISMATCH| FIX[correct the profile first]
    GATE --> P[publish a ride and<br/>accept a booking allowed]
    NEW --> P2[403 DRIVER_NOT_VERIFIED]
    RETRY --> P2
    FIX --> P2
```

`IDENTITY_MISMATCH` means the licence was readable but its name, date of birth or gender did
not match the profile. Retrying with the same profile fails the same way — the profile has to
be corrected first.

See `docs/guides/frontend-integration-guide.md` §5 for the client-side steps and the copy to
show for each status.
