import React from 'react';
import { ToggleLeft, ToggleRight, Sliders, Cpu, Brain, RefreshCw } from 'lucide-react';

interface ModelTierControlsProps {
  useTier1: boolean;
  onToggleTier1: (enabled: boolean) => void;
  tier1Threshold: number;
  onChangeThreshold: (threshold: number) => void;
  tier2Ready: boolean;
  isProcessing: boolean;
  onReclassify: () => void;
  hasTransactions: boolean;
}

export const ModelTierControls: React.FC<ModelTierControlsProps> = ({
  useTier1,
  onToggleTier1,
  tier1Threshold,
  onChangeThreshold,
  tier2Ready,
  isProcessing,
  onReclassify,
  hasTransactions,
}) => {
  return (
    <div className="tier-controls-card">
      <div className="tier-controls-inner">
        {/* Toggle Switch */}
        <div className="tier-toggle-section">
          <div className="tier-toggle-header">
            <span className="control-section-label">Classification Engine Configuration</span>
          </div>

          <div className="toggle-interactive-row">
            <button
              type="button"
              className={`toggle-action-btn ${useTier1 ? 'toggle-active' : 'toggle-inactive'}`}
              onClick={() => onToggleTier1(!useTier1)}
              disabled={isProcessing}
            >
              {useTier1 ? (
                <ToggleRight size={28} className="toggle-icon text-primary" />
              ) : (
                <ToggleLeft size={28} className="toggle-icon text-muted" />
              )}
              <div className="toggle-labels">
                <span className="toggle-title">
                  {useTier1 ? 'Hybrid Cascade (Tier 1 + Fallback Tier 2)' : 'Tier 2 Only (Baseline Embeddings)'}
                </span>
                <span className="toggle-description">
                  {useTier1
                    ? `Primary Tier 1 (~0.2 ms). If confidence < ${(tier1Threshold * 100).toFixed(0)}%, Tier 2 steps in.`
                    : 'Tier 1 disabled. All transactions are classified with multilingual-e5-small.'}
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* Threshold Slider (only active when Tier 1 is enabled) */}
        {useTier1 && (
          <div className="tier-threshold-section">
            <div className="threshold-header">
              <span className="threshold-title">
                <Sliders size={14} className="text-muted" />
                Minimum Tier 1 Confidence Threshold:
              </span>
              <span className="threshold-value font-mono">
                {(tier1Threshold * 100).toFixed(0)}%
              </span>
            </div>

            <div className="threshold-slider-wrap">
              <span className="slider-min font-mono">50%</span>
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
              <span className="slider-max font-mono">95%</span>
            </div>

            <div className="threshold-caption">
              Below {(tier1Threshold * 100).toFixed(0)}%, Tier 2 semantic verification triggers via cosine distance.
            </div>
          </div>
        )}

        {/* Re-eval Button */}
        {hasTransactions && (
          <div className="reclassify-action-section">
            <button
              type="button"
              className="btn-reclassify"
              onClick={onReclassify}
              disabled={isProcessing || (!useTier1 && !tier2Ready)}
              title="Re-run classification with current settings"
            >
              <RefreshCw size={15} className={isProcessing ? 'spinner' : ''} />
              <span>Re-run</span>
            </button>
          </div>
        )}
      </div>

      {/* Architecture Visual Badges */}
      <div className="tier-pills-status-bar">
        <div className={`status-pill ${useTier1 ? 'status-pill-active-blue' : 'status-pill-inactive'}`}>
          <Cpu size={14} />
          <span>Tier 1: Global Base Model (7k n-grams)</span>
          <span className="status-badge-state">{useTier1 ? 'Active' : 'Bypassed'}</span>
        </div>

        <div className={`status-pill ${tier2Ready ? 'status-pill-active-purple' : 'status-pill-loading'}`}>
          <Brain size={14} />
          <span>Tier 2: Xenova/multilingual-e5-small</span>
          <span className="status-badge-state">
            {tier2Ready ? (useTier1 ? `Fallback (<${(tier1Threshold * 100).toFixed(0)}%)` : 'Sole Baseline') : 'Loading...'}
          </span>
        </div>
      </div>
    </div>
  );
};
