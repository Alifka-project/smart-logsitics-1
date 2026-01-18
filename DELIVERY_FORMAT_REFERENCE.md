# 📋 Delivery Format Reference

## Standard Data Format

**Reference File Location:**
`/Users/Alifka_Roosseo/Desktop/Project/Logistics-system/dubai-logistics-system/Delivery format.xlsx`

**IMPORTANT:** All dashboard displays and data processing must be based on this format.

## Excel File Columns

The standard delivery format includes these columns:

- `Document Date` - Document creation date
- `Sales Document` - Sales document number
- `Delivery number` - Unique delivery identifier
- `PO Number` - Purchase order number
- `Confirmed quantity` - Quantity confirmed
- `Billing Document Num` - Billing document number
- `Order Quantity` - Original order quantity
- `Total Line Deliv. Qt` - Total delivery quantity
- `Ship to City 2` - Additional city information
- `Ship to Name 2/3/4` - Additional name fields
- **`Ship to party`** - Customer name (PRIMARY)
- **`Ship to Street`** - Delivery address (PRIMARY)
- `Ship-to` - Ship-to party code
- `Sold-to party` - Sold-to party code
- **`Telephone1`** - Phone number
- `Name` - Customer name (alternate)
- `Payer` - Payer code
- `Payer Name` - Payer name
- `Time of order creati` - Order creation time
- `Shipping point/Recei` - Shipping point
- `Sales unit` - Unit of measure
- **`Route`** - Route identifier
- `Postal code` - Postal/ZIP code
- `Plant` - Plant code
- `Planned GI date` - Planned goods issue date
- `Del. Creation Date` - Delivery creation date
- `Date of Order creati` - Order creation date
- `Cust. PO Number` - Customer PO number
- **`Complete Delivery`** - Delivery completion status (STATUS FIELD)
- **`City`** - City name
- **`Description`** - Item description
- `Description_1` / `Description_2` - Additional descriptions
- `MODEL ID` - Model identifier
- **`Material`** - Material code
- `Invoice Price` - Invoice price
- `Net value` - Net value
- `Orig Req Del. date` - Original requested delivery date
- `Original Mat. Av. Da` - Material availability date
- `Reason for rejection` - Rejection reason (if any)
- `Requested Deliv.date` - Requested delivery date

## Key Fields for Dashboard Display

### Customer Information
- **Customer Name:** `Ship to party` or `Name` or `Payer Name`
- **Address:** `Ship to Street`, `City`, `Postal code`
- **Phone:** `Telephone1`

### Status Tracking
- **Delivery Status:** `Complete Delivery` field
  - Empty = Pending
  - Value = Delivered/Completed status
  
### Delivery Details
- **Items:** `Description` + `Material`
- **Quantity:** `Confirmed quantity`
- **Route:** `Route` field
- **Dates:** `Planned GI date`, `Requested Deliv.date`

## Dashboard Requirements

The dashboard MUST display:

1. **Customer-Based Status View:**
   - Which customers have been delivered (Complete Delivery has value)
   - Which customers are pending (Complete Delivery is empty)
   - Customer details with status indicators

2. **Status Filtering:**
   - Filter by delivery completion status
   - Group by status (Delivered, Pending, In-Progress)
   - Show status details for each customer

3. **Data Preservation:**
   - All original columns must be accessible
   - Status information from `Complete Delivery` must be tracked
   - Customer information from `Ship to party` must be displayed

---

**Last Updated:** ${new Date().toISOString()}
**Status:** Reference format for all data processing and dashboard displays

