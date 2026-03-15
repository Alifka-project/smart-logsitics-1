/**
 * Tests for query classification: intent, dimension, filters, topN.
 * Run: npm test -- src/server/services/ai/classifyQuery.test.js
 */
import { describe, it, expect } from 'vitest';
import { classifyQuery, INTENTS, DIMENSIONS } from './classifyQuery.js';

describe('classifyQuery', () => {
  describe('ranking - top customer', () => {
    it('who is the top customer → ranking, dimension customer', () => {
      const plan = classifyQuery('who is the top customer');
      expect(plan.intent).toBe(INTENTS.RANKING);
      expect(plan.dimension).toBe(DIMENSIONS.CUSTOMER);
      expect(plan.entity).toBe('deliveries');
      expect(plan.metric).toBe('count');
      expect(plan.topN).toBe(10);
    });

    it('top 5 customers this month → ranking, topN 5, dateRange this month', () => {
      const plan = classifyQuery('top 5 customers this month');
      expect(plan.intent).toBe(INTENTS.RANKING);
      expect(plan.dimension).toBe(DIMENSIONS.CUSTOMER);
      expect(plan.topN).toBe(5);
      expect(plan.filters.dateRange?.label).toBe('this month');
    });

    it('best customer this month → ranking, customer', () => {
      const plan = classifyQuery('best customer this month');
      expect(plan.intent).toBe(INTENTS.RANKING);
      expect(plan.dimension).toBe(DIMENSIONS.CUSTOMER);
    });

    it('highest order customer → ranking, customer', () => {
      const plan = classifyQuery('highest order customer');
      expect(plan.intent).toBe(INTENTS.RANKING);
      expect(plan.dimension).toBe(DIMENSIONS.CUSTOMER);
    });

    it('biggest client last 30 days → ranking, customer, dateRange', () => {
      const plan = classifyQuery('biggest client last 30 days');
      expect(plan.intent).toBe(INTENTS.RANKING);
      expect(plan.dimension).toBe(DIMENSIONS.CUSTOMER);
      expect(plan.filters.dateRange?.label).toBe('last 30 days');
    });
  });

  describe('count', () => {
    it('how many pending today → count, status pending, dateRange today', () => {
      const plan = classifyQuery('how many pending today');
      expect(plan.intent).toBe(INTENTS.COUNT);
      expect(plan.filters.status).toBe('pending');
      expect(plan.filters.dateRange?.label).toBe('today');
    });

    it('how many delivered this week → count, status delivered', () => {
      const plan = classifyQuery('how many delivered this week');
      expect(plan.intent).toBe(INTENTS.COUNT);
      expect(plan.filters.status).toBe('delivered');
      expect(plan.filters.dateRange?.label).toBe('this week');
    });
  });

  describe('ranking - top product / most sold', () => {
    it('most sold product → ranking, dimension product', () => {
      const plan = classifyQuery('most sold product');
      expect(plan.intent).toBe(INTENTS.RANKING);
      expect(plan.dimension).toBe(DIMENSIONS.PRODUCT);
    });

    it('most selling → ranking, dimension product (default period this month)', () => {
      const plan = classifyQuery('most selling');
      expect(plan.intent).toBe(INTENTS.RANKING);
      expect(plan.dimension).toBe(DIMENSIONS.PRODUCT);
      expect(plan.filters.dateRange?.label).toBe('this month');
    });

    it('top products this month → ranking, product', () => {
      const plan = classifyQuery('top products this month');
      expect(plan.intent).toBe(INTENTS.RANKING);
      expect(plan.dimension).toBe(DIMENSIONS.PRODUCT);
      expect(plan.filters.dateRange?.label).toBe('this month');
    });

    it('most selling product this month → ranking, product', () => {
      const plan = classifyQuery('most selling product this month');
      expect(plan.intent).toBe(INTENTS.RANKING);
      expect(plan.dimension).toBe(DIMENSIONS.PRODUCT);
    });
  });

  describe('trend', () => {
    it('delivered vs cancelled last 30 days → trend or count', () => {
      const plan = classifyQuery('delivered vs cancelled last 30 days');
      expect([INTENTS.TREND, INTENTS.COUNT]).toContain(plan.intent);
      expect(plan.filters.dateRange?.label).toBe('last 30 days');
    });
  });

  describe('navigation', () => {
    it('where is POD report → navigation', () => {
      const plan = classifyQuery('where is POD report');
      expect(plan.intent).toBe(INTENTS.NAVIGATION);
    });

    it('where is pod report → navigation', () => {
      const plan = classifyQuery('where is pod report');
      expect(plan.intent).toBe(INTENTS.NAVIGATION);
    });
  });

  describe('lookup', () => {
    it('show deliveries for dubai marina → lookup', () => {
      const plan = classifyQuery('show deliveries for dubai marina');
      expect(plan.intent).toBe(INTENTS.LOOKUP);
      expect(plan.rawQuery).toBe('show deliveries for dubai marina');
    });

    it('deliveries to dubai marina → lookup', () => {
      const plan = classifyQuery('deliveries to dubai marina');
      expect(plan.intent).toBe(INTENTS.LOOKUP);
    });
  });
});
