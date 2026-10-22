import Papa from 'papaparse';

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
  suggestedColumns: {
    dateColumn: string | null;
    descriptionColumn: string | null;
    amountColumn: string | null;
  };
  rawPapaResult: Papa.ParseResult<Record<string, string>>;
}

/**
 * Inspects a CSV file: parses headers, extracts first 2 rows for preview,
 * and uses regular expressions to suggest Date, Description (Causale), and Amount columns.
 */
export function inspectCsvFile(fileContent: string): Promise<CsvInspectionResult> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(fileContent.trim(), {
      header: true,
      skipEmptyLines: 'greedy',
      dynamicTyping: false,
      complete: (results) => {
        const fields = results.meta.fields || [];

        // If no headers were detected or CSV is single line, try parsing without header
        if (fields.length === 0 || results.data.length === 0) {
          return reject(new Error('No valid columns or data rows detected in this CSV file.'));
        }

        const lowerFields = fields.map((f) => f.trim().toLowerCase());

        // 1. Suggest Date Column
        const dateMatchIdx = lowerFields.findIndex((f) =>
          /^(data|date|fecha|f\.?\s*valor|f\.?\s*oper|day|time|valuta)/i.test(f)
        );

        // 2. Suggest Description / Causale Column
        const descMatchIdx = lowerFields.findIndex((f) =>
          /descri|concept|dettagl|causal|movimento|testo|denominaci|operacion|noisy_description|clean_name|merchant|brand|negozio|commercio|detail|particulars|narration|memo|beneficiar/i.test(f)
        );

        // 3. Suggest Amount Column
        const amountMatchIdx = lowerFields.findIndex((f) =>
          /^(importo|amount|importe|valore|saldo|eur|total|val|quant)/i.test(f)
        );

        const previewRows = results.data.slice(0, 2);

        resolve({
          headers: fields,
          previewRows,
          totalDataRows: results.data.length,
          suggestedColumns: {
            dateColumn: dateMatchIdx !== -1 ? fields[dateMatchIdx] : (fields.length > 0 ? fields[0] : null),
            descriptionColumn: descMatchIdx !== -1 ? fields[descMatchIdx] : (fields.length > 1 ? fields[1] : null),
            amountColumn: amountMatchIdx !== -1 ? fields[amountMatchIdx] : (fields.length > 2 ? fields[2] : null),
          },
          rawPapaResult: results,
        });
      },
      error: (error: Error) => {
        reject(error);
      },
    });
  });
}

/**
 * Extracts RawRow items from a parsed CSV given user-confirmed column mapping.
 */
export function extractRowsWithMapping(
  parsedData: Record<string, string>[],
  mapping: {
    dateColumn?: string;
    descriptionColumn: string;
    amountColumn?: string;
  }
): RawRow[] {
  const { dateColumn, descriptionColumn, amountColumn } = mapping;

  const rows: RawRow[] = [];

  for (const record of parsedData) {
    const rawDesc = (record[descriptionColumn] || '').trim();
    if (!rawDesc) continue;

    const rawDate = dateColumn ? (record[dateColumn] || '').trim() : undefined;
    const rawAmount = amountColumn ? (record[amountColumn] || '').trim() : undefined;

    rows.push({
      date: rawDate,
      description: rawDesc,
      amount: rawAmount,
      rawRecord: record,
    });
  }

  return rows;
}

/**
 * Legacy automated parser fallback
 */
export async function parseTransactionFile(
  fileContent: string,
  _fileName: string
): Promise<RawRow[]> {
  const inspection = await inspectCsvFile(fileContent);
  const descCol = inspection.suggestedColumns.descriptionColumn || inspection.headers[0];
  return extractRowsWithMapping(inspection.rawPapaResult.data, {
    dateColumn: inspection.suggestedColumns.dateColumn || undefined,
    descriptionColumn: descCol,
    amountColumn: inspection.suggestedColumns.amountColumn || undefined,
  });
}
