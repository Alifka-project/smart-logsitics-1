# 🚀 Quick Start Guide

## Get Started in 3 Steps

### 1️⃣ Navigate to Project
```bash
cd /Users/Alifka_Roosseo/Desktop/Project/Logistics-system/dubai-logistics-system
```

### 2️⃣ Start Development Server
```bash
npm run dev
```

### 3️⃣ Open in Browser
Open `http://localhost:5173` in your browser

---

## First-Time User Flow

### Step 1: Load Sample Data
1. You'll see the upload screen
2. Click **"Load Synthetic Data"** button
3. 15 Dubai deliveries will be loaded instantly

### Step 2: Explore Delivery List
- See all deliveries sorted by distance
- View priority assignments (1-3)
- Check analytics dashboard at the top
- Each card shows:
  - Customer name
  - Address
  - Items
  - Phone number
  - Distance from warehouse
  - Priority level

### Step 3: Confirm a Delivery
1. **Click on any delivery card**
2. Modal opens with customer details
3. **Upload Photos**:
   - Click "Upload Photos" or "Take Photo"
   - Select multiple photos
   - See them in preview grid
   - Delete individual photos if needed
4. **Add Signatures**:
   - Draw driver signature on first canvas
   - Draw customer signature on second canvas
   - Clear and retry if needed
5. **Update Status**:
   - Choose: Delivered / Cancelled / Returned
   - Add notes (optional)
6. **Click "Complete Delivery"**
7. Watch the list update in real-time!

### Step 4: View Map and Route
1. Click **"Map View"** in navigation
2. Wait for route calculation (3-5 seconds)
3. See:
   - Green marker = Warehouse (Jebel Ali)
   - Red markers = Priority 1 (closest)
   - Orange markers = Priority 2 (medium)
   - Blue markers = Priority 3 (furthest)
   - Purple route line following actual roads
4. Click any marker for delivery details
5. Scroll down for **turn-by-turn directions**

---

## Key Features to Try

### ✅ Multiple Photo Upload
- Upload 5-10 photos at once
- Test "Remove All" button
- Hover over photos to see delete button
- Try camera capture on mobile

### ✅ Dual Signatures
- Draw complex signatures
- Test clear functionality
- Try submitting without signatures (disabled)

### ✅ Real-time Updates
- Complete a delivery
- Go back to list
- See updated status badge
- Watch analytics numbers change

### ✅ Route Optimization
- Notice deliveries sorted by distance
- See how priorities are assigned
- Check ETA calculation (includes 1-hour installation)

---

## Upload Your Own Data

### Create Excel File
1. Open Excel or Google Sheets
2. Add these columns:
   ```
   customer | address | lat | lng | phone | items
   ```
3. Add your Dubai locations
4. Save as `.xlsx`

### Upload to System
1. Go to Delivery List page
2. Click the upload area
3. Select your Excel file
4. Data loads instantly!

### Get Dubai Coordinates
- **Google Maps**: Right-click → Copy coordinates
- **OpenStreetMap**: Right-click → Show address
- **Jebel Ali**: 25.0053, 55.0760 (warehouse)

---

## Tips for Best Experience

### 📱 Mobile Testing
- Open on mobile browser
- Test "Take Photo" button
- Try signature pads with finger
- Check responsive layouts

### 🗺️ Map Features
- Zoom in/out with mouse wheel
- Click markers for popups
- See route statistics at top
- Read turn-by-turn directions

### 📊 Analytics
- Watch numbers update live
- Total deliveries count
- Completed vs Pending
- Cancelled deliveries

### ⚡ Performance
- Up to 100 deliveries recommended
- Map renders in 3-5 seconds
- Instant list updates
- Smooth photo uploads

---

## Common Tasks

### Update a Delivery Status
```
List → Click Card → Upload Photos → Sign → Update Status → Submit
```

### View Optimized Route
```
Map View → Wait for route → Zoom/Pan map → Read directions
```

### Upload New Batch
```
Refresh page → Upload Excel → Review data → Confirm deliveries
```

### Export Data (Future)
Currently supports import only. Export feature coming soon!

---

## Keyboard Shortcuts

- `Tab` - Navigate between forms
- `Esc` - Close modal
- `Click` - Activate signature pad
- Mouse drag - Draw signature

---

## Browser Support

✅ **Recommended**:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

✅ **Mobile**:
- iOS Safari 14+
- Chrome Android 90+

---

## Troubleshooting

### Map doesn't load?
- Check internet connection
- Valhalla API might be slow
- Try refreshing the page

### Photos won't upload?
- Check file size (max ~5MB each)
- Supported: JPG, PNG, WEBP
- Try fewer photos at once

### Signatures not saving?
- Make sure to draw on the canvas
- Both signatures required
- Click clear and try again

### Excel upload fails?
- Check column names match exactly
- Verify lat/lng are numbers
- See EXCEL_FORMAT.md for details

---

## Next Steps

1. ✅ Load synthetic data
2. ✅ Complete a delivery
3. ✅ View map route
4. ✅ Upload your own data
5. ✅ Test on mobile
6. ✅ Customize for your needs

---

## Need More Help?

- **README.md** - Full documentation
- **EXCEL_FORMAT.md** - Data format guide
- **Console** - Check for errors (F12)

---

**Happy Delivering! 🚚📦**

Built for Dubai Logistics with ❤️

