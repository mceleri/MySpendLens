import React from 'react';
import {
  ShieldCheck,
  Loader2,
  AlertCircle,
  Home,
  Brain,
  PieChart,
  TableProperties,
  Tags,
  UploadCloud,
  FolderArchive,
  Settings,
  Activity,
} from 'lucide-react';
import { Tier2LoadingState } from '../types';

export type HeaderView =
  | 'home'
  | 'charts'
  | 'distribution'
  | 'transactions'
  | 'categories'
  | 'upload'
  | 'export_import'
  | 'settings';

interface HeaderProps {
  isLoadingModel: boolean;
  modelError: string | null;
  tier2LoadingState: Tier2LoadingState;
  isProcessing?: boolean;
  onGoHome: () => void;
  hasPendingTraining?: boolean;
  onOpenTrainingModal?: () => void;
  activeView?: HeaderView;
  onNavigate?: (view: HeaderView) => void;
}

export const Header: React.FC<HeaderProps> = ({
  isLoadingModel,
  modelError,
  tier2LoadingState,
  isProcessing = false,
  onGoHome,
  hasPendingTraining = false,
  onOpenTrainingModal,
  activeView = 'home',
  onNavigate,
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

          <div
            className="mobile-brand-text clickable-brand"
            onClick={onGoHome}
            role="button"
            tabIndex={0}
            title="Go to Home"
          >
            <span className="mobile-brand-title">MySpendLens</span>
            <div className="mobile-brand-badge-wrap">
              <span className="micro-badge-privacy">
                <ShieldCheck size={11} className="text-emerald" />
                100% Local & Private
              </span>
            </div>
          </div>
        </div>

        {/* Center: Desktop Navigation Bar (Visible on laptop/desktop screens) */}
        {onNavigate && (
          <nav className="desktop-header-nav" aria-label="Main Navigation">
            <button
              type="button"
              className={`desktop-nav-link ${activeView === 'home' ? 'active' : ''}`}
              onClick={onGoHome}
            >
              <Home size={15} />
              <span>Dashboard</span>
            </button>

            <button
              type="button"
              className={`desktop-nav-link ${activeView === 'charts' ? 'active' : ''}`}
              onClick={() => onNavigate('charts')}
            >
              <PieChart size={15} />
              <span>Charts</span>
            </button>

            <button
              type="button"
              className={`desktop-nav-link ${activeView === 'distribution' ? 'active' : ''}`}
              onClick={() => onNavigate('distribution')}
            >
              <Activity size={15} />
              <span>Distribution</span>
            </button>

            <button
              type="button"
              className={`desktop-nav-link ${activeView === 'transactions' ? 'active' : ''}`}
              onClick={() => onNavigate('transactions')}
            >
              <TableProperties size={15} />
              <span>Transactions</span>
            </button>

            <button
              type="button"
              className={`desktop-nav-link ${activeView === 'categories' ? 'active' : ''}`}
              onClick={() => onNavigate('categories')}
            >
              <Tags size={15} />
              <span>Categories</span>
            </button>

            <button
              type="button"
              className={`desktop-nav-link ${activeView === 'upload' ? 'active' : ''}`}
              onClick={() => onNavigate('upload')}
            >
              <UploadCloud size={15} />
              <span>Upload</span>
            </button>

            <button
              type="button"
              className={`desktop-nav-link ${activeView === 'export_import' ? 'active' : ''}`}
              onClick={() => onNavigate('export_import')}
            >
              <FolderArchive size={15} />
              <span>Backup</span>
            </button>

            <button
              type="button"
              className={`desktop-nav-link ${activeView === 'settings' ? 'active' : ''}`}
              onClick={() => onNavigate('settings')}
            >
              <Settings size={15} />
              <span>Settings</span>
            </button>
          </nav>
        )}

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

          {/* Tier 1 Personal Training Icon / Button */}
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
              <span className="btn-header-brain-text">Train AI</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
