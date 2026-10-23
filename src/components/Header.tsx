import React from 'react';
import { ShieldCheck, Loader2, AlertCircle, Home, Brain } from 'lucide-react';
import { Tier2LoadingState } from '../types';

interface HeaderProps {
  isLoadingModel: boolean;
  modelError: string | null;
  tier2LoadingState: Tier2LoadingState;
  isProcessing?: boolean;
  onGoHome: () => void;
  hasPendingTraining?: boolean;
  onOpenTrainingModal?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isLoadingModel,
  modelError,
  tier2LoadingState,
  isProcessing = false,
  onGoHome,
  hasPendingTraining = false,
  onOpenTrainingModal,
}) => {
  return (
    <header className="mobile-app-header">
      <div className="mobile-header-inner">
        {/* Left: Home Icon + Name + Tagline */}
        <div className="mobile-header-brand-group">
          <button
            type="button"
            className="btn-header-home"
            onClick={onGoHome}
            aria-label="Home"
            title="Home"
          >
            <Home size={19} />
          </button>

          <div className="mobile-brand-text">
            <span className="mobile-brand-title">MySpendLens</span>
            <div className="mobile-brand-badge-wrap">
              <span className="micro-badge-privacy">
                <ShieldCheck size={11} className="text-emerald" />
                100% Local & Private
              </span>
            </div>
          </div>
        </div>

        {/* Right: Status indicators */}
        <div className="mobile-header-actions">
          {isLoadingModel && (
            <div className="mobile-status-pill text-muted">
              <Loader2 size={13} className="spinner" />
              <span>Tier 1...</span>
            </div>
          )}

          {tier2LoadingState.status === 'downloading' && (
            <div className="mobile-status-pill text-purple">
              <Loader2 size={13} className="spinner text-purple" />
              <span>Tier 2 ({Math.round(tier2LoadingState.progress)}%)</span>
            </div>
          )}

          {isProcessing && !isLoadingModel && tier2LoadingState.status !== 'downloading' && (
            <div className="mobile-status-pill text-muted">
              <Loader2 size={13} className="spinner" />
              <span>Classifying...</span>
            </div>
          )}

          {modelError && (
            <div className="mobile-status-pill text-danger">
              <AlertCircle size={13} />
              <span>Error</span>
            </div>
          )}

          {/* Tier 1 Personal Training Icon */}
          {onOpenTrainingModal && (
            <button
              type="button"
              className={`btn-header-brain ${hasPendingTraining ? 'has-pending' : ''}`}
              onClick={onOpenTrainingModal}
              title={
                hasPendingTraining
                  ? 'New data or category changes ready for local training'
                  : 'Local Tier 1 model'
              }
              aria-label="Tier 1 Training"
            >
              <div className="brain-icon-wrap">
                <Brain
                  size={19}
                  className={hasPendingTraining ? 'text-cyan' : 'text-dim'}
                />
                {hasPendingTraining && (
                  <span className="brain-badge-exclamation" title="Model update available">
                    !
                  </span>
                )}
              </div>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
