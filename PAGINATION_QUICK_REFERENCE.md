# Pagination Quick Reference Guide

## All Paginated Endpoints

### Offset-Based Pagination (5 endpoints)

#### 1. Publish Rides
```bash
GET /api/v1/publish-ride?page=1&limit=10&status=PUBLISHED
```
- Max limit: 100
- Default: page=1, limit=10

#### 2. Bookings
```bash
GET /api/v1/bookings?page=1&limit=10&status=CONFIRMED
```
- Max limit: 50
- Default: page=1, limit=10

#### 3. Search Rides
```bash
GET /api/v1/search-rides?originLat=51.5&originLng=-0.1&destinationLat=53.4&destinationLng=-2.2&departureDate=2026-04-20&page=1&limit=10
```
- Max limit: 50
- Default: page=1, limit=10

#### 4. Advanced Search
```bash
GET /api/v1/search-rides/advanced?originLat=51.5&originLng=-0.1&destinationLat=53.4&destinationLng=-2.2&departureDate=2026-04-20&page=1&limit=10
```
- Max limit: 50
- Default: page=1, limit=10

#### 5. Vehicles (NEW)
```bash
GET /api/v1/vehicles?page=1&limit=10
```
- Max limit: 50
- Default: page=1, limit=10

### Cursor-Based Pagination (3 endpoints)

#### 6. Notifications
```bash
GET /api/v1/notifications?cursor=uuid&limit=20
```
- Max limit: 50
- Default: limit=20

#### 7. Chat Conversations
```bash
GET /api/v1/chat?cursor=uuid&limit=20
```
- Max limit: 50
- Default: limit=20

#### 8. Chat Messages
```bash
GET /api/v1/chat/:conversationId/messages?cursor=uuid&limit=30
```
- Max limit: 100
- Default: limit=30

## Response Formats

### Offset-Based Response
```json
{
  "success": true,
  "message": "Items fetched successfully",
  "data": {
    "items": [...],
    "pagination": {
      "page": 1,
      "limit": 10,
      "total": 45,
      "totalPages": 5
    }
  }
}
```

### Cursor-Based Response
```json
{
  "success": true,
  "message": "Items fetched successfully",
  "data": {
    "items": [...],
    "nextCursor": "uuid-of-last-item",
    "hasMore": true
  }
}
```

## Validation Rules

### Offset-Based
- `page`: integer, min 1, default 1
- `limit`: integer, min 1, max 50-100 (varies by endpoint), default 10

### Cursor-Based
- `cursor`: UUID string, optional
- `limit`: integer, min 1, max 50-100 (varies by endpoint), default 20-30

## Error Responses

### 400 - Validation Error
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "page",
      "message": "Expected number, received nan"
    }
  ]
}
```

### 401 - Unauthorized
```json
{
  "success": false,
  "status": "UNAUTHORIZED",
  "message": "Not authorized, no token"
}
```

## Testing Template

```bash
# Set your token
TOKEN="your_access_token_here"

# Test endpoint
curl "http://localhost:3000/api/v1/ENDPOINT?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Test validation (should return 400)
curl "http://localhost:3000/api/v1/ENDPOINT?page=abc" \
  -H "Authorization: Bearer $TOKEN"

# Test max limit (should return 400)
curl "http://localhost:3000/api/v1/ENDPOINT?limit=1000" \
  -H "Authorization: Bearer $TOKEN"
```

## Implementation Pattern

### Validator
```typescript
export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
```

### Service
```typescript
export const getItems = async (userId: string, page = 1, limit = 10) => {
  const skip = (page - 1) * limit;
  
  const [items, total] = await Promise.all([
    prisma.item.findMany({ skip, take: limit }),
    prisma.item.count(),
  ]);
  
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};
```

### Controller
```typescript
export const getItems = async (req: AuthRequest, res: Response) => {
  const { page, limit } = req.query;
  const data = await Service.getItems(req.user.id, page, limit);
  return sendSuccess(res, { data });
};
```

### Routes
```typescript
router.get('/', validate({ query: listQuerySchema }), controller.getItems);
```

## Status: ✅ ALL COMPLETE

All 8 list endpoints have proper pagination with validation, error handling, and consistent response formats.
