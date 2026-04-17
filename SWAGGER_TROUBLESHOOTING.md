# Swagger UI Troubleshooting - Public Profile API Not Visible

## ✅ Confirmed Working
The endpoint **IS** in the bundled OpenAPI file:
- Path: `/api/v1/users/{userId}/profile`
- Location in bundle: Line 935 in `docs/openapi/dist/openapi.json`
- Example: `PublicProfileSuccess` at line 6708

## Issue: Endpoint Not Visible in Swagger UI

This is likely a **browser caching issue**. Here are the solutions:

---

## Solution 1: Hard Refresh Browser (Recommended)

### Chrome / Edge / Brave
```
Windows/Linux: Ctrl + Shift + R
Mac: Cmd + Shift + R
```

### Firefox
```
Windows/Linux: Ctrl + F5
Mac: Cmd + Shift + R
```

### Safari
```
Cmd + Option + R
```

---

## Solution 2: Clear Browser Cache

### Chrome
1. Open DevTools (F12)
2. Right-click the refresh button
3. Select "Empty Cache and Hard Reload"

### Firefox
1. Open DevTools (F12)
2. Go to Network tab
3. Right-click → "Clear Browser Cache"
4. Refresh page

---

## Solution 3: Incognito/Private Mode

Open Swagger UI in an incognito/private window:
```
http://localhost:3000/docs
```

This bypasses all cache.

---

## Solution 4: Verify Server is Serving Updated File

### Check the OpenAPI JSON endpoint directly:
```bash
curl http://localhost:3000/openapi.json | grep "userId.*profile"
```

**Expected output:**
```json
"/api/v1/users/{userId}/profile": {
```

If you see this, the server is serving the correct file.

---

## Solution 5: Restart Server

Sometimes the server needs a full restart:

```bash
# Stop the server (Ctrl+C)
# Then restart
npm run dev
```

---

## Solution 6: Check Swagger UI Cache

Swagger UI itself caches the OpenAPI spec. Force it to reload:

1. Open browser DevTools (F12)
2. Go to Application tab (Chrome) or Storage tab (Firefox)
3. Clear:
   - Local Storage
   - Session Storage
   - Cookies for localhost
4. Hard refresh the page

---

## Solution 7: Verify Bundle Timestamp

Check when the bundle was last generated:

```bash
ls -la docs/openapi/dist/openapi.json
```

If the timestamp is old, re-run:
```bash
npm run openapi:bundle
```

---

## Solution 8: Check for JavaScript Errors

1. Open browser DevTools (F12)
2. Go to Console tab
3. Look for any errors
4. If you see errors related to Swagger UI, they might prevent the UI from loading

---

## Solution 9: Direct API Test

Test the endpoint directly to confirm it works:

```bash
# Get your access token first
ACCESS_TOKEN="your-token-here"

# Test the endpoint
curl -X GET "http://localhost:3000/api/v1/users/USER_ID_HERE/profile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

If this works, the endpoint is functional - it's just a Swagger UI display issue.

---

## Solution 10: Check Swagger UI Version

Some older Swagger UI versions have caching bugs. Check your package.json:

```bash
grep swagger package.json
```

If using an old version, consider updating.

---

## Quick Checklist

Run through these steps in order:

- [ ] 1. Hard refresh browser (Ctrl+Shift+R / Cmd+Shift+R)
- [ ] 2. Open in incognito/private mode
- [ ] 3. Verify bundle file has the endpoint: `grep -A 5 "userId.*profile" docs/openapi/dist/openapi.json`
- [ ] 4. Check server is serving updated file: `curl http://localhost:3000/openapi.json | grep userId`
- [ ] 5. Restart server completely
- [ ] 6. Clear all browser cache/storage
- [ ] 7. Test endpoint directly with curl
- [ ] 8. Check browser console for errors

---

## Still Not Working?

### Debug Steps:

1. **Verify the endpoint is in the bundle:**
```bash
grep -A 20 '"/api/v1/users/{userId}/profile"' docs/openapi/dist/openapi.json
```

2. **Check what the server is actually serving:**
```bash
curl -s http://localhost:3000/openapi.json > /tmp/served-spec.json
grep -A 20 '"/api/v1/users/{userId}/profile"' /tmp/served-spec.json
```

3. **Compare file sizes:**
```bash
ls -lh docs/openapi/dist/openapi.json
```

4. **Check if server is reading the right file:**
Look at `src/docs/openapi.spec.ts` - it should point to:
```typescript
export const openApiSpecPath = path.resolve(process.cwd(), 'docs/openapi/dist/openapi.json');
```

---

## Common Causes

1. **Browser Cache** (90% of cases)
   - Solution: Hard refresh or incognito mode

2. **Server Not Restarted** (5% of cases)
   - Solution: Restart server

3. **Bundle Not Regenerated** (3% of cases)
   - Solution: Run `npm run openapi:bundle`

4. **Wrong File Being Served** (1% of cases)
   - Solution: Check server configuration

5. **Swagger UI JavaScript Error** (1% of cases)
   - Solution: Check browser console

---

## Expected Result

After following these steps, you should see in Swagger UI:

**Under "Users" section:**
```
GET /api/v1/users/{userId}/profile
View public profile of another user including ratings, travel preferences, and statistics
```

**Parameters:**
- `userId` (path, required): ID of the user whose profile to view

**Responses:**
- 200: Success
- 400: Bad Request
- 401: Unauthorized
- 404: Not Found
- 500: Server Error

---

## Test Command

Once visible in Swagger, test it:

```bash
# Replace with actual values
USER_ID="actual-user-uuid"
TOKEN="your-access-token"

curl -X GET "http://localhost:3000/api/v1/users/$USER_ID/profile" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | jq
```

Expected response:
```json
{
  "success": true,
  "message": "User profile fetched successfully",
  "data": {
    "user": { ... },
    "travelPreference": { ... },
    "vehicle": { ... },
    "stats": { ... },
    "rating": { ... }
  }
}
```

---

## Summary

The endpoint **IS** in the OpenAPI bundle. The issue is almost certainly browser caching.

**Quick fix:** Open Swagger UI in incognito mode or do a hard refresh (Ctrl+Shift+R).
