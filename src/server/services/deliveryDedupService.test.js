import { describe, it, expect } from 'vitest';
import { buildBusinessKey, upsertDeliveryByBusinessKey } from './deliveryDedupService';

describe('deliveryDedupService - buildBusinessKey', () => {
  it('builds a normalized business key from PO and original delivery number', () => {
    const key = buildBusinessKey({
      poNumber: ' po-123 ',
      originalDeliveryNumber: ' del-9 '
    });
    expect(key).toBe('PO-123::DEL-9');
  });

  it('returns null when PO is missing', () => {
    const key = buildBusinessKey({
      poNumber: null,
      originalDeliveryNumber: 'DEL-9'
    });
    expect(key).toBeNull();
  });

  it('returns null when original delivery number is missing', () => {
    const key = buildBusinessKey({
      poNumber: 'PO-123',
      originalDeliveryNumber: ''
    });
    expect(key).toBeNull();
  });
});

describe('deliveryDedupService - upsertDeliveryByBusinessKey', () => {
  function createFakePrisma() {
    const db = {
      deliveries: [],
      events: []
    };

    const prisma = {
      delivery: {
        findFirst: async ({ where }) => {
          if (where && where.businessKey) {
            return db.deliveries.find(d => d.businessKey === where.businessKey) || null;
          }
          return null;
        },
        findUnique: async ({ where }) => {
          if (where && where.id) {
            return db.deliveries.find(d => d.id === where.id) || null;
          }
          return null;
        },
        update: async ({ where, data }) => {
          const idx = db.deliveries.findIndex(d => d.id === where.id);
          if (idx === -1) {
            throw new Error('not found');
          }
          db.deliveries[idx] = { ...db.deliveries[idx], ...data };
          return db.deliveries[idx];
        },
        create: async ({ data }) => {
          const created = { ...data, id: data.id || `id-${db.deliveries.length + 1}` };
          db.deliveries.push(created);
          return created;
        }
      },
      deliveryEvent: {
        create: async ({ data }) => {
          db.events.push(data);
          return data;
        }
      }
    };

    return { prisma, db };
  }

  it('creates a new delivery when no existing businessKey match', async () => {
    const { prisma, db } = createFakePrisma();

    const incoming = {
      id: 'DEL-1',
      customer: 'Acme',
      address: 'Addr',
      phone: '123',
      poNumber: 'PO-1',
      status: 'pending',
      items: 'Item 1',
      metadata: { originalPONumber: 'PO-1', originalDeliveryNumber: 'DEL-ERP-1' },
      businessKey: 'PO-1::DEL-ERP-1'
    };

    const result = await upsertDeliveryByBusinessKey({
      prisma,
      source: 'manual_upload',
      incoming
    });

    expect(result.existed).toBe(false);
    expect(db.deliveries).toHaveLength(1);
    expect(db.deliveries[0].businessKey).toBe('PO-1::DEL-ERP-1');
  });

  it('updates existing non-terminal delivery instead of creating a new one', async () => {
    const { prisma, db } = createFakePrisma();

    db.deliveries.push({
      id: 'DEL-1',
      customer: 'Old Customer',
      address: 'Old Addr',
      phone: '000',
      poNumber: 'PO-1',
      status: 'pending',
      items: 'Old',
      metadata: { originalPONumber: 'PO-1', originalDeliveryNumber: 'DEL-ERP-1' },
      businessKey: 'PO-1::DEL-ERP-1',
      updatedAt: new Date('2020-01-01')
    });

    const incoming = {
      id: 'DEL-1',
      customer: 'New Customer',
      address: 'New Addr',
      phone: '123',
      poNumber: 'PO-1',
      status: 'scheduled',
      items: 'New',
      metadata: { note: 'updated' },
      businessKey: 'PO-1::DEL-ERP-1'
    };

    const result = await upsertDeliveryByBusinessKey({
      prisma,
      source: 'manual_upload',
      incoming
    });

    expect(result.existed).toBe(true);
    expect(db.deliveries).toHaveLength(1);
    expect(db.deliveries[0].customer).toBe('New Customer');
    expect(db.deliveries[0].items).toBe('New');
  });

  it('preserves status for terminal deliveries when re-imported', async () => {
    const { prisma, db } = createFakePrisma();

    db.deliveries.push({
      id: 'DEL-1',
      customer: 'Cust',
      address: 'Addr',
      phone: '123',
      poNumber: 'PO-1',
      status: 'delivered',
      items: 'Old',
      metadata: { originalPONumber: 'PO-1', originalDeliveryNumber: 'DEL-ERP-1' },
      businessKey: 'PO-1::DEL-ERP-1',
      updatedAt: new Date('2020-01-01')
    });

    const incoming = {
      id: 'DEL-1',
      customer: 'Cust',
      address: 'Addr 2',
      phone: '999',
      poNumber: 'PO-1',
      status: 'pending',
      items: 'New',
      metadata: { note: 'reimport' },
      businessKey: 'PO-1::DEL-ERP-1'
    };

    const result = await upsertDeliveryByBusinessKey({
      prisma,
      source: 'sap',
      incoming
    });

    expect(result.existed).toBe(true);
    expect(db.deliveries[0].status).toBe('delivered');
    expect(db.deliveries[0].address).toBe('Addr 2');
  });
});

