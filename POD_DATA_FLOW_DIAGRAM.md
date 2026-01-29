# POD & SAP Data Flow Diagram

## Complete Data Flow: From SAP to POD Report

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SAP SYSTEM                                   │
│  • Customer Data                                                     │
│  • Order Details                                                     │
│  • Item Information                                                  │
│  • Delivery Schedule                                                 │
└────────────────────┬────────────────────────────────────────────────┘
                     │
                     │ POST /api/sap-ingestion/ingest
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DATABASE (PostgreSQL)                             │
│                                                                      │
│  deliveries Table:                                                   │
│  ┌──────────────────────────────────────────────────────────┐      │
│  │ • id (UUID)                                              │      │
│  │ • customer (name)                                        │      │
│  │ • address                                                │      │
│  │ • phone                                                  │      │
│  │ • poNumber                                               │      │
│  │ • items (JSON/String)                                    │      │
│  │ • lat, lng                                               │      │
│  │ • status                                                 │      │
│  │                                                          │      │
│  │ POD Fields (NEW):                                        │      │
│  │ • driver_signature (TEXT - base64)                       │      │
│  │ • customer_signature (TEXT - base64)                     │      │
│  │ • photos (JSONB array of base64)                         │      │
│  │ • condition_notes (TEXT)                                 │      │
│  │ • delivery_notes (TEXT)                                  │      │
│  │ • delivered_by (VARCHAR)                                 │      │
│  │ • delivered_at (TIMESTAMPTZ)                             │      │
│  │ • pod_completed_at (TIMESTAMPTZ)                         │      │
│  │                                                          │      │
│  │ SAP Metadata (JSON):                                     │      │
│  │ • sapDeliveryNumber                                      │      │
│  │ • sapOrderNumber                                         │      │
│  │ • sapCustomerNumber                                      │      │
│  │ • warehouse, weight, volume                              │      │
│  │ • itemDetails (detailed item info)                       │      │
│  └──────────────────────────────────────────────────────────┘      │
└────────────┬────────────────────────────────────┬────────────────────┘
             │                                    │
             │                                    │ GET /api/deliveries
             │                                    ▼
             │                         ┌──────────────────────┐
             │                         │  ADMIN DASHBOARD     │
             │                         │  • View all orders   │
             │                         │  • Assign drivers    │
             │                         │  • Track status      │
             │                         └──────────────────────┘
             │
             │ GET /api/driver/deliveries
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      DRIVER/TECHNICIAN PORTAL                        │
│                                                                      │
│  1. View Assigned Deliveries                                        │
│  2. Navigate to Customer Location                                   │
│  3. Complete Delivery:                                               │
│     ┌──────────────────────────────────────────────────┐           │
│     │ CustomerModal Component:                         │           │
│     │ • MultipleFileUpload → Capture Photos           │           │
│     │ • SignaturePad → Driver Signature               │           │
│     │ • SignaturePad → Customer Signature             │           │
│     │ • StatusUpdateForm → Select Status              │           │
│     │ • TextArea → Add Condition Notes                │           │
│     └──────────────────────────────────────────────────┘           │
│                                                                      │
│  4. Submit POD:                                                      │
│     PUT /api/deliveries/admin/:id/status                            │
│     {                                                                │
│       "status": "delivered",                                         │
│       "driverSignature": "data:image/png;base64,...",              │
│       "customerSignature": "data:image/png;base64,...",            │
│       "photos": ["data:image/jpeg;base64,..."],                    │
│       "notes": "Items in perfect condition"                         │
│     }                                                                │
└────────────────────┬─────────────────────────────────────────────────┘
                     │
                     │ Saves to Database
                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DATABASE - POD SAVED                              │
│                                                                      │
│  Delivery Record Updated:                                            │
│  • driver_signature ✓ (base64 PNG)                                  │
│  • customer_signature ✓ (base64 PNG)                                │
│  • photos ✓ [base64 JPEG, base64 JPEG, ...]                        │
│  • condition_notes ✓                                                 │
│  • delivered_by ✓ (driver username)                                 │
│  • delivered_at ✓ (timestamp)                                       │
│  • pod_completed_at ✓ (timestamp)                                   │
│  • status = "delivered" ✓                                            │
│                                                                      │
│  Audit Event Created:                                                │
│  • event_type: "status_updated"                                      │
│  • hasPOD: true                                                      │
│  • photoCount: 3                                                     │
│  • hasDriverSignature: true                                          │
│  • hasCustomerSignature: true                                        │
└────────────┬──────────────────────────────┬──────────────────────────┘
             │                              │
             │                              │ GET /api/admin/reports
             │                              ▼
             │                    ┌──────────────────────────┐
             │                    │   ADMIN REPORTS          │
             │                    │   • Export CSV/JSON      │
             │                    │   • POD Statistics       │
             │                    │   • Photo Counts         │
             │                    │   • Signature Status     │
             │                    └──────────────────────────┘
             │
             │ GET /api/deliveries/:id/pod
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      POD VIEWER / REPORT                             │
│                                                                      │
│  Customer: ABC Company                                               │
│  Address: 123 Business St, Dubai                                     │
│  Items: Product A (2 units), Product B (1 unit)                      │
│                                                                      │
│  ┌────────────────────────────────────────────────────┐            │
│  │ Driver Signature:        Customer Signature:       │            │
│  │ [Image displayed]        [Image displayed]         │            │
│  └────────────────────────────────────────────────────┘            │
│                                                                      │
│  ┌────────────────────────────────────────────────────┐            │
│  │ Delivery Photos (3):                               │            │
│  │ [Photo 1]  [Photo 2]  [Photo 3]                   │            │
│  └────────────────────────────────────────────────────┘            │
│                                                                      │
│  Condition Notes: "Items delivered in perfect condition.            │
│                    Customer very satisfied. No damage."             │
│                                                                      │
│  Delivered By: driver_john                                           │
│  Delivered At: 2026-01-29 10:30:45                                   │
│  POD Completed: 2026-01-29 10:30:45                                  │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Features

### ✅ Complete Data Capture
- **From SAP**: Customer details, items, order numbers, delivery schedules
- **From Driver**: Signatures, photos, condition notes, timestamps

### ✅ Reliable Storage
- **Base64 Images**: Stored directly in database (no external storage needed)
- **JSONB Arrays**: Efficient storage for multiple photos
- **Timestamps**: Track when delivery and POD were completed
- **Audit Trail**: Every status change logged with POD metadata

### ✅ Comprehensive Reporting
- **POD Statistics**: How many deliveries have POD vs without
- **Photo Counts**: Number of photos per delivery
- **Signature Status**: Both, partial, or no signatures
- **Export Options**: CSV and JSON formats

### ✅ API Endpoints
- `POST /api/sap-ingestion/ingest` - Import SAP data
- `PUT /api/deliveries/admin/:id/status` - Update with POD
- `GET /api/deliveries/:id/pod` - Retrieve POD data
- `GET /api/admin/reports` - Generate reports with POD

## Data Sizes (Approximate)

| Data Type | Average Size | Storage |
|-----------|--------------|---------|
| Driver Signature | 50-200 KB | TEXT field |
| Customer Signature | 50-200 KB | TEXT field |
| Each Photo | 200KB-2MB | JSONB array |
| Metadata (SAP) | 5-20 KB | JSONB |
| Total per delivery with 3 photos | ~6-10 MB | Per record |

For 1,000 deliveries with full POD = ~6-10 GB storage (reasonable for modern databases)

## Performance Optimizations

✅ **Indexes Created**:
- `idx_deliveries_pod_completed` - Fast queries by POD completion
- `idx_deliveries_delivered_at` - Fast queries by delivery time

✅ **Efficient Queries**:
- Select only needed fields for POD retrieval
- Use dedicated columns instead of JSON metadata for better indexing

✅ **Batch Processing**:
- SAP ingestion supports batch imports
- Reports can filter by date range for performance
