import React from 'react';
import {
  ToggleLeft,
  ToggleRight,
  Sliders,
  Cpu,
  Brain,
  RefreshCw,
  ShieldCheck,
  Database,
  Trash2,
  Tag,
  RotateCcw,
} from 'lucide-react';
import { ModelStats, Tier2LoadingState } from '../types';

interface SettingsViewProps {
  useTier1: boolean;
  onToggleTier1: (enabled: boolean) => void;
  tier1Threshold: number;
  onChangeThreshold: (threshold: number) => void;
  tier1Stats: ModelStats | null;
  tier2State: Tier2LoadingState;
  isProcessing: boolean;
  onReclassify: () => void;
  hasTransactions: boolean;
  totalTransactions?: number;
  onClearDatabase?: () => void;
  onFactoryReset?: () => void;
  onOpenCategories?: () => void;
  onBack?: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  useTier1,
  onToggleTier1,
  tier1Threshold,
  onChangeThreshold,
  tier1Stats,
  tier2State,
  isProcessing,
  onReclassify,
  hasTransactions,
  totalTransactions = 0,
  onClearDatabase,
  onFactoryReset,
  onOpenCategories,
}) => {
  return (
    <div className="view-container">
      <div className="settings-cards-stack">
        {/* Card 1: Toggle Tier 1 vs Tier 2 */}
        <div className="settings-card">
          <h3 className="settings-card-title">Classification Strategy</h3>
          <p className="settings-card-desc">
            Choose whether to use the hybrid cascade architecture or test Tier 2 alone as a baseline.
          </p>

          <button
            type="button"
            className={`settings-toggle-btn ${useTier1 ? 'active-t1' : 'active-t2'}`}
            onClick={() => onToggleTier1(!useTier1)}
            disabled={isProcessing}
          >
            <div className="settings-toggle-icon">
              {useTier1 ? (
                <ToggleRight size={32} className="text-primary" />
              ) : (
                <ToggleLeft size={32} className="text-muted" />
              )}
            </div>
            <div className="settings-toggle-text">
              <span className="settings-toggle-heading">
                {useTier1 ? 'Hybrid Cascade (Tier 1 + Tier 2 Fallback)' : 'Tier 2 Only (Multilingual-E5 Baseline)'}
              </span>
              <span className="settings-toggle-sub">
                {useTier1
                  ? `Fast primary Tier 1 (~0.2ms). If confidence < ${(tier1Threshold * 100).toFixed(0)}%, delegates to Tier 2.`
                  : 'Bypass Tier 1. All transactions are evaluated only using sentence embeddings.'}
              </span>
            </div>
          </button>

          {/* Threshold Slider (only if Tier 1 enabled) */}
          {useTier1 && (
            <div className="settings-slider-box mt-3">
              <div className="settings-slider-header">
                <span className="slider-label">
                  <Sliders size={14} />
                  Tier 1 Confidence Threshold:
                </span>
                <span className="slider-val-badge font-mono font-bold">
                  {(tier1Threshold * 100).toFixed(0)}%
                </span>
              </div>

              <div className="slider-track-wrap">
                <span className="slider-edge font-mono">50%</span>
                <input
                  type="range"
                  min="0.50"
                  max="0.95"
                  step="0.05"
                  value={tier1Threshold}
                  onChange={(e) => onChangeThreshold(parseFloat(e.target.value))}
                  disabled={isProcessing}
                  className="threshold-range-input"
                />
                <span className="slider-edge font-mono">95%</span>
              </div>
              <span className="slider-hint">
                Below this confidence score, Tier 2 cosine distance evaluation is triggered.
              </span>
            </div>
          )}

          {hasTransactions && (
            <button
              type="button"
              className="btn-settings-reclassify mt-3"
              onClick={onReclassify}
              disabled={isProcessing}
            >
              <RefreshCw size={15} className={isProcessing ? 'spinner' : ''} />
              <span>Re-classify transactions with current settings</span>
            </button>
          )}
        </div>

        {/* Card 2: Local Storage & Reset */}
        <div className="settings-card">
          <div className="settings-card-header-flex">
            <div className="flex items-center gap-2">
              <Database size={18} className="text-primary" />
              <h3 className="settings-card-title mb-0">Local Storage & Reset</h3>
            </div>
            <span className="badge-pill badge-primary font-mono">
              {totalTransactions} {totalTransactions === 1 ? 'record' : 'records'}
            </span>
          </div>
          <p className="settings-card-desc mt-2">
            Statements and custom categories are saved locally in your browser's IndexedDB. As you upload new files, duplicates are automatically filtered out.
          </p>

          <div className="settings-danger-actions-stack mt-3">
            {totalTransactions > 0 && onClearDatabase && (
              <button
                type="button"
                className="btn-settings-danger"
                onClick={() => {
                  if (
                    window.confirm(
                      `Sei sicuro di voler eliminare tutte le ${totalTransactions} transazioni salvate? L'operazione non può essere annullata.`
                    )
                  ) {
                    onClearDatabase();
                  }
                }}
                disabled={isProcessing}
              >
                <Trash2 size={15} />
                <span>Cancella tutti i movimenti dal database</span>
              </button>
            )}

            {onFactoryReset && (
              <button
                type="button"
                className="btn-settings-factory-reset"
                onClick={() => {
                  if (
                    window.confirm(
                      'ATTENZIONE: Sei sicuro di voler resettare completamente l\'app?\n\n' +
                      '• Verranno eliminati TUTTI i movimenti memorizzati\n' +
                      '• Verranno cancellati i modelli Tier 1 personalizzati e ripristinati i pesi base\n' +
                      '• Verranno ripristinate le categorie e i colori predefiniti\n' +
                      '• Verranno resettate le impostazioni di classificazione\n\n' +
                      'L\'app ripartirà come nuova e pulita al 100%.'
                    )
                  ) {
                    onFactoryReset();
                  }
                }}
                disabled={isProcessing}
              >
                <RotateCcw size={15} />
                <span>Riparti da app pulita (Factory Reset)</span>
              </button>
            )}
          </div>
        </div>

        {/* Card 3: In-Browser Engines Status */}
        <div className="settings-card">
          <h3 className="settings-card-title">In-Browser Engines Status</h3>

          <div className="engine-status-row">
            <div className="engine-status-icon-wrap bg-blue-subtle">
              <Cpu size={18} className="text-blue" />
            </div>
            <div className="engine-status-text">
              <div className="engine-status-name">
                <span>Tier 1 (Logistic Regression & n-grams)</span>
                {tier1Stats ? (
                  <span className="badge-pill badge-primary">Loaded in Memory</span>
                ) : (
                  <span className="badge-pill badge-muted">On-Demand</span>
                )}
              </div>
              <span className="engine-status-detail">
                {tier1Stats
                  ? `${tier1Stats.featuresCount.toLocaleString()} features • ~0.20 ms/tx`
                  : 'Fast base model (~0.2ms). Loads only when a file is processed.'}
              </span>
            </div>
          </div>

          <div className="engine-status-row">
            <div className="engine-status-icon-wrap bg-purple-subtle">
              <Brain size={18} className="text-purple" />
            </div>
            <div className="engine-status-text">
              <div className="engine-status-name">
                <span>Tier 2 (Xenova/multilingual-e5-small)</span>
                {tier2State.status === 'ready' && (
                  <span className="badge-pill badge-purple">Loaded in RAM</span>
                )}
                {tier2State.status === 'downloading' && (
                  <span className="badge-pill badge-amber">Loading {Math.round(tier2State.progress)}%</span>
                )}
                {tier2State.status === 'idle' && (
                  <span className="badge-pill badge-muted">On-Demand</span>
                )}
                {tier2State.status === 'error' && (
                  <span className="badge-pill badge-rose">Error</span>
                )}
              </div>
              <span className="engine-status-detail">
                {tier2State.status === 'ready'
                  ? 'Quantized ONNX stored in local cache & memory'
                  : tier2State.status === 'downloading'
                  ? `Loading (${tier2State.file || 'ONNX'})...`
                  : tier2State.status === 'idle'
                  ? `Loads only on low confidence fallback (<${(tier1Threshold * 100).toFixed(0)}%) or if Tier 1 is disabled.`
                  : 'Engine encountered an issue.'}
              </span>
            </div>
          </div>
        </div>

        {/* Manage Categories Card */}
        {onOpenCategories && (
          <div className="settings-card">
            <h3 className="settings-card-title">Category Customization</h3>
            <p className="settings-card-desc">
              Add new expense categories, rename existing ones, or configure custom semantic keywords for the Tier 2 embedding engine.
            </p>
            <button
              type="button"
              className="btn-settings-action"
              onClick={onOpenCategories}
            >
              <Tag size={16} />
              <span>Manage Categories</span>
            </button>
          </div>
        )}

        {/* Card 3: Privacy Guarantee */}
        <div className="settings-card privacy-card">
          <div className="privacy-header">
            <ShieldCheck size={20} className="text-emerald" />
            <h4 className="privacy-title">100% Privacy-First Architecture</h4>
          </div>
          <p className="privacy-desc">
            No bank statements, IBANs, amounts, or financial transactions are ever sent to external servers.
            All Tier 1 and Tier 2 inferences execute entirely inside your local browser sandbox.
          </p>
        </div>
      </div>
    </div>
  );
};
