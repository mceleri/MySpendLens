import React, { useState } from 'react';
import {
  Brain,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Layers,
  Database,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Cpu,
} from 'lucide-react';
import { ProcessedTransaction } from '../types';
import { CategoryDefinition } from '../utils/categories';
import {
  MySpendLensTier1Engine,
  TrainingProgress,
  TrainingSummary,
} from '../engine/tier1_browser_engine';

interface Tier1TrainingModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: ProcessedTransaction[];
  categories: CategoryDefinition[];
  tier1Engine: MySpendLensTier1Engine | null;
  onTrainingComplete: () => Promise<void>;
  ensureTier1Engine: () => Promise<MySpendLensTier1Engine>;
}

export const Tier1TrainingModal: React.FC<Tier1TrainingModalProps> = ({
  isOpen,
  onClose,
  transactions,
  categories,
  tier1Engine,
  onTrainingComplete,
  ensureTier1Engine,
}) => {
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  // Compute dataset statistics
  const validTransactions = transactions.filter(
    (t) => t.rawDescription && t.category && t.category.trim() !== ''
  );
  const activeCategories = categories.filter((c) => c.isActive);

  // Build the complete sample pool (all historical transactions + category anchor examples)
  const buildTrainingDataset = () => {
    const samples: Array<{ description: string; category: string }> = [];

    // 1. All historical transactions in database
    for (const t of validTransactions) {
      samples.push({
        description: t.rawDescription,
        category: t.category,
      });
    }

    // 2. Category anchor keywords & examples
    for (const cat of activeCategories) {
      if (cat.examples) {
        const parts = cat.examples.split(/[,;\n]/).map((p) => p.trim());
        for (const p of parts) {
          if (p.length >= 2) {
            samples.push({
              description: p,
              category: cat.name,
            });
          }
        }
      }
    }

    return samples;
  };

  const handleStartTraining = async () => {
    setStatus('running');
    setErrorMsg(null);
    setProgress(null);
    setSummary(null);

    try {
      // 1. Ensure engine is loaded in RAM
      const engine = tier1Engine || (await ensureTier1Engine());

      // 2. Build full dataset
      const dataset = buildTrainingDataset();
      if (dataset.length === 0) {
        throw new Error('No transaction data or category examples available to train on.');
      }

      // 3. Run multi-epoch training loop with live progress callback
      const result = await engine.trainDataset(dataset, {
        epochs: 10,
        learningRate: 0.25,
        l2Reg: 0.0001,
        yieldIntervalMs: 65, // yields to UI so progress animations are visible
        onProgress: (p) => {
          setProgress(p);
        },
      });

      setSummary(result);
      await onTrainingComplete();
      setStatus('success');
    } catch (err) {
      console.error('Tier 1 Training Error:', err);
      setErrorMsg((err as Error).message || 'Failed to train Tier 1 model.');
      setStatus('error');
    }
  };

  const totalEpochs = 10;
  const currentEpoch = progress?.epoch || 0;
  const progressPercent = status === 'success' ? 100 : Math.round((currentEpoch / totalEpochs) * 100);

  return (
    <div className="training-modal-backdrop" onClick={status === 'running' ? undefined : onClose}>
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
              <span className="training-modal-subtitle">In-Browser Continuous Model Adaptation</span>
            </div>
          </div>
          {status !== 'running' && (
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
          {/* Transparency & Explanation Card */}
          <div className="training-info-box">
            <p className="training-info-text">
              Trains the ultra-fast local statistical classifier (<strong>0.2ms</strong>) on your actual spending habits and customized categories.
            </p>
            <div className="training-specs-grid">
              <div className="spec-item">
                <Database size={14} className="text-emerald" />
                <span>
                  <strong>{validTransactions.length}</strong> Transactions
                </span>
              </div>
              <div className="spec-item">
                <Layers size={14} className="text-orange" />
                <span>
                  <strong>{activeCategories.length}</strong> Active Classes
                </span>
              </div>
              <div className="spec-item">
                <Cpu size={14} className="text-purple" />
                <span>
                  <strong>10</strong> SGD Epochs (L2 Reg)
                </span>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="alert-box alert-error">
              <AlertCircle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Running State: Live Metrics */}
          {status === 'running' && (
            <div className="training-live-box">
              <div className="training-progress-header">
                <span className="font-mono text-sm font-bold text-cyan">
                  Epoch {currentEpoch} / {totalEpochs}
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
              <div className="training-metrics-row">
                <div className="training-metric-card">
                  <div className="metric-label">
                    <TrendingDown size={14} className="text-cyan" />
                    <span>Cross-Entropy Loss</span>
                  </div>
                  <span className="metric-value font-mono text-cyan">
                    {progress ? progress.loss.toFixed(4) : '...'}
                  </span>
                </div>

                <div className="training-metric-card">
                  <div className="metric-label">
                    <TrendingUp size={14} className="text-emerald" />
                    <span>Training Accuracy</span>
                  </div>
                  <span className="metric-value font-mono text-emerald">
                    {progress ? `${progress.accuracy.toFixed(1)}%` : '...'}
                  </span>
                </div>
              </div>

              <div className="training-live-pulse-footer">
                <RefreshCw size={13} className="spinner text-cyan" />
                <span>Optimizing character 3-5 n-gram weights in memory...</span>
              </div>
            </div>
          )}

          {/* Success State */}
          {status === 'success' && summary && (
            <div className="training-success-box">
              <div className="success-badge-top">
                <CheckCircle2 size={32} className="text-emerald" />
                <h4 className="success-heading">Tier 1 Model Updated!</h4>
              </div>

              <p className="success-subtext">
                Your personal classifier has been recalibrated and saved locally to IndexedDB. Future transactions from your merchants will be recognized in <strong>~0.2 ms</strong>.
              </p>

              <div className="success-stats-table">
                <div className="stat-row">
                  <span className="stat-name">Trained Dataset</span>
                  <span className="stat-val font-mono font-bold">{summary.sampleCount} samples</span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Loss Reduction</span>
                  <span className="stat-val font-mono text-cyan">
                    {summary.initialLoss.toFixed(3)} ➔ {summary.finalLoss.toFixed(3)}
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Training Accuracy</span>
                  <span className="stat-val font-mono text-emerald font-bold">
                    {summary.finalAccuracy.toFixed(1)}%
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Execution Time</span>
                  <span className="stat-val font-mono">{Math.round(summary.totalTimeMs)} ms</span>
                </div>
              </div>
            </div>
          )}

          {/* Idle State Overview */}
          {status === 'idle' && (
            <div className="training-idle-box">
              <div className="privacy-micro-note">
                <ShieldCheck size={16} className="text-emerald shrink-0" />
                <span>
                  100% Client-Side Training. All gradients and weights are computed directly in your browser.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="training-modal-footer">
          {status === 'idle' && (
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
                onClick={handleStartTraining}
                disabled={validTransactions.length === 0}
              >
                <Zap size={16} />
                <span>Start Training Loop</span>
              </button>
            </>
          )}

          {status === 'running' && (
            <button
              type="button"
              className="btn-primary w-full opacity-70 cursor-wait"
              disabled
            >
              <RefreshCw size={16} className="spinner" />
              <span>Training Epochs in Progress...</span>
            </button>
          )}

          {status === 'success' && (
            <button
              type="button"
              className="btn-primary w-full"
              onClick={onClose}
            >
              <span>Done</span>
            </button>
          )}

          {status === 'error' && (
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
                onClick={handleStartTraining}
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
