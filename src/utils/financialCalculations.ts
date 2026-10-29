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

  // European format vs US format check
  if (clean.includes(',') && clean.includes('.')) {
    if (clean.lastIndexOf(',') > clean.lastIndexOf('.')) {
      // e.g. "1.250,50" -> comma is decimal separator
      clean = clean.replace(/\./g, '').replace(',', '.');
    } else {
      // e.g. "1,250.50" -> dot is decimal separator
      clean = clean.replace(/,/g, '');
    }
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

  // Try DD/MM/YYYY or MM/DD/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;

    let day = p1;
    let month = p2 - 1;

    // Disambiguate M/D/Y vs D/M/Y:
    // If p1 <= 12 and p2 > 12, it must be Month/Day/Year (e.g. 9/28/2026)
    if (p1 <= 12 && p2 > 12) {
      month = p1 - 1;
      day = p2;
    }

    if (month >= 0 && month <= 11 && day >= 1 && day <= 31) {
      return new Date(year, month, day);
    }
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

export type DateFormatPreference = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';

export interface DateFormatInspection {
  isAmbiguous: boolean;
  detectedFormat: DateFormatPreference;
  sampleValue: string;
  hasSlashOrDashDates: boolean;
}

/**
 * Inspects a set of date values from a column to determine if format is ambiguous (DD/MM vs MM/DD).
 */
export function detectDateFormatFromValues(values: string[]): DateFormatInspection {
  let hasIso = false;
  let hasP1GreaterThan12 = false;
  let hasP2GreaterThan12 = false;
  let hasSlashOrDash = false;
  let sampleValue = '';

  for (const v of values) {
    const val = String(v || '').trim();
    if (!val) continue;

    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/.test(val)) {
      hasIso = true;
      if (!sampleValue) sampleValue = val;
      continue;
    }

    const slashMatch = val.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
    if (slashMatch) {
      hasSlashOrDash = true;
      if (!sampleValue) sampleValue = val;
      const p1 = parseInt(slashMatch[1], 10);
      const p2 = parseInt(slashMatch[2], 10);
      if (p1 > 12) hasP1GreaterThan12 = true;
      if (p2 > 12) hasP2GreaterThan12 = true;
    }
  }

  if (hasIso && !hasSlashOrDash) {
    return {
      isAmbiguous: false,
      detectedFormat: 'YYYY-MM-DD',
      sampleValue,
      hasSlashOrDashDates: false,
    };
  }

  if (hasP1GreaterThan12 && !hasP2GreaterThan12) {
    return {
      isAmbiguous: false,
      detectedFormat: 'DD/MM/YYYY',
      sampleValue,
      hasSlashOrDashDates: true,
    };
  }

  if (hasP2GreaterThan12 && !hasP1GreaterThan12) {
    return {
      isAmbiguous: false,
      detectedFormat: 'MM/DD/YYYY',
      sampleValue,
      hasSlashOrDashDates: true,
    };
  }

  return {
    isAmbiguous: hasSlashOrDash,
    detectedFormat: 'DD/MM/YYYY',
    sampleValue,
    hasSlashOrDashDates: hasSlashOrDash,
  };
}

/**
 * Parses and converts any date into standard ISO 'YYYY-MM-DD' given the user-specified format preference.
 */
export function parseAndFormatToIso(
  dateStr?: string,
  preference: DateFormatPreference = 'DD/MM/YYYY'
): string | null {
  if (!dateStr) return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // 1. ISO YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 2. Slash, dot, or dash dates: p1 / p2 / p3
  const slashMatch = trimmed.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (slashMatch) {
    const p1 = parseInt(slashMatch[1], 10);
    const p2 = parseInt(slashMatch[2], 10);
    let year = parseInt(slashMatch[3], 10);
    if (year < 100) year += 2000;

    let day: number;
    let month: number;

    if (preference === 'MM/DD/YYYY') {
      month = p1;
      day = p2;
    } else {
      day = p1;
      month = p2;
    }

    // Safety fallback: if user chose DD/MM/YYYY but month > 12 while day <= 12, swap
    if (month > 12 && day <= 12) {
      const temp = day;
      day = month;
      month = temp;
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // 3. Fallback to Date.parse
  const ts = Date.parse(trimmed);
  if (!isNaN(ts)) {
    const d = new Date(ts);
    return formatToIsoDate(d);
  }

  return null;
}

/**
 * Formats a Date object into ISO 'YYYY-MM-DD' using local date components
 * to avoid UTC timezone boundary shifts.
 */
export function formatToIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses and normalizes any recognized date string into standard ISO 'YYYY-MM-DD'.
 * Returns undefined if the string is empty or cannot be parsed.
 */
export function normalizeDateToIso(dateStr?: string, preference: DateFormatPreference = 'DD/MM/YYYY'): string | undefined {
  if (!dateStr) return undefined;
  return parseAndFormatToIso(dateStr, preference) || undefined;
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
