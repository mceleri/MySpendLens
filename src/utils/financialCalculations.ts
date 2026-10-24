import { ProcessedTransaction } from '../types';
import { getCategoryMeta } from './categories';

export interface CategorySpendSegment {
  category: string;
  label: string;
  color: string;
  amount: number;
  percentage: number;
}

export interface FinancialOverviewData {
  latestMovementDateStr: string;
  latestMovementDate: Date | null;
  totalIn: number;
  totalOut: number;
  netCashFlow: number;
  windowDays: number;
  spendSegments: CategorySpendSegment[];
  hasTransactions: boolean;
}

/**
 * Parses numeric amount from bank string (handles European "1.234,50", negative signs, currency symbols).
 */
export function parseTransactionAmount(amountStr?: string): number {
  if (!amountStr) return 0;
  let clean = amountStr.trim().replace(/[€$£\s]/g, '');
  if (!clean) return 0;

  // Handle trailing minus (e.g., "50.00-")
  let isNegative = false;
  if (clean.endsWith('-')) {
    isNegative = true;
    clean = clean.slice(0, -1);
  } else if (clean.startsWith('-')) {
    isNegative = true;
    clean = clean.slice(1);
  } else if (clean.startsWith('+')) {
    clean = clean.slice(1);
  }

  // European format check: contains comma as decimal separator
  if (clean.includes(',') && clean.includes('.')) {
    // e.g. "1.250,50" -> "1250.50"
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (clean.includes(',')) {
    // e.g. "1250,50" -> "1250.50"
    clean = clean.replace(',', '.');
  }

  const num = parseFloat(clean);
  if (isNaN(num)) return 0;
  return isNegative ? -num : num;
}

/**
 * Parses date string into Date object.
 */
export function parseTransactionDate(dateStr?: string): Date | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Try standard ISO YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    return new Date(year, month, day);
  }

  // Try DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const itMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (itMatch) {
    const day = parseInt(itMatch[1], 10);
    const month = parseInt(itMatch[2], 10) - 1;
    let year = parseInt(itMatch[3], 10);
    if (year < 100) year += 2000;
    return new Date(year, month, day);
  }

  // Try DD/MM without year (assume 2026 or current year)
  const shortMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})/);
  if (shortMatch) {
    const day = parseInt(shortMatch[1], 10);
    const month = parseInt(shortMatch[2], 10) - 1;
    return new Date(2026, month, day);
  }

  const timestamp = Date.parse(trimmed);
  if (!isNaN(timestamp)) {
    return new Date(timestamp);
  }

  return null;
}

/**
 * Formats a Date nicely in English (e.g. "Oct 18, 2026").
 */
export function formatDisplayDate(date: Date | null): string {
  if (!date || isNaN(date.getTime())) return 'No date detected';
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Formats an amount as currency (e.g. "€1,420.50").
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Computes:
 * - Date of the latest movement
 * - IN and OUT of the last 60 days from that latest date
 * - Segmented breakdown of OUT expenses per category
 */
export function computeFinancialOverview(
  transactions: ProcessedTransaction[],
  windowDays = 60
): FinancialOverviewData {
  if (transactions.length === 0) {
    return {
      latestMovementDateStr: 'No transactions',
      latestMovementDate: null,
      totalIn: 0,
      totalOut: 0,
      netCashFlow: 0,
      windowDays,
      spendSegments: [],
      hasTransactions: false,
    };
  }

  // 1. Find the latest movement date across all loaded transactions
  let latestDate: Date | null = null;
  const parsedDates = transactions.map((t) => parseTransactionDate(t.date));

  for (const d of parsedDates) {
    if (d && !isNaN(d.getTime())) {
      if (!latestDate || d.getTime() > latestDate.getTime()) {
        latestDate = d;
      }
    }
  }

  // If no dates were found in the file, fallback to today
  const referenceDate = latestDate ?? new Date();

  // 2. Define the 60-day window [windowStart, referenceDate]
  const windowStartMs = referenceDate.getTime() - windowDays * 24 * 60 * 60 * 1000;

  let totalIn = 0;
  let totalOut = 0;
  const categoryOutMap: Record<string, number> = {};

  transactions.forEach((tx, i) => {
    const txDate = parsedDates[i];
    const isInWindow = !txDate || isNaN(txDate.getTime())
      ? true // If no date, include in total
      : txDate.getTime() >= windowStartMs && txDate.getTime() <= referenceDate.getTime() + 24 * 60 * 60 * 1000;

    if (!isInWindow) return;

    const amount = parseTransactionAmount(tx.amount);

    if (amount > 0) {
      totalIn += amount;
    } else if (amount < 0) {
      const outAmount = Math.abs(amount);
      totalOut += outAmount;
      categoryOutMap[tx.category] = (categoryOutMap[tx.category] || 0) + outAmount;
    }
  });

  // 3. Build color-coded segments for the OUT segmented bar
  const spendSegments: CategorySpendSegment[] = Object.entries(categoryOutMap)
    .map(([cat, amount]) => {
      const meta = getCategoryMeta(cat);
      const percentage = totalOut > 0 ? (amount / totalOut) * 100 : 0;
      const label = meta ? meta.label : cat;
      return {
        category: cat,
        label,
        color: meta ? meta.color : '#94a3b8',
        amount,
        percentage,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  return {
    latestMovementDateStr: latestDate ? formatDisplayDate(latestDate) : 'No dates in file',
    latestMovementDate: latestDate,
    totalIn,
    totalOut,
    netCashFlow: totalIn - totalOut,
    windowDays,
    spendSegments,
    hasTransactions: true,
  };
}
