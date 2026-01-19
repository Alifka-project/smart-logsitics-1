# Status Update Flow Diagram & Architecture

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            Frontend (React)                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  DeliveryManagementPage                    AdminDashboardPage            │
│  ├─ DeliveryTable                         ├─ MetricCards                │
│  │  └─ DeliveryCard (Clickable)           ├─ Charts                      │
│  │      └─ OnClick → selectDelivery()     ├─ DeliveriesTable            │
│  │                                        └─ Auto-refresh (5s)          │
│  │                                                                       │
│  └─ CustomerModal (Modal Component)                                     │
│      ├─ Shows delivery details                                          │
│      ├─ StatusUpdateForm (Status buttons)                               │
│      ├─ SignaturePads (Driver + Customer)                               │
│      └─ PhotoUpload                                                      │
│           └─ Submit → handleSubmit()                                    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ PUT Request
                        (api.put('/deliveries/admin/:id/status'))
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Backend (Node.js/Express)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  Router: /api/deliveries/admin/:id/status (PUT)                         │
│  ├─ authenticate middleware                                             │
│  ├─ requireRole('admin') middleware                                     │
│  │                                                                       │
│  ├─ Extract body: { status, notes, signatures, photos, time }          │
│  │                                                                       │
│  ├─ Validate: status required                                           │
│  │                                                                       │
│  ├─ Database Operation 1:                                               │
│  │  UPDATE delivery                                                     │
│  │  SET status = 'cancelled',                                          │
│  │      metadata = {..., notes, signatures, photos, timestamp},       │
│  │      updated_at = NOW()                                            │
│  │  WHERE id = delivery_id                                             │
│  │                                                                       │
│  ├─ Database Operation 2:                                               │
│  │  INSERT INTO delivery_event                                         │
│  │  eventType = 'status_updated'                                       │
│  │  payload = {previousStatus, newStatus, notes, ...}                  │
│  │  actor_type = 'admin', actor_id = user_id                          │
│  │                                                                       │
│  └─ Response: { ok: true, status, delivery {...} }                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ Response
                        (200 with updated delivery)
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         Frontend (React) - Update                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  1. Error Check:                                                         │
│     if (response.data.ok) { ✓ Continue }                                │
│     else { Show error message, Keep modal open }                        │
│                                                                           │
│  2. Local Store Update:                                                  │
│     updateDeliveryStatus(id, status, {...})  ← Updates Zustand          │
│     (For immediate UI feedback)                                         │
│                                                                           │
│  3. Event Dispatch:                                                      │
│     window.dispatchEvent(                                               │
│       new CustomEvent('deliveryStatusUpdated', {                        │
│         detail: { deliveryId, status, updatedAt }                       │
│       })                                                                │
│     )                                                                   │
│                                                                          │
│  4. Close Modal                                                          │
│     onClose() → Modal disappears                                        │
│                                                                          │
│  5. DeliveryCard Updates:                                                │
│     StatusBadge shows new status color immediately                      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ Event Emitted
                        ('deliveryStatusUpdated')
                                    ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                    AdminDashboardPage Listener                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  window.addEventListener('deliveryStatusUpdated', (event) => {          │
│    console.log('Status changed:', event.detail)                         │
│    loadDashboardData()  ← Refresh all metrics                           │
│  })                                                                      │
│                                                                          │
│  loadDashboardData():                                                    │
│  ├─ GET /admin/dashboard (updated totals)                              │
│  ├─ GET /admin/drivers (driver data)                                   │
│  └─ GET /admin/tracking/deliveries (delivery list)                     │
│                                                                          │
│  Result:                                                                 │
│  ├─ MetricCards update (Cancelled count +1)                            │
│  ├─ Charts re-render with new data                                     │
│  ├─ Status distribution pie chart updates                              │
│  └─ Recent deliveries list updates                                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    ↓ Data Persisted
┌─────────────────────────────────────────────────────────────────────────┐
│                    PostgreSQL Database (Persistent)                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  delivery table:                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ id     │ customer │ address  │ phone │ status    │ updated_at   │  │
│  ├────────┼──────────┼──────────┼───────┼───────────┼──────────────┤  │
│  │ abc123 │ Ahmed    │ Dubai    │ 05xxx │ cancelled │ 2026-01-19   │  │
│  │ def456 │ Fatima   │ Abu Dhabi│ 06xxx │ delivered │ 2026-01-19   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  delivery_event table (Audit Trail):                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ id │delivery_id│ event_type      │ previous_status → new_status │   │
│  ├────┼───────────┼─────────────────┼──────────────────────────────┤   │
│  │ 1  │ abc123    │ status_updated  │ scheduled → cancelled        │   │
│  │ 2  │ def456    │ status_updated  │ pending → delivered          │   │
│  └────────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Complete Status Update Sequence

```
┌──────────────┐
│  User Action │  Click on delivery card in list
└──────┬───────┘
       │
       ▼
┌─────────────────────────────────────┐
│ DeliveryCard onClick Handler        │
│ selectDelivery(id)                  │
│ onSelectDelivery()                  │
└──────┬──────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ CustomerModal Opens                  │
│ Shows delivery details & forms       │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ User Interactions:                   │
│ 1. Select Status (e.g., Cancelled)  │
│ 2. Draw Driver Signature            │
│ 3. Draw Customer Signature          │
│ 4. Optional: Upload Photos & Notes  │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│ Click Submit Button                  │
│ "Complete Delivery" pressed          │
└──────┬───────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ handleSubmit() in CustomerModal                          │
│ - Set isSubmitting = true                               │
│ - Create payload with all form data                     │
│ - Make PUT request to API                              │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼ PUT /api/deliveries/admin/{id}/status
┌──────────────────────────────────────────────────────────┐
│ Network Request                                          │
│ Headers:                                                │
│   Authorization: Bearer {token}                         │
│   Content-Type: application/json                        │
│   X-CSRF-Token: {token}                                │
│                                                         │
│ Body:                                                   │
│ {                                                       │
│   status: "cancelled",                                 │
│   notes: "...",                                        │
│   driverSignature: "...",                              │
│   customerSignature: "...",                            │
│   photos: [],                                          │
│   actualTime: "2026-01-19T12:00:00Z"                 │
│ }                                                       │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼ Server Processing
┌──────────────────────────────────────────────────────────┐
│ Backend Route Handler                                    │
│ PUT /deliveries/admin/:id/status                        │
│                                                         │
│ 1. Authenticate request ✓                              │
│ 2. Check admin role ✓                                  │
│ 3. Validate status value ✓                             │
│ 4. Find delivery in DB ✓                               │
│ 5. Update delivery.status ✓                            │
│ 6. Update delivery.metadata ✓                          │
│ 7. Create audit event ✓                                │
│ 8. Return success response                             │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼ Response (200 OK)
┌──────────────────────────────────────────────────────────┐
│ {                                                       │
│   ok: true,                                            │
│   status: "cancelled",                                │
│   delivery: {                                          │
│     id: "abc123",                                      │
│     customer: "Ahmed",                                │
│     status: "cancelled",                              │
│     updatedAt: "2026-01-19T12:00:00Z"                │
│   }                                                    │
│ }                                                      │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼ Frontend Processing
┌──────────────────────────────────────────────────────────┐
│ Handle Response in CustomerModal                        │
│                                                         │
│ 1. Check response.data.ok ✓                           │
│ 2. Update local store ✓                               │
│    updateDeliveryStatus(id, "cancelled", {...})       │
│ 3. Dispatch event ✓                                    │
│    window.dispatchEvent(                              │
│      CustomEvent('deliveryStatusUpdated',             │
│      {deliveryId, status, updatedAt}                  │
│    )                                                  │
│ 4. Close modal                                         │
│ 5. Reset form state                                    │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼ Immediate UI Update
┌──────────────────────────────────────────────────────────┐
│ DeliveryCard Updates (Local Store)                       │
│ - StatusBadge changes to RED (Cancelled)               │
│ - User sees immediate feedback                         │
│ - DeliveryTable re-renders                             │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼ Event Propagation
┌──────────────────────────────────────────────────────────┐
│ AdminDashboard Listener (in other tab/window)           │
│ Receives 'deliveryStatusUpdated' event                  │
│ Calls loadDashboardData()                              │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼ Refresh Dashboard
┌──────────────────────────────────────────────────────────┐
│ Dashboard Data Refresh (API Calls)                       │
│ - GET /admin/dashboard                                │
│ - GET /admin/drivers                                  │
│ - GET /admin/tracking/deliveries                      │
│                                                         │
│ UI Updates:                                             │
│ - Cancelled count: 0 → 1 ✓                            │
│ - Total deliveries: 10 (unchanged)                    │
│ - Charts re-render                                     │
│ - Recent deliveries list updates                      │
└──────┬───────────────────────────────────────────────────┘
       │
       ▼ Data Persistence (PostgreSQL)
┌──────────────────────────────────────────────────────────┐
│ Database Updated:                                        │
│ UPDATE delivery SET status='cancelled' WHERE id=abc123  │
│ INSERT INTO delivery_event (status_updated event)      │
│                                                         │
│ Data is now PERSISTED and survives:                     │
│ - Page refresh                                          │
│ - Browser restart                                       │
│ - Multiple user views                                   │
└──────────────────────────────────────────────────────────┘
```

## Data Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    LOCAL STATE (Zustand)                    │
│                                                             │
│  Zustand Store:                                            │
│  - deliveries: []  (Local copy)                            │
│  - selectedDelivery: null                                  │
│                                                             │
│  updateDeliveryStatus() action:                            │
│  Updates local state & localStorage                        │
│  (for UI responsiveness)                                   │
└─────────────────────────────────────────────────────────────┘
              ↑                              ↓
              │ READ (onLoad)               │ WRITE (API success)
              │                              │
              │                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   NETWORK (API Calls)                       │
│                                                             │
│  CustomerModal:                                            │
│  PUT /deliveries/admin/:id/status                          │
│  (The SINGLE SOURCE OF TRUTH)                              │
│                                                             │
│  AdminDashboard:                                           │
│  GET /admin/dashboard                                      │
│  GET /admin/tracking/deliveries                            │
│                                                             │
│  Response: { ok: true, status, delivery }                  │
└─────────────────────────────────────────────────────────────┘
              ↓                              ↑
              │ PERSIST                     │ FETCH
              │                              │
              ▼                              ↑
┌─────────────────────────────────────────────────────────────┐
│              PERSISTENT DATABASE (PostgreSQL)               │
│                                                             │
│  delivery table:                                           │
│  - Stores current status                                   │
│  - Timestamp of update                                     │
│  - Metadata (signatures, photos, notes)                    │
│                                                             │
│  delivery_event table:                                     │
│  - Audit trail of ALL changes                              │
│  - Who made the change (actor_id)                          │
│  - When the change occurred                                │
│  - What changed (previousStatus → newStatus)               │
│                                                             │
│  ✓ SINGLE SOURCE OF TRUTH                                  │
│  ✓ SURVIVES SERVER RESTART                                 │
│  ✓ ACCESSIBLE TO ALL USERS                                 │
│  ✓ FULLY AUDITABLE                                         │
└─────────────────────────────────────────────────────────────┘
```

## Key Files and Their Roles

```
DELIVERY STATUS UPDATE
│
├─ FRONTEND
│  ├─ src/pages/DeliveryManagementPage.jsx
│  │  └─ Renders DeliveryTable & CustomerModal
│  │
│  ├─ src/components/DeliveryList/DeliveryCard.jsx
│  │  └─ Clickable card that opens CustomerModal
│  │
│  ├─ src/components/CustomerDetails/CustomerModal.jsx ⭐ MODIFIED
│  │  └─ handleSubmit() → PUT /deliveries/admin/:id/status
│  │     └─ Dispatches 'deliveryStatusUpdated' event
│  │
│  ├─ src/pages/AdminDashboardPage.jsx ⭐ MODIFIED
│  │  └─ Listens for 'deliveryStatusUpdated' event
│  │     └─ Calls loadDashboardData() to refresh metrics
│  │
│  └─ src/store/useDeliveryStore.js
│     └─ updateDeliveryStatus() for local state
│
├─ BACKEND
│  └─ src/server/api/deliveries.js ⭐ MODIFIED
│     └─ PUT /admin/:id/status route handler
│        ├─ Updates Prisma database
│        ├─ Creates audit event
│        └─ Returns updated delivery
│
└─ DATABASE
   └─ PostgreSQL
      ├─ delivery table (stores current status)
      └─ delivery_event table (stores history)
```

## Error Handling Flow

```
Submit Status Update
        ↓
    Try {
        PUT request
        ↓ FAILS (Network error, 401, 500, etc.)
        ↓
    } Catch (error)
        ↓
    Show error message:
    "Failed to update delivery status"
    ↓
    Modal stays OPEN
    Form data PRESERVED
    ↓
    User can:
    1. Fix issue and retry
    2. Close modal (data not lost)
    3. Check network connection
```

## Real-Time Sync (Multiple Users)

```
User A (DeliveryManagement)      User B (AdminDashboard)
│                                │
├─ Cancels Delivery #5 ────────────→ PUT request
│                                │
├─ Modal closes                 │
├─ DeliveryCard updates         │
├─ Status = "Cancelled"  ◄──────── Event: deliveryStatusUpdated
│                                │
│                           ├─ Dashboard loads data
│                           ├─ Cancelled count: 5 → 6
│                           ├─ Charts update
│                           └─ Both users see same data
└─ Metrics synchronized ◄────────┘
```

This architecture ensures:
✅ Strong consistency (database is source of truth)
✅ Real-time updates (event-based refresh)
✅ Audit trail (all changes logged)
✅ Offline resilience (data saved before close)
✅ Scalability (event-driven architecture)
