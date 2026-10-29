import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import {
  parseTransactionAmount,
  parseTransactionDate,
  parseAndFormatToIso,
  DateFormatPreference,
} from './financialCalculations';

export interface RawRow {
  date?: string;
  description: string;
  amount?: string;
  rawRecord?: Record<string, string>;
}

export interface CsvInspectionResult {
  headers: string[];
  previewRows: Record<string, string>[];
  totalDataRows: number;
  hasHeaders: boolean;
  suggestedColumns: {
    dateColumn: string | null;
    descriptionColumn: string | null;
    amountColumn: string | null;
  };
  rawPapaResult: {
    data: Record<string, string>[];
    errors?: unknown[];
    meta?: unknown;
  };
  rawGrid: string[][];
  headerRowIndex: number;
  sheets?: string[];
  activeSheet?: string;
  workbook?: XLSX.WorkBook;
}

/**
 * Checks if a string represents an actual calendar date value.
 */
export function isDateString(s: unknown): boolean {
  if (!s) return false;
  const str = String(s).trim();
  if (!str) return false;
  const parsed = parseTransactionDate(str);
  return parsed !== null && !isNaN(parsed.getTime());
}

/**
 * Validates if a string represents a sensible financial amount.
 * Strips currency symbols (EUR, USD, GBP, CHF, €, $, £) and verifies numeric integrity.
 */
export function isValidAmountString(val?: unknown): boolean {
  if (val === undefined || val === null) return false;
  const str = String(val).trim();
  if (!str) return false;

  const clean = str
    .replace(/(EUR|USD|GBP|CHF|[€$£])\s*/gi, '')
    .replace(/\s*(EUR|USD|GBP|CHF|[€$£])/gi, '')
    .trim();

  if (!clean || !/\d/.test(clean)) return false;

  // Pattern matches numbers with optional negative sign/trailing minus, decimals, and European/US separators
  // e.g. -12.86, 1250,50, 1.250,50, 1,250.50, +30, 50.00-
  const numericPattern = /^[+-]?\d{1,3}(([.,]\d{3})*([.,]\d+)?|\d*([.,]\d+)?)[-]?$/;
  if (!numericPattern.test(clean)) return false;

  const num = parseTransactionAmount(clean);
  return !isNaN(num);
}

/**
 * @deprecated Use isValidAmountString instead.
 */
export function isNumericAmountValue(s: unknown): boolean {
  return isValidAmountString(s);
}

/**
 * Finds the initial header row index by scanning for the first row with at least 2 non-empty cells.
 * Returns 0 if none is found.
 */
export function findInitialHeaderRowIndex(rawGrid: string[][]): number {
  for (let i = 0; i < rawGrid.length; i++) {
    const row = rawGrid[i];
    if (!Array.isArray(row)) continue;
    const nonEmpty = row.filter((c) => String(c || '').trim().length > 0);
    if (nonEmpty.length >= 2) {
      return i;
    }
  }
  return 0;
}

/**
 * Suggests Date, Description, and Amount columns by inspecting sample row cell values.
 */
export function suggestColumnsFromDataValues(
  headers: string[],
  sampleRows: Record<string, string>[]
): {
  dateColumn: string | null;
  descriptionColumn: string | null;
  amountColumn: string | null;
} {
  let dateColumn: string | null = null;
  let descriptionColumn: string | null = null;
  let amountColumn: string | null = null;

  for (let c = 0; c < headers.length; c++) {
    const col = headers[c];
    let isDate = false;
    let isAmount = false;
    let isText = false;

    for (const r of sampleRows) {
      const val = (r[col] || '').trim();
      if (isDateString(val)) isDate = true;
      if (isValidAmountString(val)) isAmount = true;
      if (
        val.length > 3 &&
        !isDateString(val) &&
        !isValidAmountString(val) &&
        !/^\d{4}\s*\*/.test(val) // Exclude masked card numbers
      ) {
        isText = true;
      }
    }

    if (isDate && !dateColumn) {
      dateColumn = col;
    }
    if (isAmount && !amountColumn) {
      amountColumn = col;
    }
    if (isText && !descriptionColumn) {
      descriptionColumn = col;
    }
  }

  return { dateColumn, descriptionColumn, amountColumn };
}

/**
 * Builds a CsvInspectionResult given a raw 2D grid of rows and a designated header row index.
 * Automatically extracts headers, computes first 3 data rows for preview, and suggests mappings.
 */
export function buildInspectionFromGrid(
  rawGrid: string[][],
  headerRowIndex: number,
  options?: {
    sheets?: string[];
    activeSheet?: string;
    workbook?: XLSX.WorkBook;
  }
): CsvInspectionResult {
  const clampedHeaderIdx = Math.max(0, Math.min(headerRowIndex, Math.max(0, rawGrid.length - 1)));
  const rawHeaders = rawGrid[clampedHeaderIdx] || [];

  // Determine maximum column count across the grid from headerRowIndex downwards
  let maxCols = rawHeaders.length;
  for (let r = clampedHeaderIdx; r < rawGrid.length; r++) {
    if (rawGrid[r] && rawGrid[r].length > maxCols) {
      maxCols = rawGrid[r].length;
    }
  }
  if (maxCols === 0) maxCols = 1;

  // Build unique header names
  const headers: string[] = [];
  const seenHeaderCounts = new Map<string, number>();

  for (let c = 0; c < maxCols; c++) {
    let name = String(rawHeaders[c] || '').trim();
    if (!name) {
      name = `Column_${c + 1}`;
    }
    const count = seenHeaderCounts.get(name) || 0;
    seenHeaderCounts.set(name, count + 1);
    if (count > 0) {
      name = `${name}_${count + 1}`;
    }
    headers.push(name);
  }

  // Parse all data rows below headerRowIndex
  const data: Record<string, string>[] = [];
  for (let r = clampedHeaderIdx + 1; r < rawGrid.length; r++) {
    const row = rawGrid[r];
    if (!row) continue;
    const hasContent = row.some((c) => String(c || '').trim().length > 0);
    if (!hasContent) continue;

    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      record[headers[c]] = String(row[c] !== undefined ? row[c] : '').trim();
    }
    data.push(record);
  }

  // Preview first 3 rows as requested by user
  const previewRows = data.slice(0, 3);

  // Auto-detect column suggestions from header names
  const lowerFields = headers.map((f) => f.trim().toLowerCase());
  const dateMatchIdx = lowerFields.findIndex((f) =>
    /^(data|date|fecha|f\.?\s*valor|f\.?\s*oper|day|time|valuta)/i.test(f)
  );
  const descMatchIdx = lowerFields.findIndex((f) =>
    /descri|concept|dettagl|causal|movimento|testo|denominaci|operacion|noisy_description|clean_name|merchant|brand|negozio|commercio|detail|particulars|narration|memo|beneficiar/i.test(f)
  );
  const amountMatchIdx = lowerFields.findIndex((f) =>
    /^(importo|amount|importe|valore|saldo|eur|total|val|quant)/i.test(f)
  );

  let suggestedDate: string | null = dateMatchIdx !== -1 ? headers[dateMatchIdx] : null;
  let suggestedDesc: string | null = descMatchIdx !== -1 ? headers[descMatchIdx] : null;
  let suggestedAmount: string | null = amountMatchIdx !== -1 ? headers[amountMatchIdx] : null;

  // Fallback to cell value analysis if headers did not match
  const fromData = suggestColumnsFromDataValues(headers, previewRows);
  if (!suggestedDate) suggestedDate = fromData.dateColumn;
  if (!suggestedDesc) suggestedDesc = fromData.descriptionColumn;
  if (!suggestedAmount) suggestedAmount = fromData.amountColumn;

  return {
    headers,
    previewRows,
    totalDataRows: data.length,
    hasHeaders: true,
    suggestedColumns: {
      dateColumn: suggestedDate || (headers.length > 0 ? headers[0] : null),
      descriptionColumn: suggestedDesc || (headers.length > 1 ? headers[1] : null),
      amountColumn: suggestedAmount || (headers.length > 2 ? headers[2] : null),
    },
    rawPapaResult: {
      data,
    },
    rawGrid,
    headerRowIndex: clampedHeaderIdx,
    sheets: options?.sheets,
    activeSheet: options?.activeSheet,
    workbook: options?.workbook,
  };
}

/**
 * Inspects a CSV file: parses raw 2D grid and builds initial inspection result.
 */
export function inspectCsvFile(fileContent: string): Promise<CsvInspectionResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<string[]>(fileContent.trim(), {
      header: false,
      skipEmptyLines: false,
      dynamicTyping: false,
      complete: (results) => {
        const rawGrid = results.data || [];
        if (rawGrid.length === 0) {
          return reject(new Error('No valid data rows detected in this CSV file.'));
        }

        const initialHeaderIdx = findInitialHeaderRowIndex(rawGrid);
        resolve(buildInspectionFromGrid(rawGrid, initialHeaderIdx));
      },
      error: (error: Error) => {
        reject(error);
      },
    });
  });
}

/**
 * Inspects a specific sheet from an XLSX/XLS workbook.
 */
export function inspectXlsxWorkbook(
  workbook: XLSX.WorkBook,
  targetSheetName?: string,
  customHeaderRowIndex?: number
): CsvInspectionResult {
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('The Excel workbook contains no sheets.');
  }

  const activeSheet = targetSheetName && sheetNames.includes(targetSheetName)
    ? targetSheetName
    : sheetNames[0];

  const worksheet = workbook.Sheets[activeSheet];
  if (!worksheet) {
    throw new Error(`The sheet "${activeSheet}" is empty.`);
  }

  // 1. Recalculate true bounding box range from ALL cell keys to prevent shifted or truncated !ref headers
  let minR = Infinity;
  let minC = Infinity;
  let maxR = -1;
  let maxC = -1;

  for (const key of Object.keys(worksheet)) {
    if (key.charCodeAt(0) === 33) continue; // Skip '!' keys
    const cellPos = XLSX.utils.decode_cell(key);
    if (cellPos.r < minR) minR = cellPos.r;
    if (cellPos.c < minC) minC = cellPos.c;
    if (cellPos.r > maxR) maxR = cellPos.r;
    if (cellPos.c > maxC) maxC = cellPos.c;
  }

  if (worksheet['!ref']) {
    const refRange = XLSX.utils.decode_range(worksheet['!ref']);
    if (refRange.s.r < minR) minR = refRange.s.r;
    if (refRange.s.c < minC) minC = refRange.s.c;
    if (refRange.e.r > maxR) maxR = refRange.e.r;
    if (refRange.e.c > maxC) maxC = refRange.e.c;
  }

  if (minR === Infinity || maxR === -1) {
    throw new Error(`The sheet "${activeSheet}" is empty.`);
  }

  // 2. Propagate merged cells so secondary cells in a merged block are not undefined
  if (worksheet['!merges']) {
    for (const merge of worksheet['!merges']) {
      const originAddr = XLSX.utils.encode_cell(merge.s);
      const originCell = worksheet[originAddr];
      if (!originCell) continue;
      for (let R = merge.s.r; R <= merge.e.r; ++R) {
        for (let C = merge.s.c; C <= merge.e.c; ++C) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          if (!worksheet[addr]) {
            worksheet[addr] = { ...originCell };
          }
        }
      }
    }
  }

  // 3. Extract 2D matrix of cell values starting from line 0 up to maxR
  // This guarantees line indices correspond 1:1 with Excel row numbers (row 0 = Excel row 1)
  const rawGrid: string[][] = [];
  const endCol = Math.max(maxC, 0);

  for (let R = 0; R <= maxR; ++R) {
    const row: string[] = [];
    for (let C = 0; C <= endCol; ++C) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = worksheet[cellAddress];
      let val = '';
      if (cell) {
        if (cell.t === 'd') {
          val = cell.w || (cell.v instanceof Date ? cell.v.toISOString().slice(0, 10) : String(cell.v || ''));
        } else if (cell.t === 'n') {
          val = cell.v !== undefined ? String(cell.v) : (cell.w || '');
        } else if (cell.w !== undefined) {
          val = String(cell.w);
        } else if (cell.v !== undefined) {
          val = String(cell.v);
        }
      }
      row.push(val);
    }
    rawGrid.push(row);
  }

  if (rawGrid.length === 0) {
    throw new Error(`The sheet "${activeSheet}" contains no data rows.`);
  }

  const headerIdx = customHeaderRowIndex !== undefined
    ? customHeaderRowIndex
    : findInitialHeaderRowIndex(rawGrid);

  return buildInspectionFromGrid(rawGrid, headerIdx, {
    sheets: sheetNames,
    activeSheet,
    workbook,
  });
}

/**
 * Inspects an Excel file buffer (supports .xlsx and .xls formats).
 */
export function inspectXlsxFile(buffer: ArrayBuffer, targetSheetName?: string): CsvInspectionResult {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  return inspectXlsxWorkbook(workbook, targetSheetName);
}

/**
 * Inspects any supported spreadsheet file (.csv, .xlsx, .xls).
 */
export async function inspectSpreadsheetFile(file: File): Promise<CsvInspectionResult> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) {
    const text = await file.text();
    if (!text || text.trim().length === 0) {
      throw new Error('The selected CSV file is empty.');
    }
    return inspectCsvFile(text);
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const buffer = await file.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
      throw new Error('The selected Excel file is empty.');
    }
    return inspectXlsxFile(buffer);
  } else {
    throw new Error('Please select a valid CSV or Excel file (.csv, .xlsx, .xls).');
  }
}

/**
 * Extracts RawRow items from a parsed CSV or Excel sheet given user-confirmed column mapping.
 * Automatically filters out non-transaction rows (headers, preambles, summaries, empty lines)
 * by verifying that mapped date and amount columns contain sensible, valid values.
 */
export function extractRowsWithMapping(
  parsedData: Record<string, string>[],
  mapping: {
    dateColumn?: string;
    descriptionColumn: string;
    amountColumn?: string;
  },
  dateFormatPreference: DateFormatPreference = 'DD/MM/YYYY'
): RawRow[] {
  const { dateColumn, descriptionColumn, amountColumn } = mapping;

  const rows: RawRow[] = [];

  for (const record of parsedData) {
    let rawDesc = (record[descriptionColumn] || '').trim();
    const rawDate = dateColumn ? (record[dateColumn] || '').trim() : undefined;
    const rawAmount = amountColumn ? (record[amountColumn] || '').trim() : undefined;

    // 1. Sensible Date validation: if dateColumn is mapped, must parse to a valid date
    // Convert all dates to standard ISO 'YYYY-MM-DD' according to the user's explicit preference
    let finalDate: string | undefined = undefined;
    if (dateColumn) {
      if (!rawDate) {
        continue;
      }
      const iso = parseAndFormatToIso(rawDate, dateFormatPreference);
      if (!iso) {
        continue;
      }
      finalDate = iso;
    } else if (rawDate) {
      finalDate = parseAndFormatToIso(rawDate, dateFormatPreference) || undefined;
    }

    // 2. Sensible Amount validation: if amountColumn is mapped, must be a valid numeric amount
    if (amountColumn) {
      if (!rawAmount || !isValidAmountString(rawAmount)) {
        continue;
      }
    }

    // 3. Description fallback or check: if empty, try to find another text cell or skip
    if (!rawDesc) {
      if (!rawAmount && !rawDate) {
        continue;
      }

      for (const [colName, val] of Object.entries(record)) {
        if (colName !== dateColumn && colName !== amountColumn && colName !== descriptionColumn) {
          const tVal = (val || '').trim();
          if (tVal && !isValidAmountString(tVal) && !isDateString(tVal)) {
            rawDesc = tVal;
            break;
          }
        }
      }

      if (!rawDesc) {
        continue;
      }
    }

    rows.push({
      date: finalDate,
      description: rawDesc,
      amount: rawAmount,
      rawRecord: record,
    });
  }

  return rows;
}
