# How Pagination Works - Complete Guide

## Table of Contents
1. [What is Pagination?](#what-is-pagination)
2. [Why Use Pagination?](#why-use-pagination)
3. [Offset-Based Pagination](#offset-based-pagination)
4. [Cursor-Based Pagination](#cursor-based-pagination)
5. [Practical Examples](#practical-examples)
6. [Code Implementation](#code-implementation)

---

## What is Pagination?

Pagination is a technique to split large datasets into smaller, manageable chunks (pages). Instead of returning all 1000 records at once, you return 10 records per page.

### Without Pagination ❌
```
Request: GET /api/v1/bookings
Response: Returns ALL 1000 bookings at once
Problems:
- Slow response time
- High memory usage
- Poor user experience
- Network bandwidth waste
```

### With Pagination ✅
```
Request: GET /api/v1/bookings?page=1&limit=10
Response: Returns only 10 bookings (page 1)
Benefits:
- Fast response time
- Low memory usage
- Better user experience
- Efficient network usage
```

---

## Why Use Pagination?

### 1. Performance
- **Server**: Processes less data per request
- **Database**: Executes faster queries
- **Network**: Transfers less data

### 2. User Experience
- **Faster loading**: Users see results immediately
- **Smooth scrolling**: Load more as needed
- **Better mobile experience**: Less data usage

### 3. Resource Management
- **Memory**: Prevents server memory overflow
- **Bandwidth**: Reduces network costs
- **Database**: Prevents query timeouts

---

## Offset-Based Pagination

### How It Works

Offset-based pagination uses **page number** and **limit** to determine which records to return.

```
Formula: skip = (page - 1) × limit
```

### Example: 100 Total Bookings

```
Total bookings: 100
Limit per page: 10
Total pages: 100 ÷ 10 = 10 pages

Page 1: Records 1-10   (skip 0, take 10)
Page 2: Records 11-20  (skip 10, take 10)
Page 3: Records 21-30  (skip 20, take 10)
...
Page 10: Records 91-100 (skip 90, take 10)
```

### Visual Representation

```
Database: [1][2][3][4][5][6][7][8][9][10][11][12][13][14][15]...

Page 1 (skip=0, take=10):
         [1][2][3][4][5][6][7][8][9][10]
         ↑ Start here, take 10

Page 2 (skip=10, take=10):
                                        [11][12][13][14][15]...
                                        ↑ Skip 10, then take 10

Page 3 (skip=20, take=10):
                                                              [21][22]...
                                                              ↑ Skip 20, then take 10
```

### API Request Examples

```bash
# Page 1: First 10 bookings
GET /api/v1/bookings?page=1&limit=10

# Page 2: Next 10 bookings
GET /api/v1/bookings?page=2&limit=10

# Page 3: Next 10 bookings
GET /api/v1/bookings?page=3&limit=10

# Custom: 20 bookings per page
GET /api/v1/bookings?page=1&limit=20
```

### Response Format

```json
{
  "success": true,
  "data": {
    "bookings": [
      { "id": "1", "status": "CONFIRMED" },
      { "id": "2", "status": "PENDING" },
      ...
    ],
    "pagination": {
      "page": 1,           // Current page
      "limit": 10,         // Items per page
      "total": 100,        // Total items
      "totalPages": 10     // Total pages
    }
  }
}
```

### How to Navigate Pages

```javascript
// Frontend example
const currentPage = 1;
const limit = 10;
const totalPages = 10;

// Go to next page
const nextPage = currentPage + 1; // 2
fetch(`/api/v1/bookings?page=${nextPage}&limit=${limit}`);

// Go to previous page
const prevPage = currentPage - 1; // 0 (invalid, stay on page 1)
if (prevPage >= 1) {
  fetch(`/api/v1/bookings?page=${prevPage}&limit=${limit}`);
}

// Go to last page
fetch(`/api/v1/bookings?page=${totalPages}&limit=${limit}`);

// Go to specific page
const targetPage = 5;
fetch(`/api/v1/bookings?page=${targetPage}&limit=${limit}`);
```

### Code Implementation

```typescript
// Service Layer
export const getBookings = async (userId: string, page = 1, limit = 10) => {
  // Calculate skip
  const skip = (page - 1) * limit;
  
  // Fetch data and count in parallel
  const [bookings, total] = await Promise.all([
    prisma.booking.findMany({
      where: { passengerId: userId },
      skip,           // Skip first N records
      take: limit,    // Take only limit records
      orderBy: { createdAt: 'desc' },
    }),
    prisma.booking.count({
      where: { passengerId: userId },
    }),
  ]);
  
  // Calculate total pages
  const totalPages = Math.ceil(total / limit);
  
  return {
    bookings,
    pagination: {
      page,
      limit,
      total,
      totalPages,
    },
  };
};
```

### Pros and Cons

**Pros** ✅
- Easy to implement
- Can jump to any page
- Shows total count
- User knows position (page 3 of 10)

**Cons** ❌
- Performance degrades with large offsets (page 1000)
- Can skip/duplicate items if data changes during pagination
- Not ideal for real-time data

---

## Cursor-Based Pagination

### How It Works

Cursor-based pagination uses a **cursor** (unique identifier) to mark position in the dataset. Instead of page numbers, you use the ID of the last item.

### Example: Chat Messages

```
Messages in database:
[msg-1][msg-2][msg-3][msg-4][msg-5][msg-6][msg-7][msg-8]...

Request 1: GET /api/v1/chat/messages?limit=3
Response: [msg-1, msg-2, msg-3], nextCursor: "msg-3"

Request 2: GET /api/v1/chat/messages?cursor=msg-3&limit=3
Response: [msg-4, msg-5, msg-6], nextCursor: "msg-6"

Request 3: GET /api/v1/chat/messages?cursor=msg-6&limit=3
Response: [msg-7, msg-8], nextCursor: null, hasMore: false
```

### Visual Representation

```
Database: [A][B][C][D][E][F][G][H][I][J]

Request 1 (no cursor, limit=3):
          [A][B][C]
          ↑ Start from beginning, take 3
          nextCursor = "C"

Request 2 (cursor=C, limit=3):
                  [D][E][F]
                  ↑ Start after C, take 3
                  nextCursor = "F"

Request 3 (cursor=F, limit=3):
                          [G][H][I]
                          ↑ Start after F, take 3
                          nextCursor = "I"
```

### API Request Examples

```bash
# First request: Get first 20 notifications
GET /api/v1/notifications?limit=20

# Response includes nextCursor
{
  "notifications": [...],
  "nextCursor": "uuid-of-20th-notification",
  "hasMore": true
}

# Second request: Get next 20 using cursor
GET /api/v1/notifications?cursor=uuid-of-20th-notification&limit=20

# Continue until hasMore = false
```

### Response Format

```json
{
  "success": true,
  "data": {
    "notifications": [
      { "id": "notif-1", "message": "Booking confirmed" },
      { "id": "notif-2", "message": "Payment received" },
      ...
    ],
    "nextCursor": "notif-20",  // ID of last item
    "hasMore": true            // More items available
  }
}
```

### How to Navigate

```javascript
// Frontend example
let cursor = null;
let allNotifications = [];

// Load first page
async function loadFirstPage() {
  const response = await fetch('/api/v1/notifications?limit=20');
  const data = await response.json();
  
  allNotifications = data.notifications;
  cursor = data.nextCursor;
  
  return data;
}

// Load next page
async function loadNextPage() {
  if (!cursor) return; // No more data
  
  const response = await fetch(`/api/v1/notifications?cursor=${cursor}&limit=20`);
  const data = await response.json();
  
  allNotifications = [...allNotifications, ...data.notifications];
  cursor = data.nextCursor;
  
  return data;
}

// Infinite scroll example
window.addEventListener('scroll', () => {
  if (isNearBottom() && cursor) {
    loadNextPage();
  }
});
```

### Code Implementation

```typescript
// Service Layer
export const getNotifications = async (
  userId: string,
  cursor?: string,
  limit = 20
) => {
  // Build where clause
  const where: any = { userId };
  
  // If cursor provided, get items after cursor
  if (cursor) {
    where.id = { lt: cursor }; // Less than cursor (older items)
  }
  
  // Fetch limit + 1 to check if more items exist
  const notifications = await prisma.notification.findMany({
    where,
    take: limit + 1,
    orderBy: { createdAt: 'desc' },
  });
  
  // Check if more items exist
  const hasMore = notifications.length > limit;
  
  // Remove extra item if exists
  const items = hasMore ? notifications.slice(0, limit) : notifications;
  
  // Get cursor for next page (ID of last item)
  const nextCursor = hasMore ? items[items.length - 1].id : null;
  
  return {
    notifications: items,
    nextCursor,
    hasMore,
  };
};
```

### Pros and Cons

**Pros** ✅
- Consistent performance (no matter how deep)
- No skipped/duplicate items
- Perfect for real-time data
- Efficient for infinite scroll

**Cons** ❌
- Can't jump to specific page
- No total count
- More complex to implement
- Can't go backwards easily

---

## Practical Examples

### Example 1: Bookings List (Offset-Based)

**Scenario**: User wants to see their booking history

```bash
# User opens bookings page
GET /api/v1/bookings?page=1&limit=10

Response:
{
  "bookings": [
    { "id": "b1", "ride": "London to Manchester", "date": "2026-04-20" },
    { "id": "b2", "ride": "Manchester to Leeds", "date": "2026-04-19" },
    ...10 items...
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 45,
    "totalPages": 5
  }
}

# User clicks "Next Page"
GET /api/v1/bookings?page=2&limit=10

# User clicks "Last Page"
GET /api/v1/bookings?page=5&limit=10

# User clicks "Page 3"
GET /api/v1/bookings?page=3&limit=10
```

### Example 2: Chat Messages (Cursor-Based)

**Scenario**: User scrolls through chat conversation

```bash
# User opens chat
GET /api/v1/chat/conv-123/messages?limit=30

Response:
{
  "messages": [
    { "id": "msg-30", "text": "See you tomorrow!", "time": "10:30" },
    { "id": "msg-29", "text": "Thanks!", "time": "10:29" },
    ...30 messages...
    { "id": "msg-1", "text": "Hello!", "time": "10:00" }
  ],
  "nextCursor": "msg-1",
  "hasMore": true
}

# User scrolls up to see older messages
GET /api/v1/chat/conv-123/messages?cursor=msg-1&limit=30

Response:
{
  "messages": [
    { "id": "msg-0", "text": "Hi there!", "time": "09:59" },
    ...older messages...
  ],
  "nextCursor": "msg--30",
  "hasMore": true
}
```

### Example 3: Search Results (Offset-Based)

**Scenario**: User searches for rides

```bash
# User searches for rides
GET /api/v1/search-rides?originLat=51.5&originLng=-0.1&destinationLat=53.4&destinationLng=-2.2&departureDate=2026-04-20&page=1&limit=10

Response:
{
  "rides": [
    { "id": "r1", "driver": "John", "price": 25, "seats": 3 },
    { "id": "r2", "driver": "Jane", "price": 30, "seats": 2 },
    ...10 rides...
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3
  }
}

# User sees "Showing 1-10 of 25 results"
# User clicks "Next" to see rides 11-20
GET /api/v1/search-rides?...&page=2&limit=10
```

### Example 4: Notifications Feed (Cursor-Based)

**Scenario**: User checks notifications (infinite scroll)

```bash
# User opens notifications
GET /api/v1/notifications?limit=20

Response:
{
  "notifications": [
    { "id": "n20", "message": "Booking confirmed", "time": "2 min ago" },
    { "id": "n19", "message": "Payment received", "time": "5 min ago" },
    ...20 notifications...
  ],
  "nextCursor": "n1",
  "hasMore": true
}

# User scrolls down (infinite scroll)
GET /api/v1/notifications?cursor=n1&limit=20

# Continues until hasMore = false
```

---

## When to Use Which?

### Use Offset-Based Pagination When:
- ✅ Data is relatively static (doesn't change frequently)
- ✅ Users need to jump to specific pages
- ✅ Total count is important
- ✅ Examples: Bookings history, Published rides, Vehicles list

### Use Cursor-Based Pagination When:
- ✅ Data changes frequently (real-time)
- ✅ Infinite scroll UI
- ✅ Large datasets
- ✅ Examples: Chat messages, Notifications, Activity feeds

---

## Summary

### Offset-Based Pagination
```
Request:  page=2, limit=10
Formula:  skip = (2-1) × 10 = 10
Query:    SELECT * FROM bookings SKIP 10 TAKE 10
Result:   Records 11-20
```

### Cursor-Based Pagination
```
Request:  cursor=item-20, limit=10
Query:    SELECT * FROM notifications WHERE id < 'item-20' LIMIT 10
Result:   Next 10 items after item-20
```

### Key Differences

| Feature | Offset-Based | Cursor-Based |
|---------|--------------|--------------|
| Navigation | Page numbers | Cursor tokens |
| Jump to page | ✅ Yes | ❌ No |
| Total count | ✅ Yes | ❌ No |
| Performance | Degrades with offset | Consistent |
| Real-time data | ❌ Can skip/duplicate | ✅ Reliable |
| Implementation | Simple | Moderate |

---

## Testing Pagination

```bash
# Get access token first
TOKEN="your_access_token"

# Test offset-based
curl "http://localhost:3000/api/v1/bookings?page=1&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Test cursor-based
curl "http://localhost:3000/api/v1/notifications?limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Test validation (should return 400)
curl "http://localhost:3000/api/v1/bookings?page=abc&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Conclusion

Pagination is essential for:
- ⚡ **Performance**: Faster responses
- 📱 **User Experience**: Smooth loading
- 💰 **Cost**: Lower bandwidth and server costs
- 🔒 **Reliability**: Prevents timeouts and crashes

Choose the right pagination strategy based on your data characteristics and user needs!
