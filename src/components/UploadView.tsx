import React, { useRef, useState, useMemo, useEffect } from 'react';
import {
  UploadCloud,
  ArrowRight,
  ArrowLeft,
  Calendar,
  FileText,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  Copy,
  Layers,
  FileSpreadsheet,
  Check,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import {
  inspectSpreadsheetFile,
  inspectXlsxWorkbook,
  buildInspectionFromGrid,
  extractRowsWithMapping,
  CsvInspectionResult,
  RawRow,
} from '../utils/csvParser';
import {
  DateFormatPreference,
  detectDateFormatFromValues,
  parseAndFormatToIso,
} from '../utils/financialCalculations';
import { generateTransactionFingerprint } from '../db/transactionDb';

interface UploadViewProps {
  onConfirmImport: (
    newRows: RawRow[],
    fileName: string,
    totalInFile: number,
    skippedDuplicates: number
  ) => Promise<void>;
  existingFingerprints: Set<string>;
  disabled: boolean;
  totalLoaded: number;
  onCancel?: () => void;
}

type StepType = 'select_file' | 'map_columns' | 'review_merge';

export const UploadView: React.FC<UploadViewProps> = ({
  onConfirmImport,
  existingFingerprints,
  disabled,
  totalLoaded,
  onCancel,
}) => {
  const [step, setStep] = useState<StepType>('select_file');
  const [isDragging, setIsDragging] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  // Inspection & Mapping State
  const [inspection, setInspection] = useState<CsvInspectionResult | null>(null);
  const [dateCol, setDateCol] = useState<string>('');
  const [descCol, setDescCol] = useState<string>('');
  const [amountCol, setAmountCol] = useState<string>('');
  const [dateFormat, setDateFormat] = useState<DateFormatPreference>('DD/MM/YYYY');

  // Inspect selected date column for format ambiguity
  const dateValues = useMemo(() => {
    if (!inspection || !dateCol) return [];
    return inspection.rawPapaResult.data.map((r) => r[dateCol]).filter(Boolean);
  }, [inspection, dateCol]);

  const dateInspection = useMemo(() => {
    return detectDateFormatFromValues(dateValues);
  }, [dateValues]);

  // Sync initial detected format when date column changes
  useEffect(() => {
    if (dateInspection.hasSlashOrDashDates) {
      setDateFormat(dateInspection.detectedFormat);
    }
  }, [dateInspection.detectedFormat, dateInspection.hasSlashOrDashDates]);

  // Deduplication state
  const [newRowsToImport, setNewRowsToImport] = useState<RawRow[]>([]);
  const [duplicateCount, setDuplicateCount] = useState<number>(0);
  const [totalInFile, setTotalInFile] = useState<number>(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setStep('select_file');
    setErrorMsg(null);
    setSelectedFileName(null);
    setInspection(null);
    setDateCol('');
    setDescCol('');
    setAmountCol('');
    setDateFormat('DD/MM/YYYY');
    setNewRowsToImport([]);
    setDuplicateCount(0);
    setTotalInFile(0);
  };

  // STEP 1: File selection & inspection
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFile(e.target.files[0]);
    }
  };

  const processSelectedFile = async (file: File) => {
    setErrorMsg(null);
    const lowerName = file.name.toLowerCase();
    const isSupported =
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.xlsx') ||
      lowerName.endsWith('.xls');

    if (!isSupported) {
      setErrorMsg('Please select a valid CSV or Excel file (.csv, .xlsx, .xls).');
      return;
    }

    try {
      const inspected = await inspectSpreadsheetFile(file);
      setSelectedFileName(file.name);
      setInspection(inspected);

      // Pre-fill suggested columns
      setDateCol(inspected.suggestedColumns.dateColumn || '');
      setDescCol(
        inspected.suggestedColumns.descriptionColumn ||
          (inspected.headers.length > 0 ? inspected.headers[0] : '')
      );
      setAmountCol(inspected.suggestedColumns.amountColumn || '');

      setStep('map_columns');
    } catch (err) {
      console.error(err);
      setErrorMsg((err as Error).message || 'Unable to parse file.');
    }
  };

  const handleSheetChange = (newSheet: string) => {
    if (!inspection?.workbook) return;
    try {
      const updated = inspectXlsxWorkbook(inspection.workbook, newSheet);
      setInspection(updated);
      setDateCol(updated.suggestedColumns.dateColumn || '');
      setDescCol(
        updated.suggestedColumns.descriptionColumn ||
          (updated.headers.length > 0 ? updated.headers[0] : '')
      );
      setAmountCol(updated.suggestedColumns.amountColumn || '');
      setErrorMsg(null);
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to switch sheet.');
    }
  };

  const handleHeaderRowChange = (newIndex: number) => {
    if (!inspection?.rawGrid) return;
    const clamped = Math.max(0, Math.min(newIndex, inspection.rawGrid.length - 1));
    const updated = buildInspectionFromGrid(inspection.rawGrid, clamped, {
      sheets: inspection.sheets,
      activeSheet: inspection.activeSheet,
      workbook: inspection.workbook,
    });
    setInspection(updated);
    setDateCol(updated.suggestedColumns.dateColumn || '');
    setDescCol(
      updated.suggestedColumns.descriptionColumn ||
        (updated.headers.length > 0 ? updated.headers[0] : '')
    );
    setAmountCol(updated.suggestedColumns.amountColumn || '');
    setErrorMsg(null);
  };

  // STEP 2 -> STEP 3: Analyze mapping and deduplicate
  const handleConfirmMapping = () => {
    if (!inspection || !descCol) {
      setErrorMsg('Please select at least a Description / Causale column.');
      return;
    }

    try {
      const extracted = extractRowsWithMapping(
        inspection.rawPapaResult.data,
        {
          dateColumn: dateCol || undefined,
          descriptionColumn: descCol,
          amountColumn: amountCol || undefined,
        },
        dateFormat
      );

      if (extracted.length === 0) {
        setErrorMsg('No valid rows could be extracted with the selected columns.');
        return;
      }

      // Check duplicates against existing database fingerprints using multiset occurrence index
      // Prevents merging legitimate identical transactions on the same day (e.g. 2 identical coffees)
      const fileOccurrences = new Map<string, number>();
      const freshRows: RawRow[] = [];
      let dupes = 0;

      for (const row of extracted) {
        const baseFp = generateTransactionFingerprint(row.date, row.description, row.amount);
        const occ = fileOccurrences.get(baseFp) ?? 0;
        fileOccurrences.set(baseFp, occ + 1);
        const indexedFp = occ > 0 ? `${baseFp}#${occ}` : baseFp;

        if (existingFingerprints.has(indexedFp)) {
          dupes++;
        } else {
          freshRows.push(row);
        }
      }

      setNewRowsToImport(freshRows);
      setDuplicateCount(dupes);
      setTotalInFile(extracted.length);
      setErrorMsg(null);
      setStep('review_merge');
    } catch (err) {
      setErrorMsg((err as Error).message || 'Failed to analyze rows.');
    }
  };

  // STEP 3: Final confirmation
  const handleFinalImport = async () => {
    if (!selectedFileName) return;
    await onConfirmImport(newRowsToImport, selectedFileName, totalInFile, duplicateCount);
  };

  return (
    <div className="view-container">
      {/* View Stepper Header Card */}
      <div className="upload-view-card">
        <div className="upload-view-header">
          <div className="upload-stepper-pills">
            <span className={`stepper-pill ${step === 'select_file' ? 'active' : 'completed'}`}>
              <span className="step-num">{step !== 'select_file' ? <Check size={12} /> : '1'}</span>
              <span>Select File</span>
            </span>
            <span className="stepper-arrow">&rarr;</span>
            <span className={`stepper-pill ${step === 'map_columns' ? 'active' : step === 'review_merge' ? 'completed' : ''}`}>
              <span className="step-num">{step === 'review_merge' ? <Check size={12} /> : '2'}</span>
              <span>Map Columns</span>
            </span>
            <span className="stepper-arrow">&rarr;</span>
            <span className={`stepper-pill ${step === 'review_merge' ? 'active' : ''}`}>
              <span className="step-num">3</span>
              <span>Review & Merge</span>
            </span>
          </div>

          <h2 className="upload-view-title mt-2">
            {step === 'select_file' && 'Upload Bank Statement'}
            {step === 'map_columns' && 'Map Statement Columns'}
            {step === 'review_merge' && 'Review & Merge Transactions'}
          </h2>
          <p className="upload-view-desc">
            {step === 'select_file' && 'Select any bank CSV or Excel export. You will map columns in the next step.'}
            {step === 'map_columns' && 'Confirm which columns correspond to date, description, and amount.'}
            {step === 'review_merge' && 'Compare transactions with database to prevent duplicates.'}
          </p>
        </div>

        {errorMsg && (
          <div className="uploader-error">
            <AlertTriangle size={15} />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* STEP 1: Select CSV File */}
        {step === 'select_file' && (
          <div className="upload-step-body">
            <div
              className={`dropzone-card-mobile ${isDragging ? 'dropzone-active' : ''} ${disabled ? 'dropzone-disabled' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !disabled && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,application/vnd.ms-excel"
                className="hidden-file-input"
                onChange={handleFileInput}
                disabled={disabled}
              />

              <div className="dropzone-content-mobile">
                <div className="dropzone-icon-wrap-sm">
                  <UploadCloud size={32} className="text-primary" />
                </div>
                <div>
                  <h4 className="dropzone-title-sm">Select or drag & drop a CSV or Excel statement</h4>
                  <p className="dropzone-desc-sm">
                    Supports CSV (.csv) and Excel (.xlsx, .xls) formats. All data is processed 100% locally in your browser.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-secondary btn-drop-browse"
                  onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  disabled={disabled}
                >
                  <UploadCloud size={15} />
                  <span>Browse file from device</span>
                </button>
              </div>
            </div>

            {totalLoaded > 0 && (
              <div className="mt-3 text-center">
                <span className="text-xs text-muted">
                  Your local database currently holds <strong className="text-main">{totalLoaded}</strong> saved transactions.
                </span>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Map Columns with 2-row Preview */}
        {step === 'map_columns' && inspection && (
          <div className="upload-step-body">
            {inspection.sheets && inspection.sheets.length > 1 && (
              <div className="uploader-info-banner mb-2">
                <Layers size={14} className="text-primary shrink-0" />
                <span className="text-xs">
                  Workbook with multiple sheets ({inspection.sheets.join(', ')}). Currently viewing sheet: <strong>"{inspection.activeSheet}"</strong>.
                </span>
              </div>
            )}

            {!inspection.hasHeaders && (
              <div className="uploader-info-banner mb-2">
                <FileText size={14} className="text-primary shrink-0" />
                <span className="text-xs">
                  No header row detected in file. All rows (from the first one) are preserved as movements.
                </span>
              </div>
            )}

            <div className="step-file-summary">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={16} className="text-primary" />
                <span className="font-semibold text-main text-xs">{selectedFileName}</span>
              </div>
              <div className="flex items-center gap-2">
                {inspection.sheets && inspection.sheets.length > 1 && (
                  <div className="flex items-center gap-1.5 mr-2">
                    <span className="text-xs text-muted">Sheet:</span>
                    <select
                      value={inspection.activeSheet}
                      onChange={(e) => handleSheetChange(e.target.value)}
                      className="column-select text-xs py-0.5 px-2 h-auto"
                      style={{ minWidth: '120px' }}
                    >
                      {inspection.sheets.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <span className="badge-pill badge-primary font-mono text-xs">
                  {inspection.totalDataRows} rows detected
                </span>
              </div>
            </div>

            {/* Header Row Selector */}
            <div className="header-row-nav-card">
              <div className="header-row-info">
                <span className="header-row-title">Header Row</span>
                <span className="header-row-hint">
                  Line containing column titles
                </span>
              </div>
              <div className="header-row-controls">
                <button
                  type="button"
                  className="btn-header-row-step"
                  onClick={() => handleHeaderRowChange(inspection.headerRowIndex - 1)}
                  disabled={inspection.headerRowIndex <= 0}
                  title="Move header row up (previous line)"
                >
                  <ChevronUp size={15} />
                  <span>Up</span>
                </button>

                <div className="header-row-badge">
                  <span className="header-row-badge-label">Line</span>
                  <span className="header-row-badge-value">{inspection.headerRowIndex + 1}</span>
                  <span className="header-row-badge-total">/ {inspection.rawGrid.length}</span>
                </div>

                <button
                  type="button"
                  className="btn-header-row-step"
                  onClick={() => handleHeaderRowChange(inspection.headerRowIndex + 1)}
                  disabled={inspection.headerRowIndex >= inspection.rawGrid.length - 1}
                  title="Move header row down (next line)"
                >
                  <span>Down</span>
                  <ChevronDown size={15} />
                </button>
              </div>
            </div>

            {/* 3-Row Preview Table */}
            <div className="preview-section">
              <span className="preview-label">File Preview (First 3 Data Rows):</span>
              <div className="preview-table-container">
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th className="preview-th text-center" style={{ width: '40px' }}>#</th>
                      {inspection.headers.map((h) => {
                        const isDate = h === dateCol;
                        const isDesc = h === descCol;
                        const isAmt = h === amountCol;

                        return (
                          <th
                            key={h}
                            className={`preview-th ${isDate ? 'th-date' : ''} ${isDesc ? 'th-desc' : ''} ${isAmt ? 'th-amount' : ''}`}
                          >
                            <div className="preview-th-content">
                              <span>{h}</span>
                              {isDate && <span className="th-tag tag-date">Date</span>}
                              {isDesc && <span className="th-tag tag-desc">Causale</span>}
                              {isAmt && <span className="th-tag tag-amount">Amount</span>}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {inspection.previewRows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={inspection.headers.length + 1}
                          className="preview-td text-center text-muted py-3"
                        >
                          No data rows found below line {inspection.headerRowIndex + 1}. Move the header row up.
                        </td>
                      </tr>
                    ) : (
                      inspection.previewRows.map((row, idx) => (
                        <tr key={idx}>
                          <td className="preview-td text-muted text-center font-mono text-xs">
                            {inspection.headerRowIndex + 2 + idx}
                          </td>
                          {inspection.headers.map((h) => {
                            const val = row[h] || '—';
                            const isDate = h === dateCol;
                            const parsedIso = isDate && val !== '—' ? parseAndFormatToIso(val, dateFormat) : null;

                            return (
                              <td key={h} className="preview-td">
                                <span className={parsedIso ? 'font-mono text-xs' : ''}>{val}</span>
                                {parsedIso && (
                                  <span className="preview-iso-pill" title={`Formato ISO finale: ${parsedIso}`}>
                                    &rarr; {parsedIso}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="uploader-info-banner mb-1">
              <CheckCircle2 size={14} className="text-emerald shrink-0" />
              <span className="text-xs">
                Non-transaction lines (preambles, footer summaries, empty lines) without valid dates or amounts will be automatically filtered out during import.
              </span>
            </div>

            {/* Column Selectors */}
            <div className="column-selectors-grid">
              <div className="column-field">
                <label className="column-label">
                  <Calendar size={13} className="text-blue" />
                  <span>Date Column</span>
                </label>
                <select
                  value={dateCol}
                  onChange={(e) => setDateCol(e.target.value)}
                  className="column-select"
                >
                  <option value="">(None / Optional)</option>
                  {inspection.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>

                {/* Date Format Disambiguation if slashes/dashes are present */}
                {dateCol && dateInspection.hasSlashOrDashDates && (
                  <div className="date-disambiguation-box">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold text-main flex items-center gap-1.5">
                        <Calendar size={12} className="text-primary" />
                        <span>Formato data nel file:</span>
                      </span>
                      {dateInspection.isAmbiguous ? (
                        <span className="badge-pill badge-warning text-xs flex items-center gap-1">
                          <AlertTriangle size={11} />
                          Formato ambiguo (richiesta conferma)
                        </span>
                      ) : (
                        <span className="badge-pill badge-primary text-xs">
                          Rilevato: {dateFormat}
                        </span>
                      )}
                    </div>

                    {dateInspection.isAmbiguous && (
                      <p className="text-xs text-muted mb-2">
                        I valori come <code className="font-mono text-primary font-semibold">"{dateInspection.sampleValue}"</code> potrebbero essere Giorno/Mese o Mese/Giorno. Specifica quale parte viene prima:
                      </p>
                    )}

                    <div className="date-format-toggle-group">
                      <button
                        type="button"
                        className={`btn-date-format-toggle ${dateFormat === 'DD/MM/YYYY' ? 'active' : ''}`}
                        onClick={() => setDateFormat('DD/MM/YYYY')}
                      >
                        <span className="toggle-main">DD/MM/YYYY</span>
                        <span className="toggle-sub">Giorno prima (es. 28/09/2026)</span>
                      </button>

                      <button
                        type="button"
                        className={`btn-date-format-toggle ${dateFormat === 'MM/DD/YYYY' ? 'active' : ''}`}
                        onClick={() => setDateFormat('MM/DD/YYYY')}
                      >
                        <span className="toggle-main">MM/DD/YYYY</span>
                        <span className="toggle-sub">Mese prima (es. 09/28/2026)</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="column-field">
                <label className="column-label">
                  <FileText size={13} className="text-purple" />
                  <span>Description / Causale *</span>
                </label>
                <select
                  value={descCol}
                  onChange={(e) => setDescCol(e.target.value)}
                  className="column-select column-select-required"
                >
                  {inspection.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>

              <div className="column-field">
                <label className="column-label">
                  <DollarSign size={13} className="text-emerald" />
                  <span>Amount Column</span>
                </label>
                <select
                  value={amountCol}
                  onChange={(e) => setAmountCol(e.target.value)}
                  className="column-select"
                >
                  <option value="">(None / Optional)</option>
                  {inspection.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Step 2 Actions */}
            <div className="upload-actions-row">
              <button
                type="button"
                className="btn-upload-back"
                onClick={() => setStep('select_file')}
              >
                <ArrowLeft size={15} />
                <span>Change File</span>
              </button>

              <button
                type="button"
                className="btn-upload-next"
                onClick={handleConfirmMapping}
                disabled={!descCol}
              >
                <span>Check Duplicates</span>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Deduplication & Review Merge */}
        {step === 'review_merge' && (
          <div className="upload-step-body">
            <div className="merge-summary-banner">
              <div className="merge-stat-card bg-emerald-subtle">
                <div className="merge-stat-top">
                  <CheckCircle2 size={16} className="text-emerald" />
                  <span className="merge-stat-label">New Movements</span>
                </div>
                <div className="merge-stat-number text-emerald font-mono">
                  +{newRowsToImport.length}
                </div>
                <span className="merge-stat-hint">Will be classified & saved to DB</span>
              </div>

              <div className="merge-stat-card bg-slate-subtle">
                <div className="merge-stat-top">
                  <Copy size={16} className="text-muted" />
                  <span className="merge-stat-label">Existing Duplicates</span>
                </div>
                <div className="merge-stat-number text-muted font-mono">
                  {duplicateCount}
                </div>
                <span className="merge-stat-hint">Already in DB (skipped)</span>
              </div>
            </div>

            <div className="merge-meta-box">
              <Layers size={14} className="text-primary" />
              <span>
                Total in file: <strong>{totalInFile}</strong> transactions &bull; Identified by{' '}
                <em>(date + description + amount)</em>.
              </span>
            </div>

            {duplicateCount > 0 && (
              <div className="uploader-info-banner mt-2">
                <AlertTriangle size={14} className="text-warning shrink-0" />
                <span className="text-xs">
                  <strong>{duplicateCount}</strong> out of <strong>{totalInFile}</strong> transactions already exist in your local database from previous imports and were automatically skipped to avoid double-counting.
                </span>
              </div>
            )}

            {newRowsToImport.length === 0 ? (
              <div className="merge-empty-alert">
                <p className="font-semibold text-main">All transactions already exist in database.</p>
                <p className="text-xs text-dim mt-1">
                  No new transactions need classification or import.
                </p>
                <div className="upload-actions-row mt-3">
                  <button
                    type="button"
                    className="btn-upload-back"
                    onClick={resetState}
                  >
                    <span>Upload Another File</span>
                  </button>
                  {onCancel && (
                    <button
                      type="button"
                      className="btn-upload-primary"
                      onClick={onCancel}
                    >
                      <span>Return to Home</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <div className="upload-actions-row mt-3">
                <button
                  type="button"
                  className="btn-upload-back"
                  onClick={() => setStep('map_columns')}
                >
                  <ArrowLeft size={15} />
                  <span>Adjust Columns</span>
                </button>

                <button
                  type="button"
                  className="btn-upload-primary"
                  onClick={handleFinalImport}
                >
                  <span>Import & Classify ({newRowsToImport.length})</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
