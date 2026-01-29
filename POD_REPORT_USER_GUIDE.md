# POD Report - Quick Start Guide

## What is the POD Report?

The **POD (Proof of Delivery) Report** is a specialized report that shows you which delivered orders have images (photos and signatures) uploaded by drivers/technicians.

## How to Access

### Option 1: Direct Link
Navigate to: **Admin → Reports → Click "POD Report" button**

### Option 2: Direct URL
Visit: `http://localhost:5173/admin/reports/pod` (or your domain `/admin/reports/pod`)

---

## What You'll See

### 📊 Summary Dashboard

At the top, you'll see 4 key metrics:

1. **Total Delivered** - Total number of delivered orders
2. **With POD ✓** - Orders that have images uploaded (percentage shown)
3. **Without POD ✗** - Orders missing images (these need attention!)
4. **Total Photos** - Total number of photos across all deliveries

### 📈 POD Quality Breakdown

- **Complete** - Has both driver & customer signatures + photos
- **Good** - Has at least one signature + photos
- **Partial** - Missing some POD data

### 👤 Driver Performance

See which drivers are completing POD documentation:
- Total deliveries per driver
- How many with POD vs without POD
- Total photos uploaded by each driver

### 📅 Daily Breakdown

Track POD completion rate by date:
- Total deliveries each day
- How many had POD completed
- POD completion percentage per day

### 📋 Detailed Delivery List

Every delivered order is shown with:
- ✅ **POD Status** - Green checkmark (has POD) or red X (missing POD)
- **POD Quality** - Complete, Good, Partial, or None
- **Photos Count** - Number of photos uploaded
- **Signatures** - "D" for driver signature, "C" for customer signature
- **Driver Name** - Who delivered it
- **Delivered Date** - When it was delivered

❗ **Missing POD Orders** are highlighted in red/pink background!

---

## Filters

### Date Range
- **Start Date** - Show deliveries from this date onwards
- **End Date** - Show deliveries up to this date
- Default: Last 7 days

### POD Status
- **All Deliveries** - Show everything
- **✓ With POD** - Only show orders that have images
- **✗ Without POD** - Only show orders missing images (USE THIS to find problems!)

---

## Example Use Cases

### 📌 Check Today's Deliveries
1. Set **Start Date** = Today
2. Set **End Date** = Today
3. Set **POD Status** = "All Deliveries"
4. Click **Apply Filters**

✅ **Result**: You'll see all today's delivered orders and their POD status

### 📌 Find Missing POD from Last Week
1. Set **Start Date** = 7 days ago
2. Set **End Date** = Today
3. Set **POD Status** = "✗ Without POD"
4. Click **Apply Filters**

❗ **Result**: Only orders that are MISSING images will show (highlighted in red)

### 📌 Export POD Report
1. Apply your desired filters
2. Click **Export CSV** button
3. CSV file downloads with all POD details

The CSV includes:
- Delivery ID & PO Number
- Customer & Address
- POD Status (YES/NO)
- POD Quality rating
- Photo counts
- Signature status
- Driver information
- Delivery timestamps

---

## What Each Column Means

| Column | Meaning |
|--------|---------|
| **PO #** | Purchase Order Number |
| **Customer** | Customer name & address |
| **Status** | Delivery status (delivered, completed, etc.) |
| **POD Status** | ✅ Has images OR ❌ Missing images |
| **POD Quality** | Complete, Good, Partial, or Missing |
| **Photos** | 📷 Number (e.g., "3" = 3 photos uploaded) |
| **Signatures** | D = Driver signature, C = Customer signature |
| **Driver** | Name of driver who delivered |
| **Delivered** | Date of delivery |

---

## Key Performance Indicators (KPIs)

### 🎯 Target: 100% POD Completion

**Good Performance:**
- ✅ POD Completion Rate > 90%
- ✅ Most orders have "Complete" or "Good" quality
- ✅ All orders have at least 1 photo

**Needs Improvement:**
- ⚠️ POD Completion Rate < 80%
- ⚠️ Many orders showing "Partial" or "Missing"
- ⚠️ Drivers with 0 photos uploaded

### 💡 Pro Tips

1. **Check Daily** - Run the POD report every evening to ensure all today's deliveries have images

2. **Follow Up Fast** - If an order is missing POD, contact the driver immediately while they still remember

3. **Driver Training** - Drivers with low POD completion rates may need training on how to upload photos

4. **Quality Check** - "Partial" POD means missing signatures or photos. Ensure drivers get both!

5. **Export for Records** - Export CSV at end of each day/week for your records

---

## API Endpoint

**Backend Endpoint:** `GET /api/admin/reports/pod`

**Query Parameters:**
- `startDate` - ISO date string (e.g., "2026-01-29")
- `endDate` - ISO date string
- `podStatus` - "all", "with-pod", or "without-pod"
- `format` - "csv" for CSV download

**Example:**
```bash
curl "http://localhost:4000/api/admin/reports/pod?startDate=2026-01-29&podStatus=without-pod" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Troubleshooting

### ❓ Report shows "No deliveries found"
- Check your date range - try widening the dates
- Ensure deliveries are marked as "delivered" status
- Check database has deliveries with `delivered_at` timestamp

### ❓ All orders show "Missing POD"
- Drivers may not be using the CustomerModal to upload photos
- Check that signatures and photos are being submitted
- Verify API endpoint is saving to `driver_signature`, `customer_signature`, `photos` fields

### ❓ CSV export isn't working
- Check browser console for errors
- Ensure authentication token is valid
- Try refreshing the page and exporting again

---

## Summary

The POD Report is your **quality control tool** to ensure every delivery has proper documentation (photos and signatures). 

**Daily workflow:**
1. Open POD Report
2. Set dates to today
3. Look for red-highlighted rows (missing POD)
4. Contact drivers about missing documentation
5. Export CSV for records

This ensures you have proof of delivery for every order, protecting you from disputes and ensuring customer satisfaction! 📸✅
