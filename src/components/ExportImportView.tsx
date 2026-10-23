import React, { useState, useRef } from 'react';
import JSZip from 'jszip';
import {
  DownloadCloud,
  UploadCloud,
  FileArchive,
  Database,
  Brain,
  Check,
  AlertCircle,
  FileText,
  RefreshCw,
  FolderDown,
  Layers,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { ProcessedTransaction } from '../types';
import { CategoryDefinition } from '../utils/categories';
import { Tier1ModelArtifact } from '../engine/tier1_browser_engine';

interface ExportImportViewProps {
  transactions: ProcessedTransaction[];
  categories: CategoryDefinition[];
  useTier1: boolean;
  tier1Threshold: number;
  tier1Artifact: Tier1ModelArtifact | null;
  onRestoreAll: (data: {
    transactions?: ProcessedTransaction[];
    categories?: CategoryDefinition[];
    config?: { useTier1?: boolean; tier1Threshold?: number };
    tier1Artifact?: Tier1ModelArtifact;
    replaceTransactions?: boolean;
  }) => Promise<{ transactionsAdded: number; categoriesSaved: number }>;
}

interface StagedBackup {
  fileName: string;
  fileSize: string;
  isZip: boolean;
  transactions?: ProcessedTransaction[];
  categories?: CategoryDefinition[];
  config?: { useTier1?: boolean; tier1Threshold?: number };
  tier1Artifact?: Tier1ModelArtifact;
  manifest?: Record<string, unknown>;
}

export const ExportImportView: React.FC<ExportImportViewProps> = ({
  transactions,
  categories,
  useTier1,
  tier1Threshold,
  tier1Artifact,
  onRestoreAll,
}) => {
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [stagedBackup, setStagedBackup] = useState<StagedBackup | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Import options
  const [importTransactions, setImportTransactions] = useState(true);
  const [transactionMode, setTransactionMode] = useState<'merge' | 'replace'>('merge');
  const [importCategories, setImportCategories] = useState(true);
  const [importConfig, setImportConfig] = useState(true);
  const [importTier1, setImportTier1] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Helper to obtain the active Tier 1 artifact (loads fallback if null in memory)
  const getActiveTier1Artifact = async (): Promise<Tier1ModelArtifact> => {
    if (tier1Artifact) return tier1Artifact;
    try {
      const res = await fetch('/myspendlens_tier1_base_model.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch {
      throw new Error('Unable to read Tier 1 base model artifact.');
    }
  };

  // Helper to trigger browser file download
  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getTimestamp = () => {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  };

  // 1. Export Full Backup as a Single ZIP Archive
  const handleExportFullZip = async () => {
    setIsExporting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const zip = new JSZip();
      const timestamp = new Date().toISOString();
      const t1 = await getActiveTier1Artifact();

      // 1. transactions.json
      zip.file(
        'transactions.json',
        JSON.stringify(transactions, null, 2)
      );

      // 2. categories.json
      zip.file(
        'categories.json',
        JSON.stringify(categories, null, 2)
      );

      // 3. config.json
      zip.file(
        'config.json',
        JSON.stringify(
          {
            useTier1,
            tier1Threshold,
            exportedAt: timestamp,
          },
          null,
          2
        )
      );

      // 4. tier1_model.json
      zip.file(
        'tier1_model.json',
        JSON.stringify(t1, null, 2)
      );

      // 5. manifest.json
      zip.file(
        'manifest.json',
        JSON.stringify(
          {
            appName: 'MySpendLens',
            version: '1.0.0',
            exportedAt: timestamp,
            summary: {
              transactionsCount: transactions.length,
              categoriesCount: categories.length,
              tier1ModelVersion: t1.version,
              tier1Features: t1.metrics.num_features,
              tier1Classes: t1.classes.length,
              tier1FeedbackCount: t1.incremental_learning.user_feedback_count,
            },
          },
          null,
          2
        )
      );

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      triggerDownload(blob, `myspendlens-full-backup-${getTimestamp()}.zip`);
      setSuccessMsg('Full backup archive (.zip) exported successfully!');
    } catch (err) {
      console.error('Export ZIP error:', err);
      setErrorMsg(`Export failed: ${(err as Error).message}`);
    } finally {
      setIsExporting(false);
    }
  };

  // 2. Export Database Only (.json)
  const handleExportDbJson = () => {
    try {
      const dbPayload = {
        exportedAt: new Date().toISOString(),
        transactions,
        categories,
        config: {
          useTier1,
          tier1Threshold,
        },
      };
      const blob = new Blob([JSON.stringify(dbPayload, null, 2)], {
        type: 'application/json',
      });
      triggerDownload(blob, `myspendlens-database-${getTimestamp()}.json`);
      setSuccessMsg('Database (transactions, categories, settings) exported to JSON!');
    } catch (err) {
      setErrorMsg(`Export failed: ${(err as Error).message}`);
    }
  };

  // 3. Export Tier 1 Model Only (.json)
  const handleExportTier1Json = async () => {
    setIsExporting(true);
    try {
      const t1 = await getActiveTier1Artifact();
      const blob = new Blob([JSON.stringify(t1, null, 2)], {
        type: 'application/json',
      });
      triggerDownload(blob, `myspendlens-tier1-model-${getTimestamp()}.json`);
      setSuccessMsg('Tier 1 ML model artifact exported to JSON!');
    } catch (err) {
      setErrorMsg(`Export failed: ${(err as Error).message}`);
    } finally {
      setIsExporting(false);
    }
  };

  // Helper format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Parse dropped or selected file (.zip or .json)
  const handleFileSelected = async (file: File) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setStagedBackup(null);

    const isZip = file.name.endsWith('.zip') || file.type.includes('zip');
    const isJson = file.name.endsWith('.json') || file.type.includes('json');

    if (!isZip && !isJson) {
      setErrorMsg('Please select a valid .zip backup archive or a .json backup file.');
      return;
    }

    try {
      if (isZip) {
        const zip = await JSZip.loadAsync(file);
        let parsedTransactions: ProcessedTransaction[] | undefined;
        let parsedCategories: CategoryDefinition[] | undefined;
        let parsedConfig: { useTier1?: boolean; tier1Threshold?: number } | undefined;
        let parsedTier1: Tier1ModelArtifact | undefined;
        let manifest: Record<string, unknown> | undefined;

        // 1. transactions.json
        const txFile = zip.file('transactions.json');
        if (txFile) {
          const text = await txFile.async('string');
          const data = JSON.parse(text);
          if (Array.isArray(data)) parsedTransactions = data;
        }

        // 2. categories.json
        const catFile = zip.file('categories.json');
        if (catFile) {
          const text = await catFile.async('string');
          const data = JSON.parse(text);
          if (Array.isArray(data)) parsedCategories = data;
        }

        // 3. config.json
        const configFile = zip.file('config.json');
        if (configFile) {
          const text = await configFile.async('string');
          parsedConfig = JSON.parse(text);
        }

        // 4. tier1_model.json
        const t1File = zip.file('tier1_model.json');
        if (t1File) {
          const text = await t1File.async('string');
          parsedTier1 = JSON.parse(text);
        }

        // 5. manifest.json
        const manifestFile = zip.file('manifest.json');
        if (manifestFile) {
          const text = await manifestFile.async('string');
          manifest = JSON.parse(text);
        }

        if (!parsedTransactions && !parsedCategories && !parsedConfig && !parsedTier1) {
          throw new Error('No valid MySpendLens data found inside the ZIP archive.');
        }

        setStagedBackup({
          fileName: file.name,
          fileSize: formatSize(file.size),
          isZip: true,
          transactions: parsedTransactions,
          categories: parsedCategories,
          config: parsedConfig,
          tier1Artifact: parsedTier1,
          manifest,
        });

        // Set default checkbox states based on what was found
        setImportTransactions(Boolean(parsedTransactions && parsedTransactions.length > 0));
        setImportCategories(Boolean(parsedCategories && parsedCategories.length > 0));
        setImportConfig(Boolean(parsedConfig));
        setImportTier1(Boolean(parsedTier1));
      } else {
        // Handle .json file
        const text = await file.text();
        const data = JSON.parse(text);

        let parsedTransactions: ProcessedTransaction[] | undefined;
        let parsedCategories: CategoryDefinition[] | undefined;
        let parsedConfig: { useTier1?: boolean; tier1Threshold?: number } | undefined;
        let parsedTier1: Tier1ModelArtifact | undefined;

        // Auto-detect format
        if (data && data.weights && data.vocabulary && data.classes) {
          // It's a Tier 1 model artifact
          parsedTier1 = data as Tier1ModelArtifact;
        } else if (data && (data.transactions || data.categories || data.config)) {
          // It's a compound DB backup JSON
          if (Array.isArray(data.transactions)) parsedTransactions = data.transactions;
          if (Array.isArray(data.categories)) parsedCategories = data.categories;
          if (data.config) parsedConfig = data.config;
        } else if (Array.isArray(data)) {
          if (data.length > 0 && data[0].color && data[0].id) {
            parsedCategories = data;
          } else if (data.length > 0 && (data[0].rawDescription || data[0].fingerprint)) {
            parsedTransactions = data;
          }
        } else {
          throw new Error('Unrecognized JSON structure.');
        }

        setStagedBackup({
          fileName: file.name,
          fileSize: formatSize(file.size),
          isZip: false,
          transactions: parsedTransactions,
          categories: parsedCategories,
          config: parsedConfig,
          tier1Artifact: parsedTier1,
        });

        setImportTransactions(Boolean(parsedTransactions && parsedTransactions.length > 0));
        setImportCategories(Boolean(parsedCategories && parsedCategories.length > 0));
        setImportConfig(Boolean(parsedConfig));
        setImportTier1(Boolean(parsedTier1));
      }
    } catch (err) {
      console.error('File parse error:', err);
      setErrorMsg(`Failed to parse file: ${(err as Error).message}`);
    }
  };

  // Execute restore of staged components
  const handleExecuteRestore = async () => {
    if (!stagedBackup) return;
    setIsImporting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const toRestore: {
        transactions?: ProcessedTransaction[];
        categories?: CategoryDefinition[];
        config?: { useTier1?: boolean; tier1Threshold?: number };
        tier1Artifact?: Tier1ModelArtifact;
        replaceTransactions?: boolean;
      } = {
        replaceTransactions: transactionMode === 'replace',
      };

      if (importTransactions && stagedBackup.transactions) {
        toRestore.transactions = stagedBackup.transactions;
      }
      if (importCategories && stagedBackup.categories) {
        toRestore.categories = stagedBackup.categories;
      }
      if (importConfig && stagedBackup.config) {
        toRestore.config = stagedBackup.config;
      }
      if (importTier1 && stagedBackup.tier1Artifact) {
        toRestore.tier1Artifact = stagedBackup.tier1Artifact;
      }

      const res = await onRestoreAll(toRestore);

      const parts: string[] = [];
      if (toRestore.transactions) {
        parts.push(
          transactionMode === 'replace'
            ? `${toRestore.transactions.length} transactions replaced`
            : `${res.transactionsAdded} new transactions merged`
        );
      }
      if (toRestore.categories) {
        parts.push(`${toRestore.categories.length} categories restored`);
      }
      if (toRestore.config) {
        parts.push('settings restored');
      }
      if (toRestore.tier1Artifact) {
        parts.push('Tier 1 model weights restored');
      }

      setSuccessMsg(`Backup restored successfully: ${parts.join(', ')}.`);
      setStagedBackup(null);
    } catch (err) {
      console.error('Restore error:', err);
      setErrorMsg(`Restore failed: ${(err as Error).message}`);
    } finally {
      setIsImporting(false);
    }
  };

  const activeCategoriesCount = categories.filter((c) => c.isActive).length;

  return (
    <div className="view-container">
      {/* Notifications */}
      {errorMsg && (
        <div className="alert-box alert-error mb-4">
          <AlertCircle size={18} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {successMsg && (
        <div className="alert-box alert-success mb-4">
          <CheckCircle2 size={18} className="shrink-0 text-emerald" />
          <span>{successMsg}</span>
        </div>
      )}

      <div className="settings-cards-stack">
        {/* Card 1: EXPORT SECTION */}
        <div className="settings-card">
          <div className="export-import-header">
            <div className="export-import-badge badge-cyan">
              <DownloadCloud size={16} />
              <span>Export</span>
            </div>
            <h3 className="settings-card-title mt-1">Export Data & Model</h3>
            <p className="settings-card-desc">
              Create an encrypted/portable snapshot of your database and model. Everything remains completely private on your device.
            </p>
          </div>

          {/* Current Status Pills */}
          <div className="backup-stats-strip">
            <div className="backup-stat-item">
              <Database size={15} className="text-emerald" />
              <span>
                <strong>{transactions.length}</strong> Transactions
              </span>
            </div>
            <div className="backup-stat-item">
              <Layers size={15} className="text-orange" />
              <span>
                <strong>{categories.length}</strong> Categories ({activeCategoriesCount} active)
              </span>
            </div>
            <div className="backup-stat-item">
              <Brain size={15} className="text-purple" />
              <span>
                Tier 1: <strong>{tier1Artifact?.version || 'v1.0.0'}</strong>
                {tier1Artifact?.incremental_learning?.user_feedback_count
                  ? ` (${tier1Artifact.incremental_learning.user_feedback_count} learned)`
                  : ''}
              </span>
            </div>
          </div>

          {/* Primary Action: Full ZIP Export */}
          <div className="export-action-primary-box">
            <button
              type="button"
              className="btn-export-primary"
              onClick={handleExportFullZip}
              disabled={isExporting}
            >
              {isExporting ? (
                <>
                  <RefreshCw size={18} className="spinner" />
                  <span>Packaging ZIP archive...</span>
                </>
              ) : (
                <>
                  <FileArchive size={20} />
                  <div className="btn-export-text">
                    <span className="btn-export-title">Export Full Backup (.zip)</span>
                    <span className="btn-export-subtitle">
                      Single file containing DB, Categories, Config & Tier 1 Model weights
                    </span>
                  </div>
                </>
              )}
            </button>
          </div>

          {/* Granular Export Options */}
          <div className="granular-export-row">
            <button
              type="button"
              className="btn-export-secondary"
              onClick={handleExportDbJson}
              disabled={isExporting}
              title="Export transactions, categories and settings as JSON"
            >
              <Database size={15} className="text-emerald" />
              <span>Export DB Only (.json)</span>
            </button>

            <button
              type="button"
              className="btn-export-secondary"
              onClick={handleExportTier1Json}
              disabled={isExporting}
              title="Export only the Tier 1 classification model artifact"
            >
              <Brain size={15} className="text-purple" />
              <span>Export Tier 1 Model (.json)</span>
            </button>
          </div>
        </div>

        {/* Card 2: IMPORT SECTION */}
        <div className="settings-card">
          <div className="export-import-header">
            <div className="export-import-badge badge-purple">
              <UploadCloud size={16} />
              <span>Import</span>
            </div>
            <h3 className="settings-card-title mt-1">Restore from Backup</h3>
            <p className="settings-card-desc">
              Import a single <code>.zip</code> package or a specific <code>.json</code> file to restore transactions, categories, or model weights.
            </p>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.json,application/zip,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileSelected(e.target.files[0]);
                e.target.value = '';
              }
            }}
          />

          {/* File Picker Zone */}
          {!stagedBackup && (
            <div
              className="backup-drop-zone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  handleFileSelected(e.dataTransfer.files[0]);
                }
              }}
            >
              <div className="drop-zone-icon-wrap">
                <FolderDown size={30} className="text-cyan" />
              </div>
              <h4 className="drop-zone-title">Click or drag & drop backup file</h4>
              <p className="drop-zone-subtitle">Supports MySpendLens .zip backup or .json export files</p>
            </div>
          )}

          {/* Staged File Breakdown & Confirmation */}
          {stagedBackup && (
            <div className="staged-backup-card">
              <div className="staged-file-header">
                <div className="staged-file-badge">
                  {stagedBackup.isZip ? (
                    <FileArchive size={18} className="text-cyan" />
                  ) : (
                    <FileText size={18} className="text-blue" />
                  )}
                  <span className="font-mono text-sm font-semibold">{stagedBackup.fileName}</span>
                </div>
                <span className="badge-pill badge-muted">{stagedBackup.fileSize}</span>
              </div>

              <p className="staged-file-prompt">Select which components to restore into your workspace:</p>

              {/* Component Checkboxes */}
              <div className="staged-components-list">
                {/* 1. Transactions */}
                {stagedBackup.transactions && stagedBackup.transactions.length > 0 && (
                  <div className="staged-component-row">
                    <label className="checkbox-label-wrap">
                      <input
                        type="checkbox"
                        checked={importTransactions}
                        onChange={(e) => setImportTransactions(e.target.checked)}
                      />
                      <div className="staged-item-details">
                        <span className="staged-item-title">
                          Transactions ({stagedBackup.transactions.length} rows)
                        </span>
                        <span className="staged-item-desc">
                          Financial records, dates, amounts, causali
                        </span>
                      </div>
                    </label>

                    {importTransactions && (
                      <div className="transaction-mode-selector">
                        <label className="radio-label">
                          <input
                            type="radio"
                            name="txMode"
                            checked={transactionMode === 'merge'}
                            onChange={() => setTransactionMode('merge')}
                          />
                          <span>Merge & Deduplicate (Recommended)</span>
                        </label>
                        <label className="radio-label">
                          <input
                            type="radio"
                            name="txMode"
                            checked={transactionMode === 'replace'}
                            onChange={() => setTransactionMode('replace')}
                          />
                          <span>Replace all existing transactions</span>
                        </label>
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Categories */}
                {stagedBackup.categories && stagedBackup.categories.length > 0 && (
                  <div className="staged-component-row">
                    <label className="checkbox-label-wrap">
                      <input
                        type="checkbox"
                        checked={importCategories}
                        onChange={(e) => setImportCategories(e.target.checked)}
                      />
                      <div className="staged-item-details">
                        <span className="staged-item-title">
                          Categories ({stagedBackup.categories.length} classes)
                        </span>
                        <span className="staged-item-desc">
                          Custom colors, icons, AI keywords and active status
                        </span>
                      </div>
                    </label>
                  </div>
                )}

                {/* 3. Settings */}
                {stagedBackup.config && (
                  <div className="staged-component-row">
                    <label className="checkbox-label-wrap">
                      <input
                        type="checkbox"
                        checked={importConfig}
                        onChange={(e) => setImportConfig(e.target.checked)}
                      />
                      <div className="staged-item-details">
                        <span className="staged-item-title">App Configuration</span>
                        <span className="staged-item-desc">
                          Tier 1 strategy & confidence threshold (
                          {Math.round((stagedBackup.config.tier1Threshold || 0.85) * 100)}%)
                        </span>
                      </div>
                    </label>
                  </div>
                )}

                {/* 4. Tier 1 Model */}
                {stagedBackup.tier1Artifact && (
                  <div className="staged-component-row">
                    <label className="checkbox-label-wrap">
                      <input
                        type="checkbox"
                        checked={importTier1}
                        onChange={(e) => setImportTier1(e.target.checked)}
                      />
                      <div className="staged-item-details">
                        <span className="staged-item-title">
                          Tier 1 ML Model ({stagedBackup.tier1Artifact.version})
                        </span>
                        <span className="staged-item-desc">
                          {stagedBackup.tier1Artifact.classes.length} classes,{' '}
                          {stagedBackup.tier1Artifact.metrics.num_features} features,{' '}
                          {stagedBackup.tier1Artifact.incremental_learning.user_feedback_count} feedback steps
                        </span>
                      </div>
                    </label>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="staged-actions-row">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setStagedBackup(null)}
                  disabled={isImporting}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleExecuteRestore}
                  disabled={
                    isImporting ||
                    (!importTransactions && !importCategories && !importConfig && !importTier1)
                  }
                >
                  {isImporting ? (
                    <>
                      <RefreshCw size={16} className="spinner" />
                      <span>Restoring...</span>
                    </>
                  ) : (
                    <>
                      <Check size={16} />
                      <span>Restore Selected Data</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Privacy Note */}
        <div className="settings-card privacy-card">
          <div className="privacy-header">
            <ShieldCheck size={20} className="text-emerald" />
            <h4 className="privacy-title">Local Backup Guarantee</h4>
          </div>
          <p className="privacy-desc">
            The generated backup file is packaged purely within your browser's memory. No transactions, categories or AI model weights are ever uploaded to any cloud server.
          </p>
        </div>
      </div>
    </div>
  );
};
