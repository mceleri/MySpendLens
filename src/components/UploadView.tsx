import React, { useRef, useState } from 'react';
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
} from 'lucide-react';
import {
  inspectCsvFile,
  extractRowsWithMapping,
  CsvInspectionResult,
  RawRow,
} from '../utils/csvParser';
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

  const processSelectedFile = (file: File) => {
    setErrorMsg(null);
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setErrorMsg('Please select a valid CSV file (.csv).');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content || content.trim().length === 0) {
        setErrorMsg('The selected CSV file is empty.');
        return;
      }

      try {
        const inspected = await inspectCsvFile(content);
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
        setErrorMsg((err as Error).message || 'Unable to parse CSV file.');
      }
    };
    reader.onerror = () => {
      setErrorMsg('Unable to read the selected file.');
    };
    reader.readAsText(file);
  };

  // STEP 2 -> STEP 3: Analyze mapping and deduplicate
  const handleConfirmMapping = () => {
    if (!inspection || !descCol) {
      setErrorMsg('Please select at least a Description / Causale column.');
      return;
    }

    try {
      const extracted = extractRowsWithMapping(inspection.rawPapaResult.data, {
        dateColumn: dateCol || undefined,
        descriptionColumn: descCol,
        amountColumn: amountCol || undefined,
      });

      if (extracted.length === 0) {
        setErrorMsg('No valid rows could be extracted with the selected columns.');
        return;
      }

      // Check duplicates against existing database fingerprints
      const freshRows: RawRow[] = [];
      let dupes = 0;
      const seenInBatch = new Set<string>();

      for (const row of extracted) {
        const fp = generateTransactionFingerprint(row.date, row.description, row.amount);
        if (existingFingerprints.has(fp) || seenInBatch.has(fp)) {
          dupes++;
        } else {
          seenInBatch.add(fp);
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
            {step === 'review_merge' && 'Review & Merge Movements'}
          </h2>
          <p className="upload-view-desc">
            {step === 'select_file' && 'Select any bank CSV export. You will map columns in the next step.'}
            {step === 'map_columns' && 'Confirm which columns correspond to date, description, and amount.'}
            {step === 'review_merge' && 'Compare movements with database to prevent duplicates.'}
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
                accept=".csv,text/csv"
                className="hidden-file-input"
                onChange={handleFileInput}
                disabled={disabled}
              />

              <div className="dropzone-content-mobile">
                <div className="dropzone-icon-wrap-sm">
                  <UploadCloud size={32} className="text-primary" />
                </div>
                <div>
                  <h4 className="dropzone-title-sm">Select or drag & drop a CSV statement</h4>
                  <p className="dropzone-desc-sm">
                    Only CSV (.csv) format is supported. All data is processed 100% locally in your browser.
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
                  <span>Browse CSV from device</span>
                </button>
              </div>
            </div>

            {totalLoaded > 0 && (
              <div className="mt-3 text-center">
                <span className="text-xs text-muted">
                  Your local database currently holds <strong className="text-main">{totalLoaded}</strong> saved movements.
                </span>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Map Columns with 2-row Preview */}
        {step === 'map_columns' && inspection && (
          <div className="upload-step-body">
            <div className="step-file-summary">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={16} className="text-primary" />
                <span className="font-semibold text-main text-xs">{selectedFileName}</span>
              </div>
              <span className="badge-pill badge-primary font-mono text-xs">
                {inspection.totalDataRows} rows detected
              </span>
            </div>

            {/* 2-Row Preview Table */}
            <div className="preview-section">
              <span className="preview-label">File Preview (First 2 Rows):</span>
              <div className="preview-table-container">
                <table className="preview-table">
                  <thead>
                    <tr>
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
                    {inspection.previewRows.map((row, idx) => (
                      <tr key={idx}>
                        {inspection.headers.map((h) => (
                          <td key={h} className="preview-td">
                            {row[h] || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
                Total in file: <strong>{totalInFile}</strong> movements &bull; Identified by{' '}
                <em>(date + causale + amount)</em>.
              </span>
            </div>

            {newRowsToImport.length === 0 ? (
              <div className="merge-empty-alert">
                <p className="font-semibold text-main">All movements already exist in database.</p>
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
