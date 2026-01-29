# Prisma Quick Reference Guide

## Quick Start

### Import Prisma Client
```javascript
const prisma = require('./db/prisma');
```

## Common Operations

### CREATE Operations

#### Create a Driver
```javascript
const driver = await prisma.driver.create({
  data: {
    username: 'driver123',
    email: 'driver@example.com',
    fullName: 'John Driver',
    phone: '+971501234567',
    active: true,
    gpsEnabled: false
  }
});
```

#### Create Driver with Account
```javascript
const driverWithAccount = await prisma.driver.create({
  data: {
    username: 'driver123',
    fullName: 'John Driver',
    account: {
      create: {
        passwordHash: hashedPassword,
        role: 'driver'
      }
    }
  },
  include: {
    account: true
  }
});
```

#### Create a Delivery
```javascript
const delivery = await prisma.delivery.create({
  data: {
    orderNumber: 'ORD-001',
    customerName: 'Customer Name',
    customerPhone: '+971501234567',
    address: 'Dubai, UAE',
    status: 'pending',
    poNumber: 'PO-123'
  }
});
```

### READ Operations

#### Find All Records
```javascript
const allDrivers = await prisma.driver.findMany();

// With filtering
const activeDrivers = await prisma.driver.findMany({
  where: {
    active: true
  }
});

// With relations
const driversWithAccounts = await prisma.driver.findMany({
  include: {
    account: true,
    assignments: true
  }
});

// With ordering
const sortedDrivers = await prisma.driver.findMany({
  orderBy: {
    createdAt: 'desc'
  }
});
```

#### Find One Record
```javascript
// Find by ID
const driver = await prisma.driver.findUnique({
  where: { id: driverId }
});

// Find by unique field
const driver = await prisma.driver.findUnique({
  where: { username: 'driver123' }
});

// Find first matching
const driver = await prisma.driver.findFirst({
  where: {
    email: 'driver@example.com'
  }
});
```

#### Complex Queries
```javascript
// Multiple conditions (AND)
const result = await prisma.delivery.findMany({
  where: {
    status: 'pending',
    customerPhone: {
      contains: '+971'
    }
  }
});

// OR conditions
const result = await prisma.delivery.findMany({
  where: {
    OR: [
      { status: 'pending' },
      { status: 'in_transit' }
    ]
  }
});

// NOT conditions
const result = await prisma.driver.findMany({
  where: {
    NOT: {
      active: false
    }
  }
});

// Search (case-insensitive)
const result = await prisma.driver.findMany({
  where: {
    fullName: {
      contains: 'john',
      mode: 'insensitive'
    }
  }
});
```

### UPDATE Operations

#### Update Single Record
```javascript
const updated = await prisma.driver.update({
  where: { id: driverId },
  data: {
    active: true,
    gpsEnabled: true
  }
});
```

#### Update Many Records
```javascript
const updateCount = await prisma.driver.updateMany({
  where: {
    active: false
  },
  data: {
    active: true
  }
});
```

#### Upsert (Update or Create)
```javascript
const result = await prisma.driver.upsert({
  where: { username: 'driver123' },
  update: {
    fullName: 'Updated Name'
  },
  create: {
    username: 'driver123',
    fullName: 'New Driver'
  }
});
```

### DELETE Operations

#### Delete Single Record
```javascript
await prisma.driver.delete({
  where: { id: driverId }
});
```

#### Delete Many Records
```javascript
const deleteCount = await prisma.driver.deleteMany({
  where: {
    active: false
  }
});
```

## Relations

### Include Related Data
```javascript
// Include single relation
const driver = await prisma.driver.findUnique({
  where: { id: driverId },
  include: {
    account: true,
    status: true
  }
});

// Include nested relations
const driver = await prisma.driver.findUnique({
  where: { id: driverId },
  include: {
    assignments: {
      include: {
        delivery: true
      }
    }
  }
});
```

### Select Specific Fields
```javascript
const driver = await prisma.driver.findUnique({
  where: { id: driverId },
  select: {
    id: true,
    username: true,
    fullName: true,
    account: {
      select: {
        role: true,
        lastLogin: true
      }
    }
  }
});
```

## Counting Records

```javascript
// Count all
const count = await prisma.driver.count();

// Count with filter
const activeCount = await prisma.driver.count({
  where: {
    active: true
  }
});
```

## Aggregations

```javascript
// Get aggregated data
const result = await prisma.delivery.aggregate({
  _count: true,
  _sum: {
    // Add numeric fields
  },
  where: {
    status: 'completed'
  }
});
```

## Transactions

### Sequential Transactions
```javascript
const result = await prisma.$transaction(async (tx) => {
  // Create driver
  const driver = await tx.driver.create({
    data: { username: 'driver123', fullName: 'John' }
  });
  
  // Create account
  const account = await tx.account.create({
    data: {
      driverId: driver.id,
      passwordHash: hashedPassword,
      role: 'driver'
    }
  });
  
  return { driver, account };
});
```

### Batch Transactions
```javascript
const [driver, delivery] = await prisma.$transaction([
  prisma.driver.create({ data: driverData }),
  prisma.delivery.create({ data: deliveryData })
]);
```

## Raw SQL (When Needed)

### Raw Query
```javascript
const result = await prisma.$queryRaw`
  SELECT * FROM drivers WHERE active = ${true}
`;
```

### Raw Execute
```javascript
await prisma.$executeRaw`
  UPDATE drivers SET active = ${true} WHERE id = ${driverId}
`;
```

## Error Handling

```javascript
try {
  const driver = await prisma.driver.create({
    data: driverData
  });
} catch (error) {
  if (error.code === 'P2002') {
    // Unique constraint violation
    console.error('Driver with this username already exists');
  } else if (error.code === 'P2025') {
    // Record not found
    console.error('Record not found');
  } else {
    // Other database errors
    console.error('Database error:', error);
  }
}
```

## Common Prisma Error Codes

- `P2000`: Value too long for field
- `P2002`: Unique constraint violation
- `P2003`: Foreign key constraint failed
- `P2025`: Record not found
- `P1001`: Can't reach database server
- `P1002`: Database server timeout
- `P1008`: Operations timed out

## Best Practices

1. **Always use try-catch** for database operations
2. **Use transactions** for related operations
3. **Select only needed fields** to reduce data transfer
4. **Use include sparingly** - only fetch related data when needed
5. **Index frequently queried fields** in schema
6. **Use connection pooling** (already configured)
7. **Validate input** before database operations
8. **Handle errors gracefully** with appropriate user messages
9. **Log errors** for debugging
10. **Use TypeScript** for better type safety (optional)

## Performance Tips

```javascript
// ✅ Good: Select only needed fields
const drivers = await prisma.driver.findMany({
  select: {
    id: true,
    username: true,
    fullName: true
  }
});

// ❌ Bad: Fetching all fields and relations
const drivers = await prisma.driver.findMany({
  include: {
    account: true,
    assignments: true,
    status: true,
    locations: true
  }
});

// ✅ Good: Paginate large result sets
const drivers = await prisma.driver.findMany({
  take: 20,
  skip: 0,
  orderBy: { createdAt: 'desc' }
});

// ✅ Good: Use cursor-based pagination for large datasets
const drivers = await prisma.driver.findMany({
  take: 20,
  cursor: { id: lastId },
  orderBy: { id: 'asc' }
});
```

## Useful Prisma CLI Commands

```bash
# View data in GUI
npx prisma studio

# Generate types after schema change
npx prisma generate

# Format schema file
npx prisma format

# Validate schema
npx prisma validate

# Check database connection
npx prisma db pull
```

## Where to Find Prisma Usage in This Project

All API endpoints use Prisma:
- `/src/server/api/drivers.js` - Driver CRUD
- `/src/server/api/deliveries.js` - Delivery operations
- `/src/server/api/adminDeliveries.js` - Admin operations
- `/src/server/api/locations.js` - GPS tracking
- `/src/server/api/messages.js` - Messaging
- `/src/server/api/tracking.js` - Customer tracking
- `/src/server/api/auth.js` - Authentication
- `/src/server/api/reports.js` - Reporting

## Getting Help

- Prisma Docs: https://www.prisma.io/docs
- Prisma Client API: https://www.prisma.io/docs/reference/api-reference/prisma-client-reference
- Prisma Community: https://www.prisma.io/community
- Stack Overflow: Tag `prisma`

---

**Your system is 100% Prisma-powered! 🚀**
