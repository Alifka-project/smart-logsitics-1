# Dubai Logistics Management System

A production-ready logistics management system for Dubai deliveries with real-time tracking, route optimization, and delivery confirmation.

## ✨ Features

### 📋 Delivery List Management
- Interactive delivery cards sorted by distance
- Real-time analytics dashboard
- Excel file upload support
- 15 Dubai locations synthetic data
- Priority-based color coding (Red/Orange/Blue)
- Status badges (Pending/Delivered/Cancelled/Returned)

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

- Responsive design
- Touch-friendly interface
- Camera capture support
- Mobile-optimized signatures

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