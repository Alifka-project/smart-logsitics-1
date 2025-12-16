# Dubai Logistics Management System

A production-ready logistics management system for Dubai deliveries with real-time tracking, route optimization, and delivery confirmation.

## ✨ Features

### 📋 Delivery List Management
- Interactive delivery cards sorted by distance
- Real-time analytics dashboard
- Excel file upload support with format auto-detection
- 15 Dubai locations synthetic data
- Priority-based color coding (Red/Orange/Blue)
- Status badges (Pending/Delivered/Cancelled/Returned)

### 📱 Mobile Optimization & Drag-to-Reorder (NEW!)
- **Fully responsive design** - Works on phones, tablets, and desktops
- **Drag-and-drop reordering** - Manually adjust delivery sequence on any device
- **Touch-friendly interface** - 44×44px minimum touch targets on mobile
- **Visual feedback** - Color, opacity, and scale changes during drag
- **Persistent ordering** - Reordered deliveries saved to localStorage
- **Mobile-optimized** - Momentum scrolling, large buttons, responsive spacing

### 📸 Multiple Photo Upload
- Upload multiple photos at once
- Camera capture button for mobile
- Photo preview grid (2-3 columns)
- Individual delete on hover
- "Remove All" functionality
- Photo counter and empty state

### ✍️ Dual Signature Capture
- Separate signature pads for driver & customer
- Canvas-based smooth drawing
- Clear and retry functionality
- Base64 storage
- Required validation before submit

### 🗺️ Interactive Map View
- Interactive Leaflet map with OpenStreetMap
- Route following actual Dubai roads
- Valhalla API integration (free, no key needed)
- Color-coded priority markers
- Turn-by-turn directions
- ETA with 1-hour installation time per stop

## 🛠️ Tech Stack

- **Frontend**: React 18 + Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Routing**: React Router v6
- **Mapping**: Leaflet + React-Leaflet
- **Route Calculation**: Valhalla Routing API (free, no key needed)
- **File Processing**: XLSX + PapaParse
- **Signatures**: React-Signature-Canvas
- **Icons**: Lucide React

## 🚀 Quick Start

### Local Development
```bash
npm install
npm run dev
```

### Production Build
```bash
npm run build
```

## 🌍 Warehouse Location

**Jebel Ali Free Zone, Dubai**
- Coordinates: 25.0053, 55.0760
- All distances calculated from this point

## 📊 Sample Data

The system includes 15 real Dubai locations:
- Al Futtaim Motors (Sheikh Zayed Road)
- Dubai Mall Retail
- Jumeirah Beach Hotel
- Dubai Marina
- Business Bay
- Palm Jumeirah
- Dubai Silicon Oasis
- Burj Khalifa Office
- The Springs
- Arabian Ranches
- Motor City
- And more...

## 🎯 How It Works

1. **Upload Excel** or **Load Synthetic Data**
2. **Automatic Priority Assignment** based on distance from warehouse
3. **Interactive Delivery Cards** with full details
4. **Photo Upload** with preview grid
5. **Dual Signatures** (driver + customer)
6. **Status Updates** with real-time sync
7. **Map Visualization** with optimized routes

## 📱 Mobile Support

- **Fully responsive design** - Optimized for all screen sizes (320px - 1920px)
- **Touch-friendly interface** - 44×44px minimum touch targets per accessibility standards
- **Drag-to-reorder deliveries** - Long-press and drag cards to manually adjust sequence
- **Camera capture support** - Native camera integration for mobile photo upload
- **Mobile-optimized signatures** - Smooth touch-based signature drawing
- **Momentum scrolling** - iOS-style smooth scrolling experience
- **Persistent data** - localStorage saves reordered sequences and form data

### Device Support
- ✅ iPhone (SE, 12, 13, 14, 15)
- ✅ Android phones (all modern versions)
- ✅ iPad (all models)
- ✅ Android tablets
- ✅ Desktop browsers (Chrome, Safari, Firefox, Edge)

### How to Use Drag-to-Reorder
1. **Desktop**: Click and drag a delivery card
2. **Mobile**: Long-press a delivery card and drag
3. **Visual Feedback**: Card changes color/opacity during drag
4. **Drop Zone**: Target location highlights
5. **Auto-Save**: Order persists to localStorage

See [MOBILE_RESPONSIVE_GUIDE.md](./MOBILE_RESPONSIVE_GUIDE.md) for detailed mobile optimization info.
See [DRAG_TO_REORDER_GUIDE.md](./DRAG_TO_REORDER_GUIDE.md) for drag-and-drop feature details.

## 🔧 Configuration

### Excel Format
Required columns: `customer`, `address`, `lat`, `lng`, `phone`, `items`

### API Endpoints
- **Valhalla Routing**: `https://valhalla1.openstreetmap.de/route` (free)
- **OpenStreetMap**: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png` (free)

## 📄 License

Built for Dubai Logistics Management

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

---

**Built with ❤️ for Dubai Logistics**

**Version**: 1.0.0  
**Status**: Production Ready ✅