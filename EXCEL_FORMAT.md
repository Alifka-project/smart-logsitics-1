# 📊 Excel File Format Guide

## Required Columns

Your Excel file must contain the following columns (case-sensitive):

| Column Name | Data Type | Example | Description |
|-------------|-----------|---------|-------------|
| `customer` | Text | "Al Futtaim Motors" | Customer or company name |
| `address` | Text | "Sheikh Zayed Road, Dubai" | Full delivery address |
| `lat` | Number | 25.1124 | Latitude coordinate (decimal) |
| `lng` | Number | 55.1980 | Longitude coordinate (decimal) |
| `phone` | Text | "+971 4 123 4567" | Customer contact number |
| `items` | Text | "Auto Parts x 50" | Items to be delivered |

## Sample Data

```
customer            | address                  | lat      | lng     | phone            | items
--------------------|--------------------------|----------|---------|------------------|------------------
Al Futtaim Motors   | Sheikh Zayed Road, Dubai | 25.1124  | 55.1980 | +971 4 123 4567  | Auto Parts x 50
Dubai Mall Retail   | Downtown Dubai           | 25.1972  | 55.2744 | +971 4 234 5678  | Electronics x 30
Marina Mall         | Dubai Marina             | 25.0785  | 55.1385 | +971 4 456 7890  | Retail Goods x 40
```

## How to Get Coordinates

### Option 1: Google Maps
1. Right-click on the location in Google Maps
2. Click on the coordinates shown
3. Copy the latitude (first number) and longitude (second number)

### Option 2: OpenStreetMap
1. Go to openstreetmap.org
2. Right-click on the location
3. Select "Show address"
4. Coordinates will be displayed

## Creating Your Excel File

### Using Microsoft Excel:
1. Create a new workbook
2. Add column headers in the first row
3. Enter data starting from row 2
4. Save as `.xlsx` format

### Using Google Sheets:
1. Create a new spreadsheet
2. Add column headers
3. Enter data
4. Download as "Microsoft Excel (.xlsx)"

## Tips for Dubai Locations

- Dubai coordinates range approximately:
  - Latitude: 24.8° to 25.4°
  - Longitude: 54.9° to 55.6°
  
- Warehouse (Jebel Ali): 25.0053, 55.0760

- Major Areas:
  - Downtown Dubai: ~25.197, 55.274
  - Dubai Marina: ~25.079, 55.139
  - Deira: ~25.252, 55.331
  - Jumeirah: ~25.141, 55.187

## Validation

The system will automatically:
- ✅ Calculate distance from Jebel Ali warehouse
- ✅ Sort deliveries by proximity
- ✅ Assign priority levels (1-3)
- ✅ Generate unique delivery IDs
- ✅ Set initial status as "pending"
- ✅ Calculate estimated delivery times

## Error Prevention

❌ Common mistakes to avoid:
- Missing or misspelled column names
- Empty cells in required columns
- Coordinates outside Dubai area
- Invalid phone number format
- Non-numeric lat/lng values

✅ Best practices:
- Use consistent data formatting
- Double-check coordinates
- Include country code in phone numbers
- Be specific with item descriptions
- Test with a small file first

## Sample Files

The system includes synthetic data with 15 real Dubai locations. Use the "Load Synthetic Data" button to see the expected format in action.

## File Size Limits

- Recommended: Up to 100 deliveries per file
- Maximum tested: 500 deliveries
- Larger files may slow down map rendering

## Supported File Types

- `.xlsx` - Microsoft Excel 2007+
- `.xls` - Microsoft Excel 97-2003
- `.csv` - Comma-separated values

---

**Need help?** Load the synthetic data first to see a working example!

