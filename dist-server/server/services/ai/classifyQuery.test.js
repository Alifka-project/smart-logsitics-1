"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Tests for query classification: intent, dimension, filters, topN.
 * Run: npm test -- src/server/services/ai/classifyQuery.test.js
 */
const vitest_1 = require("vitest");
const classifyQuery_js_1 = require("./classifyQuery.js");
(0, vitest_1.describe)('classifyQuery', () => {
    (0, vitest_1.describe)('ranking - top customer', () => {
        (0, vitest_1.it)('who is the top customer → ranking, dimension customer', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('who is the top customer');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.RANKING);
            (0, vitest_1.expect)(plan.dimension).toBe(classifyQuery_js_1.DIMENSIONS.CUSTOMER);
            (0, vitest_1.expect)(plan.entity).toBe('deliveries');
            (0, vitest_1.expect)(plan.metric).toBe('count');
            (0, vitest_1.expect)(plan.topN).toBe(10);
        });
        (0, vitest_1.it)('top 5 customers this month → ranking, topN 5, dateRange this month', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('top 5 customers this month');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.RANKING);
            (0, vitest_1.expect)(plan.dimension).toBe(classifyQuery_js_1.DIMENSIONS.CUSTOMER);
            (0, vitest_1.expect)(plan.topN).toBe(5);
            (0, vitest_1.expect)(plan.filters.dateRange?.label).toBe('this month');
        });
        (0, vitest_1.it)('best customer this month → ranking, customer', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('best customer this month');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.RANKING);
            (0, vitest_1.expect)(plan.dimension).toBe(classifyQuery_js_1.DIMENSIONS.CUSTOMER);
        });
        (0, vitest_1.it)('highest order customer → ranking, customer', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('highest order customer');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.RANKING);
            (0, vitest_1.expect)(plan.dimension).toBe(classifyQuery_js_1.DIMENSIONS.CUSTOMER);
        });
        (0, vitest_1.it)('biggest client last 30 days → ranking, customer, dateRange', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('biggest client last 30 days');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.RANKING);
            (0, vitest_1.expect)(plan.dimension).toBe(classifyQuery_js_1.DIMENSIONS.CUSTOMER);
            (0, vitest_1.expect)(plan.filters.dateRange?.label).toBe('last 30 days');
        });
    });
    (0, vitest_1.describe)('count', () => {
        (0, vitest_1.it)('how many pending today → count, status pending, dateRange today', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('how many pending today');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.COUNT);
            (0, vitest_1.expect)(plan.filters.status).toBe('pending');
            (0, vitest_1.expect)(plan.filters.dateRange?.label).toBe('today');
        });
        (0, vitest_1.it)('how many delivered this week → count, status delivered', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('how many delivered this week');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.COUNT);
            (0, vitest_1.expect)(plan.filters.status).toBe('delivered');
            (0, vitest_1.expect)(plan.filters.dateRange?.label).toBe('this week');
        });
    });
    (0, vitest_1.describe)('ranking - top product / most sold', () => {
        (0, vitest_1.it)('most sold product → ranking, dimension product', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('most sold product');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.RANKING);
            (0, vitest_1.expect)(plan.dimension).toBe(classifyQuery_js_1.DIMENSIONS.PRODUCT);
        });
        (0, vitest_1.it)('most selling → ranking, dimension product (default period this month)', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('most selling');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.RANKING);
            (0, vitest_1.expect)(plan.dimension).toBe(classifyQuery_js_1.DIMENSIONS.PRODUCT);
            (0, vitest_1.expect)(plan.filters.dateRange?.label).toBe('this month');
        });
        (0, vitest_1.it)('top products this month → ranking, product', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('top products this month');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.RANKING);
            (0, vitest_1.expect)(plan.dimension).toBe(classifyQuery_js_1.DIMENSIONS.PRODUCT);
            (0, vitest_1.expect)(plan.filters.dateRange?.label).toBe('this month');
        });
        (0, vitest_1.it)('most selling product this month → ranking, product', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('most selling product this month');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.RANKING);
            (0, vitest_1.expect)(plan.dimension).toBe(classifyQuery_js_1.DIMENSIONS.PRODUCT);
        });
    });
    (0, vitest_1.describe)('trend', () => {
        (0, vitest_1.it)('delivered vs cancelled last 30 days → trend or count', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('delivered vs cancelled last 30 days');
            (0, vitest_1.expect)([classifyQuery_js_1.INTENTS.TREND, classifyQuery_js_1.INTENTS.COUNT]).toContain(plan.intent);
            (0, vitest_1.expect)(plan.filters.dateRange?.label).toBe('last 30 days');
        });
    });
    (0, vitest_1.describe)('navigation', () => {
        (0, vitest_1.it)('where is POD report → navigation', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('where is POD report');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.NAVIGATION);
        });
        (0, vitest_1.it)('where is pod report → navigation', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('where is pod report');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.NAVIGATION);
        });
    });
    (0, vitest_1.describe)('lookup', () => {
        (0, vitest_1.it)('show deliveries for dubai marina → lookup', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('show deliveries for dubai marina');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.LOOKUP);
            (0, vitest_1.expect)(plan.rawQuery).toBe('show deliveries for dubai marina');
        });
        (0, vitest_1.it)('deliveries to dubai marina → lookup', () => {
            const plan = (0, classifyQuery_js_1.classifyQuery)('deliveries to dubai marina');
            (0, vitest_1.expect)(plan.intent).toBe(classifyQuery_js_1.INTENTS.LOOKUP);
        });
    });
});
