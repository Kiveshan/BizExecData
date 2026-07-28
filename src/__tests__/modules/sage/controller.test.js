import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractSageRevenue,
  extractSageExpenses,
  extractSageCostOfSales,
  extractSageTotals,
  generateMonthlyDateRanges,
} from '../../../modules/sage/controller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '../../fixtures/sage-profit-and-loss.json');

/**
 * Recorded shape of `ProfitAndLoss/Get` — a flat array of reporting groups,
 * where detail groups carry `Children` and totals are tagged
 * `ReportingLevelType: 10`.
 */
const report = JSON.parse(readFileSync(fixturePath, 'utf8'));

describe('Sage P&L normaliser', () => {
  describe('extractSageRevenue', () => {
    it('flattens the Sales group into line items', () => {
      expect(extractSageRevenue(report)).toEqual([
        { name: 'Sales - Services', amount: 128450.0 },
        { name: 'Sales - Consulting', amount: 41200.5 },
      ]);
    });

    it('line items sum to the reported Total for Sales', () => {
      const sum = extractSageRevenue(report).reduce((acc, r) => acc + r.amount, 0);
      expect(sum).toBeCloseTo(extractSageTotals(report).totalSales, 2);
    });

    it('returns an empty list when the group is absent', () => {
      expect(extractSageRevenue({ data: [] })).toEqual([]);
    });
  });

  describe('extractSageExpenses', () => {
    it('flattens the Expenses group into line items', () => {
      expect(extractSageExpenses(report)).toEqual([
        { name: 'Advertising', amount: 2400.0 },
        { name: 'Rent Paid', amount: 18000.0 },
        { name: 'Salaries and Wages', amount: 61500.0 },
      ]);
    });

    it('line items sum to the reported Total for Expenses', () => {
      const sum = extractSageExpenses(report).reduce((acc, r) => acc + r.amount, 0);
      expect(sum).toBeCloseTo(extractSageTotals(report).totalExpenses, 2);
    });
  });

  describe('extractSageCostOfSales', () => {
    it('flattens the Cost of Sales group, defaulting a missing Total to 0', () => {
      // "Freight and Courier" has no Total in the fixture — Sage omits the key
      // for a group with no movement in the period.
      expect(extractSageCostOfSales(report)).toEqual([
        { name: 'Purchases', amount: 52300.0 },
        { name: 'Freight and Courier', amount: 0 },
      ]);
    });

    it('returns an empty list when the group is absent', () => {
      expect(extractSageCostOfSales({ data: [] })).toEqual([]);
    });
  });

  describe('extractSageTotals', () => {
    it('picks the report-level totals', () => {
      expect(extractSageTotals(report)).toEqual({
        grossProfit: 114170.25,
        netProfit: 32270.25,
        totalSales: 169650.5,
        totalCostOfSales: 55480.25,
        totalExpenses: 81900.0,
      });
    });

    it('reconciles: sales - cost of sales equals gross profit', () => {
      const t = extractSageTotals(report);
      expect(t.totalSales - t.totalCostOfSales).toBeCloseTo(t.grossProfit, 2);
    });

    it('reconciles: gross profit - expenses equals net profit', () => {
      const t = extractSageTotals(report);
      expect(t.grossProfit - t.totalExpenses).toBeCloseTo(t.netProfit, 2);
    });

    it('defaults every total to 0 when the report carries none', () => {
      expect(extractSageTotals({ data: [] })).toEqual({
        grossProfit: 0,
        netProfit: 0,
        totalSales: 0,
        totalCostOfSales: 0,
        totalExpenses: 0,
      });
    });
  });

  describe('generateMonthlyDateRanges', () => {
    it('covers three years back for an initial extraction', () => {
      const ranges = generateMonthlyDateRanges(true);
      const years = new Set(ranges.map((r) => r.year));
      expect(Math.max(...years) - Math.min(...years)).toBe(3);
    });

    it('covers one year back for an incremental extraction', () => {
      const ranges = generateMonthlyDateRanges(false);
      const years = new Set(ranges.map((r) => r.year));
      expect(Math.max(...years) - Math.min(...years)).toBe(1);
    });

    it('emits whole calendar months as YYYY-MM-DD strings', () => {
      for (const r of generateMonthlyDateRanges(false)) {
        expect(r.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(r.startDate.endsWith('-01')).toBe(true);

        // endDate is the last day of the same month as startDate
        const start = new Date(r.startDate);
        const end = new Date(r.endDate);
        expect(end.getMonth()).toBe(start.getMonth());
        expect(new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate()).toBe(
          end.getDate()
        );
      }
    });
  });
});
