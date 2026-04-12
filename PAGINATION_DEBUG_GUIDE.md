# Pagination 500 Error - Debug Guide & Solution

## Current Status

✅ **Validation Middleware is Correct**
```typescript
// src/middlewares/validate.ts
export const validate = (schemas: SchemaTargets) => (req, res, next) => {
  try {
    if (schemas.query) {
      const parsed = schemas.query.parse(req.query);
      Object.assign(req.query, parsed);
    }
    next();
  } catch (error) {
    if (error instanceof ZodError) {
      return res.status(400).json({  // ← Returns 400, not 500!
        success: false,
        message: 'Validation failed',
        errors: error.issues
      });
    }
    next(error);
  }
};
```

✅ **Routes Have Validation**
```typescript
// src/modules/publish-ride/publish-ride.routes.ts
router.get(
    '/',
    validate({ query: listRidesQuerySchema }),  // ← Validation applied!
    controller.getUserRides
);
```

✅ **Validators Are Correct**
```typescript
// src/modules/publish-ride/publish-ride.validator.ts
export const listRidesQuerySchema = z.object({
    status: z.nativeEnum(RideStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
});
```

## Why You Might Still Get 500 Error

### Scenario 1: Error in Service Layer

If the error happens AFTER validation, in the service:

```typescript
export const getUserRides = async (driverId: string, query: ListRidesQuery) => {
    const { status } = query;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    // If this query fails, you get 500
    const [rides, total] = await Promise.all([
        prisma.ride.findMany({ ... }),  // ← Database error = 500
        prisma.ride.count({ ... }),
    ]);
};
```

**Possible causes:**
- Database connection issue
- Invalid status enum value
- Prisma query error

### Scenario 2: Type Mismatch in Status Filter

```bash
# This might cause 500 if status validation fails:
GET /api/v1/publish-ride?status=INVALID_STATUS

# Valid statuses:
# - DRAFT
# - PUBLISHED
# - CANCELLED
# - COMPLETED
```

### Scenario 3: Missing Bookings Include

After our recent changes, we added `bookings` include. If there's an issue with that:

```typescript
const [rides, total] = await Promise.all([
    prisma.ride.findMany({
        where,
        include: { 
            waypoints: { orderBy: { orderIndex: 'asc' } },
            bookings: {  // ← If this fails, you get 500
                where: { status: { in: [...] } },
                // ...
            },
        },
    }),
]);
```

## Debugging Steps

### Step 1: Test with Minimal Parameters

```bash
# Test 1: No parameters (use defaults)
curl -X GET "http://localhost:3000/api/v1/publish-ride" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: 200 OK with page=1, limit=10
```

### Step 2: Test with Valid Parameters

```bash
# Test 2: Valid page and limit
curl -X GET "http://localhost:3000/api/v1/publish-ride?page=1&limit=5" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: 200 OK with 5 results
```

### Step 3: Test with Invalid Parameters

```bash
# Test 3: Invalid page (should return 400, not 500)
curl -X GET "http://localhost:3000/api/v1/publish-ride?page=abc" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: 400 Bad Request
# {
#   "success": false,
#   "message": "Validation failed",
#   "errors": [...]
# }
```

### Step 4: Test with Status Filter

```bash
# Test 4: Valid status
curl -X GET "http://localhost:3000/api/v1/publish-ride?status=PUBLISHED&page=1&limit=10" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: 200 OK

# Test 5: Invalid status (should return 400)
curl -X GET "http://localhost:3000/api/v1/publish-ride?status=INVALID" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: 400 Bad Request
```

### Step 5: Check Server Logs

Look for the actual error in your server logs:

```bash
# Check logs for the actual error
tail -f logs/app.log

# Or if using console.log:
# Look at terminal where server is running
```

## Common 500 Error Causes & Fixes

### Cause 1: Database Connection Issue

**Error:**
```
PrismaClientKnownRequestError: Can't reach database server
```

**Fix:**
```bash
# Check database connection
# Verify DATABASE_URL in .env
# Restart database if needed
```

### Cause 2: Invalid Enum Value

**Error:**
```
Invalid value for enum RideStatus
```

**Fix:**
Update validator to handle invalid enums:
```typescript
export const listRidesQuerySchema = z.object({
    status: z.enum(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED']).optional(),
    // Or use z.nativeEnum(RideStatus).optional()
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
});
```

### Cause 3: Bookings Include Error

**Error:**
```
Invalid `prisma.ride.findMany()` invocation
```

**Fix:**
Check if bookings relation exists in schema:
```prisma
model Ride {
  id String @id @default(uuid())
  // ...
  bookings RideBooking[]  // ← Must exist
}
```

### Cause 4: Missing User Authentication

**Error:**
```
Cannot read property 'id' of undefined
```

**Fix:**
Ensure you're sending valid auth token:
```bash
curl -X GET "http://localhost:3000/api/v1/publish-ride" \
  -H "Authorization: Bearer VALID_TOKEN_HERE"
```

## Solution: Enhanced Error Handling

Add better error logging in controller:

```typescript
export const getUserRides = async (req: AuthRequest, res: Response) => {
    try {
        const result = await PublishRideService.getUserRides(req.user.id, req.query as any);

        return sendSuccess(res, {
            message: 'Rides fetched successfully',
            data: result,
        });
    } catch (error: any) {
        // Log the actual error for debugging
        console.error('getUserRides error:', {
            message: error.message,
            stack: error.stack,
            query: req.query,
            userId: req.user.id,
        });

        return sendError(res, {
            status: error.message === 'RIDE_NOT_FOUND'
                ? HttpStatus.NOT_FOUND
                : HttpStatus.INTERNAL_ERROR,
            message: error.message === 'RIDE_NOT_FOUND'
                ? 'Ride not found'
                : 'Failed to fetch rides',
        });
    }
};
```

## Quick Test Script

Create a test file `test-pagination.sh`:

```bash
#!/bin/bash

API_URL="http://localhost:3000/api/v1/publish-ride"
TOKEN="YOUR_AUTH_TOKEN_HERE"

echo "Test 1: No parameters"
curl -s -X GET "$API_URL" -H "Authorization: Bearer $TOKEN" | jq .

echo "\nTest 2: Valid pagination"
curl -s -X GET "$API_URL?page=1&limit=5" -H "Authorization: Bearer $TOKEN" | jq .

echo "\nTest 3: Invalid page (should be 400)"
curl -s -X GET "$API_URL?page=abc" -H "Authorization: Bearer $TOKEN" | jq .

echo "\nTest 4: Exceeding max limit (should be 400)"
curl -s -X GET "$API_URL?limit=1000" -H "Authorization: Bearer $TOKEN" | jq .

echo "\nTest 5: With status filter"
curl -s -X GET "$API_URL?status=PUBLISHED&page=1&limit=10" -H "Authorization: Bearer $TOKEN" | jq .
```

Run it:
```bash
chmod +x test-pagination.sh
./test-pagination.sh
```

## Expected Behavior

| Request | Expected Status | Expected Response |
|---------|----------------|-------------------|
| `?page=1&limit=10` | 200 | Paginated rides |
| `?page=abc` | 400 | Validation error |
| `?limit=-5` | 400 | Validation error |
| `?limit=1000` | 400 | Exceeds max (100) |
| `?page=1.5` | 400 | Must be integer |
| No params | 200 | Defaults (page=1, limit=10) |
| `?status=INVALID` | 400 | Invalid enum |
| `?status=PUBLISHED` | 200 | Filtered results |

## If Still Getting 500

1. **Check server logs** - The actual error message will tell you what's wrong
2. **Test database connection** - Run `npx prisma studio` to verify DB is accessible
3. **Check Prisma schema** - Ensure all relations are properly defined
4. **Verify auth token** - Make sure you're using a valid, non-expired token
5. **Check environment variables** - Ensure DATABASE_URL and other vars are set
6. **Run migrations** - `npx prisma migrate dev` to ensure DB schema is up to date

## Summary

The pagination system is correctly implemented with:
- ✅ Proper validation middleware
- ✅ Zod schemas with coercion
- ✅ Error handling returning 400 for validation errors
- ✅ Default values for missing parameters

If you're still getting 500 errors, it's likely:
1. Database connection issue
2. Invalid enum value in status filter
3. Missing relation in Prisma schema
4. Authentication problem

Check the server logs to see the actual error message!