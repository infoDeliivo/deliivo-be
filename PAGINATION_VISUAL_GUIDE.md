# Pagination Visual Guide 📊

## Quick Visual Comparison

```
┌─────────────────────────────────────────────────────────────┐
│                    OFFSET-BASED PAGINATION                  │
│                    (Page Numbers)                           │
└─────────────────────────────────────────────────────────────┘

Database: 100 bookings total

┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
│ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │ 9 │10 │  Page 1
└───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
│11 │12 │13 │14 │15 │16 │17 │18 │19 │20 │  Page 2
└───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
│21 │22 │23 │24 │25 │26 │27 │28 │29 │30 │  Page 3
└───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘

Request: GET /api/v1/bookings?page=2&limit=10
Result:  Returns items 11-20

┌─────────────────────────────────────────────────────────────┐
│                   CURSOR-BASED PAGINATION                   │
│                   (Continue from last ID)                   │
└─────────────────────────────────────────────────────────────┘

Database: Notifications (newest first)

┌────┬────┬────┬────┬────┐
│ N5 │ N4 │ N3 │ N2 │ N1 │  Request 1: limit=5
└────┴────┴────┴────┴────┘  nextCursor: N1
              ↓
┌────┬────┬────┬────┬────┐
│ N0 │ N-1│ N-2│ N-3│ N-4│  Request 2: cursor=N1, limit=5
└────┴────┴────┴────┴────┘  nextCursor: N-4
              ↓
┌────┬────┬────┐
│N-5 │N-6 │N-7 │            Request 3: cursor=N-4, limit=5
└────┴────┴────┘            nextCursor: null, hasMore: false
```

---

## Offset-Based: Step-by-Step

### Scenario: 45 Total Bookings, 10 per page

```
┌──────────────────────────────────────────────────────────────┐
│  Total: 45 bookings                                          │
│  Limit: 10 per page                                          │
│  Pages: 5 (45 ÷ 10 = 4.5, rounded up to 5)                  │
└──────────────────────────────────────────────────────────────┘

Page 1: skip=0,  take=10  →  Items 1-10
┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐
│1 │2 │3 │4 │5 │6 │7 │8 │9 │10│
└──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘
Formula: skip = (1-1) × 10 = 0

Page 2: skip=10, take=10  →  Items 11-20
                          ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐
                          │11│12│13│14│15│16│17│18│19│20│
                          └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘
Formula: skip = (2-1) × 10 = 10

Page 3: skip=20, take=10  →  Items 21-30
                                                    ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐
                                                    │21│22│23│24│25│26│27│28│29│30│
                                                    └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘
Formula: skip = (3-1) × 10 = 20

Page 4: skip=30, take=10  →  Items 31-40
                                                                              ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐
                                                                              │31│32│33│34│35│36│37│38│39│40│
                                                                              └──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘
Formula: skip = (4-1) × 10 = 30

Page 5: skip=40, take=10  →  Items 41-45 (only 5 items)
                                                                                                        ┌──┬──┬──┬──┬──┐
                                                                                                        │41│42│43│44│45│
                                                                                                        └──┴──┴──┴──┴──┘
Formula: skip = (5-1) × 10 = 40
```

### API Requests

```bash
# Page 1
GET /api/v1/bookings?page=1&limit=10
→ Returns: bookings 1-10, pagination: {page:1, total:45, totalPages:5}

# Page 2
GET /api/v1/bookings?page=2&limit=10
→ Returns: bookings 11-20, pagination: {page:2, total:45, totalPages:5}

# Page 5 (last page)
GET /api/v1/bookings?page=5&limit=10
→ Returns: bookings 41-45, pagination: {page:5, total:45, totalPages:5}
```

---

## Cursor-Based: Step-by-Step

### Scenario: Infinite scroll notifications

```
┌──────────────────────────────────────────────────────────────┐
│  Notifications (newest first)                                │
│  Limit: 3 per request                                        │
└──────────────────────────────────────────────────────────────┘

Request 1: No cursor (start from beginning)
┌─────────────────────────────────────────┐
│ ID: notif-10 | "Booking confirmed"      │  ← Newest
├─────────────────────────────────────────┤
│ ID: notif-9  | "Payment received"       │
├─────────────────────────────────────────┤
│ ID: notif-8  | "Ride started"           │
└─────────────────────────────────────────┘
Response: nextCursor = "notif-8", hasMore = true

Request 2: cursor=notif-8 (continue from notif-8)
┌─────────────────────────────────────────┐
│ ID: notif-7  | "Driver assigned"        │
├─────────────────────────────────────────┤
│ ID: notif-6  | "Booking pending"        │
├─────────────────────────────────────────┤
│ ID: notif-5  | "Profile updated"        │
└─────────────────────────────────────────┘
Response: nextCursor = "notif-5", hasMore = true

Request 3: cursor=notif-5 (continue from notif-5)
┌─────────────────────────────────────────┐
│ ID: notif-4  | "Welcome message"        │
├─────────────────────────────────────────┤
│ ID: notif-3  | "Account created"        │
└─────────────────────────────────────────┘
Response: nextCursor = "notif-3", hasMore = false  ← No more items
```

### API Requests

```bash
# Request 1: Get first 3 notifications
GET /api/v1/notifications?limit=3
→ Returns: [notif-10, notif-9, notif-8], nextCursor: "notif-8"

# Request 2: Get next 3 using cursor
GET /api/v1/notifications?cursor=notif-8&limit=3
→ Returns: [notif-7, notif-6, notif-5], nextCursor: "notif-5"

# Request 3: Get next 3 using cursor
GET /api/v1/notifications?cursor=notif-5&limit=3
→ Returns: [notif-4, notif-3], nextCursor: null, hasMore: false
```

---

## Real-World Example: Bookings App

### User Journey with Offset Pagination

```
┌─────────────────────────────────────────────────────────────┐
│                    MY BOOKINGS                              │
│                                                             │
│  Showing 1-10 of 45 bookings                               │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 🚗 London → Manchester    £25    Apr 20, 2026      │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ 🚗 Manchester → Leeds     £15    Apr 19, 2026      │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ 🚗 Leeds → York           £10    Apr 18, 2026      │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ ... 7 more bookings ...                            │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  [<< Prev]  [1] [2] [3] [4] [5]  [Next >>]                │
│              ^^^                                            │
│           Current page                                      │
└─────────────────────────────────────────────────────────────┘

User clicks "Page 3":
→ GET /api/v1/bookings?page=3&limit=10
→ Shows bookings 21-30

User clicks "Last Page" (5):
→ GET /api/v1/bookings?page=5&limit=10
→ Shows bookings 41-45
```

### User Journey with Cursor Pagination

```
┌─────────────────────────────────────────────────────────────┐
│                   NOTIFICATIONS                             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 🔔 Booking confirmed                    2 min ago   │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ 💰 Payment received                     5 min ago   │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ 🚗 Ride started                        10 min ago   │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ 👤 Driver assigned                     15 min ago   │  │
│  ├─────────────────────────────────────────────────────┤  │
│  │ ⏳ Booking pending                     20 min ago   │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  User scrolls down ↓                                        │
│  → Automatically loads more notifications                   │
│  → GET /api/v1/notifications?cursor=last-id&limit=20       │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 📝 Profile updated                     25 min ago   │  │
│  │ 👋 Welcome message                      1 hour ago  │  │
│  │ ... more notifications ...                          │  │
│  └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Performance Comparison

### Offset-Based Performance

```
Page 1:   SELECT * FROM bookings LIMIT 10 OFFSET 0
          ⚡ Fast (0.01s)

Page 10:  SELECT * FROM bookings LIMIT 10 OFFSET 90
          ⚡ Fast (0.02s)

Page 100: SELECT * FROM bookings LIMIT 10 OFFSET 990
          🐌 Slower (0.15s) - Database scans 990 rows

Page 1000: SELECT * FROM bookings LIMIT 10 OFFSET 9990
           🐌🐌 Very Slow (1.5s) - Database scans 9990 rows
```

### Cursor-Based Performance

```
Request 1: SELECT * FROM notifications WHERE id < 'cursor' LIMIT 20
           ⚡ Fast (0.01s)

Request 10: SELECT * FROM notifications WHERE id < 'cursor' LIMIT 20
            ⚡ Fast (0.01s)

Request 100: SELECT * FROM notifications WHERE id < 'cursor' LIMIT 20
             ⚡ Fast (0.01s) - Always fast, uses index

Request 1000: SELECT * FROM notifications WHERE id < 'cursor' LIMIT 20
              ⚡ Fast (0.01s) - Consistent performance
```

---

## Common UI Patterns

### 1. Page Numbers (Offset-Based)

```
┌─────────────────────────────────────────┐
│  [<< First] [< Prev] [1] [2] [3] [4] [5] [Next >] [Last >>]  │
└─────────────────────────────────────────┘
```

### 2. Load More Button (Cursor-Based)

```
┌─────────────────────────────────────────┐
│  Item 1                                 │
│  Item 2                                 │
│  Item 3                                 │
│  ...                                    │
│  Item 20                                │
│                                         │
│  [Load More]  ← Click to load next 20  │
└─────────────────────────────────────────┘
```

### 3. Infinite Scroll (Cursor-Based)

```
┌─────────────────────────────────────────┐
│  Item 1                                 │
│  Item 2                                 │
│  Item 3                                 │
│  ...                                    │
│  Item 20                                │
│  ↓ User scrolls down                    │
│  [Loading...]  ← Auto-loads next 20     │
│  Item 21                                │
│  Item 22                                │
└─────────────────────────────────────────┘
```

---

## Error Handling

### Invalid Page Number

```
Request: GET /api/v1/bookings?page=abc&limit=10

Response: 400 Bad Request
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "page",
      "message": "Expected number, received NaN"
    }
  ]
}
```

### Exceeding Max Limit

```
Request: GET /api/v1/bookings?page=1&limit=1000

Response: 400 Bad Request
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "limit",
      "message": "Too big: expected number to be <=50"
    }
  ]
}
```

### Invalid Cursor

```
Request: GET /api/v1/notifications?cursor=invalid-id&limit=20

Response: 400 Bad Request
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "cursor",
      "message": "Invalid UUID"
    }
  ]
}
```

---

## Summary Table

| Feature | Offset-Based | Cursor-Based |
|---------|--------------|--------------|
| **UI Pattern** | Page numbers | Infinite scroll |
| **Navigation** | Jump to any page | Sequential only |
| **Total count** | ✅ Yes | ❌ No |
| **Performance** | Degrades with offset | Consistent |
| **Real-time data** | ❌ Can skip items | ✅ Reliable |
| **Use case** | Static lists | Live feeds |
| **Example** | Bookings, Vehicles | Chat, Notifications |

---

## Quick Reference

### Offset-Based
```bash
# First page
GET /api/v1/bookings?page=1&limit=10

# Next page
GET /api/v1/bookings?page=2&limit=10

# Specific page
GET /api/v1/bookings?page=5&limit=10
```

### Cursor-Based
```bash
# First request
GET /api/v1/notifications?limit=20

# Next request (use cursor from previous response)
GET /api/v1/notifications?cursor=last-item-id&limit=20

# Continue until hasMore = false
```

---

**That's it! You now understand how pagination works! 🎉**
