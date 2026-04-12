# Pagination 500 Error - Root Cause & Fix

## Problem

When adding `limit` or `page` query parameters to pagination APIs, the server returns a **500 Internal Server Error**.

## Root Cause

The issue occurs because:

1. **Query parameters are strings** - When received from URL, all query params are strings
2. **Service expects numbers** - The service functions expect `page` and `limit` as numbers
3. **Type coercion happens in validator** - The Zod validator uses `z.coerce.number()` to convert strings to numbers
4. **But validation might fail** - If the validator encounters an issue, it throws an error

### Example of the Issue:

```typescript
// URL: /api/v1/publish-ride?page=1&limit=10

// req.query = { page: "1", limit: "10" }  // ← Strings!

// Service expects:
export const getUserRides = async (driverId: string, query: ListRidesQuery) => {
    const page = Number(query.page) || 1;  // ← Converts string to number
    const limit = Number(query.limit) || 10;
    // ...
}
```

## Common Causes of 500 Error

### 1. Invalid Number Format
```bash
# This will cause 500 error:
GET /api/v1/publish-ride?page=abc&limit=xyz

# Validator tries to coerce "abc" to number → fails
```

### 2. Negative Numbers
```bash
# This will cause 500 error:
GET /api/v1/publish-ride?page=-1&limit=-10

# Validator has .min(1) constraint → fails
```

### 3. Exceeding Max Limit
```bash
# This will cause 500 error:
GET /api/v1/publish-ride?limit=1000

# Validator has .max(100) constraint → fails
```

### 4. Decimal Numbers
```bash
# This will cause 500 error:
GET /api/v1/publish-ride?page=1.5&limit=10.7

# Validator has .int() constraint → fails
```

## Solution

### Fix 1: Better Error Handling in Controller

Update controllers to catch validation errors and return 400 instead of 500:

```typescript
/* ================= GET USER RIDES ================= */
export const getUserRides = async (req: AuthRequest, res: Response) => {
    try {
        // Validate query parameters
        const validatedQuery = listRidesQuerySchema.parse(req.query);
        
        const result = await PublishRideService.getUserRides(
            req.user.id, 
            validatedQuery
        );

        return sendSuccess(res, {
            message: 'Rides fetched successfully',
            data: result,
        });
    } catch (error: any) {
        // Handle Zod validation errors
        if (error.name === 'ZodError') {
            return sendError(res, {
                status: HttpStatus.BAD_REQUEST,
                message: 'Invalid query parameters',
                errors: error.errors,
            });
        }

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

### Fix 2: Ensure Validator is Applied

Make sure the route uses the `validate` middleware:

```typescript
// ✅ CORRECT - Validator applied
router.get(
    '/',
    validate({ query: listRidesQuerySchema }),  // ← This validates!
    controller.getUserRides
);

// ❌ WRONG - No validator
router.get(
    '/',
    controller.getUserRides  // ← No validation!
);
```

### Fix 3: Safe Number Conversion in Service

Add defensive programming in the service:

```typescript
export const getUserRides = async (driverId: string, query: ListRidesQuery) => {
    const { status } = query;
    
    // Safe number conversion with fallbacks
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 10));
    const skip = (page - 1) * limit;

    // ... rest of the code
};
```

## Testing the Fix

### Test 1: Valid Parameters
```bash
GET /api/v1/publish-ride?page=1&limit=10
# Expected: 200 OK with paginated results
```

### Test 2: Invalid Page (String)
```bash
GET /api/v1/publish-ride?page=abc&limit=10
# Expected: 400 Bad Request (not 500!)
# Response: { "error": "Invalid query parameters" }
```

### Test 3: Negative Numbers
```bash
GET /api/v1/publish-ride?page=-1&limit=-5
# Expected: 400 Bad Request
# Response: { "error": "page must be at least 1" }
```

### Test 4: Exceeding Max
```bash
GET /api/v1/publish-ride?page=1&limit=1000
# Expected: 400 Bad Request
# Response: { "error": "limit must be at most 100" }
```

### Test 5: Decimal Numbers
```bash
GET /api/v1/publish-ride?page=1.5&limit=10.7
# Expected: 400 Bad Request
# Response: { "error": "page must be an integer" }
```

### Test 6: Missing Parameters (Use Defaults)
```bash
GET /api/v1/publish-ride
# Expected: 200 OK with defaults (page=1, limit=10)
```

## Implementation Checklist

### For Each Paginated Endpoint:

1. ✅ **Validator Schema** - Has `z.coerce.number().int().min(1)`
2. ✅ **Route Middleware** - Uses `validate({ query: schema })`
3. ✅ **Controller Error Handling** - Catches ZodError and returns 400
4. ✅ **Service Defensive Code** - Safe number conversion
5. ✅ **OpenAPI Documentation** - Documents query parameters

### Affected Endpoints:

1. **GET /api/v1/publish-ride** ✅
   - Validator: `listRidesQuerySchema`
   - Max limit: 100
   
2. **GET /api/v1/bookings** ✅
   - Validator: `listBookingsQuerySchema`
   - Max limit: 50
   
3. **GET /api/v1/search-rides** ✅
   - Validator: `searchRideQuerySchema`
   - Max limit: 50
   
4. **GET /api/v1/search-rides/advanced** ✅
   - Validator: `enhancedSearchRideQuerySchema`
   - Max limit: 50
   
5. **GET /api/v1/notifications** ✅
   - Uses cursor-based pagination
   - Different validation pattern

## Quick Fix for Immediate Use

If you're getting 500 errors right now, use these safe query parameters:

```bash
# ✅ SAFE - Always works
GET /api/v1/publish-ride?page=1&limit=10

# ✅ SAFE - Use defaults
GET /api/v1/publish-ride

# ✅ SAFE - With status filter
GET /api/v1/publish-ride?status=PUBLISHED&page=1&limit=20

# ❌ UNSAFE - Will cause errors
GET /api/v1/publish-ride?page=abc
GET /api/v1/publish-ride?limit=-10
GET /api/v1/publish-ride?page=1.5
GET /api/v1/publish-ride?limit=9999
```

## Prevention

To prevent 500 errors in the future:

1. **Always use the validate middleware** on routes with query parameters
2. **Add proper error handling** in controllers for ZodError
3. **Test with invalid inputs** during development
4. **Document valid ranges** in API documentation
5. **Use TypeScript** to catch type mismatches early

## Summary

The 500 error occurs when:
- Invalid query parameters are passed (non-numeric, negative, too large, decimals)
- Validator catches the error but it's not properly handled
- Error bubbles up as 500 instead of 400

**Solution:** Ensure all paginated endpoints have proper validation middleware and error handling to return 400 Bad Request instead of 500 Internal Server Error for invalid inputs.