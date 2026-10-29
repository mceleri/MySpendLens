import React, { useState, useMemo } from 'react';
import {
  Brain,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Database,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Cpu,
  DownloadCloud,
  ArrowRight,
  GitMerge,
} from 'lucide-react';
import { ProcessedTransaction } from '../types';
import { CategoryDefinition } from '../utils/categories';
import {
  MySpendLensTier1Engine,
  TrainingProgress,
  TrainingSummary,
} from '../engine/tier1_browser_engine';
import { MySpendLensTier2Engine } from '../engine/tier2_embedding_engine';

interface CleanAnchor {
  name: string;
  category: string;
  country?: string;
}

interface Tier1TrainingModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: ProcessedTransaction[];
  categories: CategoryDefinition[];
  tier1Engine: MySpendLensTier1Engine | null;
  tier2Engine: MySpendLensTier2Engine | null;
  ensureTier1Engine: () => Promise<MySpendLensTier1Engine>;
  ensureTier2Engine: () => Promise<MySpendLensTier2Engine>;
  onTrainingComplete: () => Promise<void>;
}

type StepStatus = 'idle' | 'running' | 'success' | 'skipped' | 'error';

interface ExecutionStep {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
  detail?: string;
}

export const Tier1TrainingModal: React.FC<Tier1TrainingModalProps> = ({
  isOpen,
  onClose,
  transactions,
  categories,
  tier1Engine,
  tier2Engine,
  ensureTier1Engine,
  ensureTier2Engine,
  onTrainingComplete,
}) => {
  const [phase, setPhase] = useState<'confirm' | 'running' | 'success' | 'error'>('confirm');
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compute dataset statistics
  const validTransactions = useMemo(
    () => transactions.filter((t) => t.rawDescription && t.category && t.category.trim() !== ''),
    [transactions]
  );

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive),
    [categories]
  );

  const activeCategoryNames = useMemo(
    () => new Set(activeCategories.map((c) => c.name)),
    [activeCategories]
  );

  // Check if standard base categories were altered/removed (e.g., 'Utilities' replaced with 'Luce'/'Gas')
  const standardBaseCategories = ['Groceries', 'Dining Out', 'Transport & Auto', 'Healthcare', 'Shopping', 'Utilities'];
  const missingBaseCategories = standardBaseCategories.filter((c) => !activeCategoryNames.has(c));
  const hasCustomTaxonomy = missingBaseCategories.length > 0;

  if (!isOpen) return null;

  const updateStep = (id: string, updates: Partial<ExecutionStep>) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
  };

  const handleStartPipeline = async () => {
    setPhase('running');
    setErrorMsg(null);
    setProgress(null);
    setSummary(null);

    // Initial step setup
    const initialSteps: ExecutionStep[] = [
      {
        id: 'anchors_download',
        label: '1. Download Base Anchors',
        description: 'Load 1,000 certified merchant POIs (IT & ES)',
        status: 'idle',
      },
      {
        id: 'tier2_load',
        label: '2. Initialize Tier 2 ONNX',
        description: hasCustomTaxonomy
          ? 'Load multilingual transformer to remap deleted classes'
          : 'Verify semantic model readiness',
        status: 'idle',
      },
      {
        id: 'distillation',
        label: '3. Distillation & Re-labeling',
        description: hasCustomTaxonomy
          ? `Re-label merchant anchors of [${missingBaseCategories.join(', ')}] with Tier 2 toward active classes`
          : 'All base anchors match active classes',
        status: 'idle',
      },
      {
        id: 'assemble',
        label: '4. Assemble Training Set',
        description: 'Merge personal transactions, base anchors, and category keywords',
        status: 'idle',
      },
      {
        id: 'training',
        label: '5. Tier 1 Training Loop',
        description: '10 Epochs of multinomial SGD with L2 regularization',
        status: 'idle',
      },
      {
        id: 'save',
        label: '6. Persist to IndexedDB',
        description: 'Save updated weights into private local browser storage',
        status: 'idle',
      },
    ];

    setSteps(initialSteps);

    try {
      // STEP 1: Download & Load myspendlens_clean_anchors.json
      updateStep('anchors_download', { status: 'running', detail: 'Downloading from /myspendlens_clean_anchors.json...' });
      const anchorsRes = await fetch('/myspendlens_clean_anchors.json');
      if (!anchorsRes.ok) {
        throw new Error(`Unable to download base anchors (HTTP ${anchorsRes.status})`);
      }
      const rawAnchors: CleanAnchor[] = await anchorsRes.json();
      updateStep('anchors_download', {
        status: 'success',
        detail: `1,000 base anchors loaded in memory (${rawAnchors.length} POIs).`,
      });

      // STEP 2 & 3: Check if re-labeling with Tier 2 is needed
      const anchorsNeedingRelabel = rawAnchors.filter((a) => !activeCategoryNames.has(a.category));
      let processedAnchors = [...rawAnchors];

      if (anchorsNeedingRelabel.length > 0) {
        updateStep('tier2_load', { status: 'running', detail: 'Loading ONNX weights into RAM...' });
        const t2 = tier2Engine || (await ensureTier2Engine());
        updateStep('tier2_load', { status: 'success', detail: 'Tier 2 ONNX ready in memory.' });

        // STEP 3: Distillation & semantic re-labeling with Tier 2
        updateStep('distillation', {
          status: 'running',
          detail: `Re-labeling ${anchorsNeedingRelabel.length} orphan anchors...`,
        });

        let relabeledCount = 0;
        const relabeledMap = new Map<string, string>();

        for (let i = 0; i < anchorsNeedingRelabel.length; i++) {
          const item = anchorsNeedingRelabel[i];
          const pred = await t2.predict(item.name);
          // High-confidence filter: only accept pseudo-labels with sufficient semantic certainty to prevent error amplification
          if (pred.confidence >= 0.60 && activeCategoryNames.has(pred.category)) {
            relabeledMap.set(item.name, pred.category);
            relabeledCount++;
          }

          if (i % 10 === 0 || i === anchorsNeedingRelabel.length - 1) {
            updateStep('distillation', {
              detail: `Re-labeled ${relabeledCount}/${anchorsNeedingRelabel.length} anchors (${item.name} ➔ ${pred.category})`,
            });
            // Yield for smooth UI
            await new Promise((r) => setTimeout(r, 10));
          }
        }

        // Apply new labels to anchors, discarding uncertain orphan anchors to preserve dataset purity
        processedAnchors = rawAnchors.flatMap((a) => {
          if (activeCategoryNames.has(a.category)) return [a];
          if (relabeledMap.has(a.name)) return [{ ...a, category: relabeledMap.get(a.name)! }];
          return []; // Filter out ambiguous orphan anchors
        });

        updateStep('distillation', {
          status: 'success',
          detail: `${relabeledCount} anchors successfully re-aligned with active classes!`,
        });
      } else {
        updateStep('tier2_load', { status: 'skipped', detail: 'Not needed (base classes aligned)' });
        updateStep('distillation', { status: 'skipped', detail: 'No merchant anchors to re-label' });
      }

      // STEP 4: Assemble Unified Training Set
      updateStep('assemble', { status: 'running', detail: 'Merging user samples, base anchors and keywords...' });

      const fullDataset: Array<{ description: string; category: string; weight?: number }> = [];

      // 4a. User historical transactions from DB (Highest priority ground truth: weight 15x)
      let userCount = 0;
      for (const t of validTransactions) {
        if (activeCategoryNames.has(t.category)) {
          fullDataset.push({
            description: t.rawDescription,
            category: t.category,
            weight: 15.0,
          });
          userCount++;
        }
      }

      // 4b. Base anchors (1,000 merchants to prevent catastrophic forgetting: weight 1x)
      let anchorsCount = 0;
      for (const a of processedAnchors) {
        if (activeCategoryNames.has(a.category)) {
          fullDataset.push({
            description: a.name,
            category: a.category,
            weight: 1.0,
          });
          anchorsCount++;
        }
      }

      // 4c. Category keywords & examples (weight 5x)
      let keywordsCount = 0;
      for (const cat of activeCategories) {
        if (cat.examples) {
          const parts = cat.examples.split(/[,;\n]/).map((p) => p.trim());
          for (const p of parts) {
            if (p.length >= 2) {
              fullDataset.push({
                description: p,
                category: cat.name,
                weight: 5.0,
              });
              keywordsCount++;
            }
          }
        }
      }

      updateStep('assemble', {
        status: 'success',
        detail: `Dataset completed: ${fullDataset.length} total samples (${userCount} personal transactions [high priority 15x] + ${anchorsCount} base anchors + ${keywordsCount} category keywords).`,
      });

      // STEP 5: Tier 1 Training Loop
      updateStep('training', { status: 'running', detail: 'Initializing weight matrices...' });
      const t1 = tier1Engine || (await ensureTier1Engine());

      // Synchronize all active classes
      t1.syncClassesWithCategories(activeCategories.map((c) => c.name));

      const trainSummary = await t1.trainDataset(fullDataset, {
        epochs: 10,
        learningRate: 0.08,
        l2Reg: 0.0001,
        yieldIntervalMs: 60,
        onProgress: (p) => {
          setProgress(p);
          updateStep('training', {
            detail: `Epoch ${p.epoch}/10 | Loss: ${p.loss.toFixed(3)} | Acc: ${p.accuracy.toFixed(1)}%`,
          });
        },
      });

      updateStep('training', {
        status: 'success',
        detail: `10 Epochs completed | Loss: ${trainSummary.initialLoss.toFixed(3)} ➔ ${trainSummary.finalLoss.toFixed(3)} | Accuracy: ${trainSummary.finalAccuracy.toFixed(1)}%`,
      });

      // STEP 6: Persistence to IndexedDB
      updateStep('save', { status: 'running', detail: 'Saving weights in IndexedDB...' });
      await onTrainingComplete();
      updateStep('save', { status: 'success', detail: 'Weights saved and persisted successfully!' });

      setSummary(trainSummary);
      setPhase('success');
    } catch (err) {
      console.error('Training Pipeline Error:', err);
      setErrorMsg((err as Error).message || 'An error occurred during the training pipeline.');
      setPhase('error');
    }
  };

  const currentEpoch = progress?.epoch || 0;
  const progressPercent = phase === 'success' ? 100 : Math.round((currentEpoch / 10) * 100);

  return (
    <div className="training-modal-backdrop" onClick={phase === 'running' ? undefined : onClose}>
      <div className="training-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="training-modal-header">
          <div className="training-modal-title-group">
            <div className="training-modal-icon-wrap">
              <Brain size={24} className="text-cyan animate-pulse" />
              <Sparkles size={13} className="sparkle-accent text-amber" />
            </div>
            <div>
              <h3 className="training-modal-title">Personal Tier 1 Training</h3>
              <span className="training-modal-subtitle">Local Distillation & Fine-Tuning Pipeline</span>
            </div>
          </div>
          {phase !== 'running' && (
            <button
              type="button"
              className="btn-modal-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="training-modal-body">
          {/* Error Message */}
          {errorMsg && (
            <div className="alert-box alert-error">
              <AlertCircle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* PHASE 1: PRE-FLIGHT CONFIRMATION */}
          {phase === 'confirm' && (
            <div className="training-confirm-container">
              <p className="training-info-text">
                This process trains your local classifier (<strong>0.2ms Tier 1</strong>) by combining your verified transactions with MySpendLens's <strong>1,000 certified merchant anchors</strong>.
              </p>

              {/* Informative Taxonomy Notice */}
              {hasCustomTaxonomy && (
                <div className="taxonomy-alert-notice">
                  <div className="taxonomy-alert-header">
                    <GitMerge size={16} className="text-cyan shrink-0" />
                    <strong>Custom Category Taxonomy Detected</strong>
                  </div>
                  <p className="taxonomy-alert-body">
                    You modified or deleted <strong>{missingBaseCategories.join(', ')}</strong>.
                    During this procedure, the <strong>Tier 2</strong> semantic model will automatically re-label affected merchant anchors onto your active categories, ensuring your Tier 1 model recognizes hundreds of merchants right away!
                  </p>
                </div>
              )}

              {/* Pipeline Overview Card */}
              <div className="pipeline-preview-card">
                <h4 className="pipeline-preview-title">Planned execution steps:</h4>
                <div className="pipeline-steps-preview">
                  <div className="preview-step">
                    <DownloadCloud size={15} className="text-cyan" />
                    <span>Download and load 1,000 base anchors (~89 KB)</span>
                  </div>
                  {hasCustomTaxonomy && (
                    <div className="preview-step">
                      <Cpu size={15} className="text-purple" />
                      <span>Initialize Tier 2 ONNX & Semantic distillation for custom categories</span>
                    </div>
                  )}
                  <div className="preview-step">
                    <Database size={15} className="text-emerald" />
                    <span>Merge with <strong>{validTransactions.length}</strong> personal transactions and keywords</span>
                  </div>
                  <div className="preview-step">
                    <Zap size={15} className="text-amber" />
                    <span>10-Epoch Training Loop with L2 Weight Decay</span>
                  </div>
                  <div className="preview-step">
                    <ShieldCheck size={15} className="text-emerald" />
                    <span>Persist updated model weights to IndexedDB (100% private)</span>
                  </div>
                </div>
              </div>

              <div className="privacy-micro-note mt-2">
                <ShieldCheck size={16} className="text-emerald shrink-0" />
                <span>
                  No downloads occur before your confirmation. All computations execute 100% locally inside your browser.
                </span>
              </div>
            </div>
          )}

          {/* PHASE 2: RUNNING PIPELINE WITH DETAILED STEPS */}
          {phase === 'running' && (
            <div className="training-live-pipeline">
              {/* Progress Bar & Epoch Indicator */}
              <div className="training-progress-header">
                <span className="font-mono text-sm font-bold text-cyan">
                  {currentEpoch > 0 ? `Epoch ${currentEpoch} / 10` : 'Preparing dataset...'}
                </span>
                <span className="font-mono text-sm text-dim">{progressPercent}%</span>
              </div>

              <div className="training-progress-bar-track">
                <div
                  className="training-progress-bar-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Dynamic Loss & Accuracy metrics */}
              {progress && (
                <div className="training-metrics-row mt-2 mb-2">
                  <div className="training-metric-card">
                    <div className="metric-label">
                      <TrendingDown size={14} className="text-cyan" />
                      <span>Cross-Entropy Loss</span>
                    </div>
                    <span className="metric-value font-mono text-cyan">
                      {progress.loss.toFixed(4)}
                    </span>
                  </div>

                  <div className="training-metric-card">
                    <div className="metric-label">
                      <TrendingUp size={14} className="text-emerald" />
                      <span>Training Accuracy</span>
                    </div>
                    <span className="metric-value font-mono text-emerald">
                      {progress.accuracy.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}

              {/* Multi-Step Execution List */}
              <div className="execution-steps-list">
                {steps.map((s) => (
                  <div key={s.id} className={`step-row status-${s.status}`}>
                    <div className="step-icon-wrap">
                      {s.status === 'running' && <RefreshCw size={15} className="spinner text-cyan" />}
                      {s.status === 'success' && <CheckCircle2 size={15} className="text-emerald" />}
                      {s.status === 'skipped' && <ArrowRight size={14} className="text-muted" />}
                      {s.status === 'idle' && <span className="step-dot-idle" />}
                      {s.status === 'error' && <AlertCircle size={15} className="text-danger" />}
                    </div>
                    <div className="step-text-wrap">
                      <span className="step-label">{s.label}</span>
                      <span className="step-detail">{s.detail || s.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PHASE 3: SUCCESS SUMMARY */}
          {phase === 'success' && summary && (
            <div className="training-success-box">
              <div className="success-badge-top">
                <CheckCircle2 size={36} className="text-emerald" />
                <h4 className="success-heading">Training Completed Successfully!</h4>
              </div>

              <p className="success-subtext">
                Your personal Tier 1 classifier has been trained on <strong>{summary.sampleCount} samples</strong> and saved to your local database.
                Custom categories (including re-mapped ones) will now be predicted in <strong>0.2 ms</strong>!
              </p>

              <div className="success-stats-table">
                <div className="stat-row">
                  <span className="stat-name">Trained Samples</span>
                  <span className="stat-val font-mono font-bold">{summary.sampleCount}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Active Classes Covered</span>
                  <span className="stat-val font-mono font-bold">{summary.classes.length} classes</span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Loss Reduction</span>
                  <span className="stat-val font-mono text-cyan">
                    {summary.initialLoss.toFixed(3)} ➔ {summary.finalLoss.toFixed(3)}
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Final Accuracy</span>
                  <span className="stat-val font-mono text-emerald font-bold">
                    {summary.finalAccuracy.toFixed(1)}%
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Total Execution Time</span>
                  <span className="stat-val font-mono">{Math.round(summary.totalTimeMs)} ms</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="training-modal-footer">
          {phase === 'confirm' && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary btn-start-training"
                onClick={handleStartPipeline}
              >
                <Zap size={16} />
                <span>Confirm & Start Training</span>
              </button>
            </>
          )}

          {phase === 'running' && (
            <button
              type="button"
              className="btn-primary w-full opacity-70 cursor-wait"
              disabled
            >
              <RefreshCw size={16} className="spinner" />
              <span>Pipeline Running...</span>
            </button>
          )}

          {phase === 'success' && (
            <button
              type="button"
              className="btn-primary w-full"
              onClick={onClose}
            >
              <span>Done</span>
            </button>
          )}

          {phase === 'error' && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleStartPipeline}
              >
                <RefreshCw size={16} />
                <span>Retry</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
