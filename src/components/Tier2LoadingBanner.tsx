import React from 'react';
import { DownloadCloud, CheckCircle2, HardDrive, Sparkles, AlertCircle } from 'lucide-react';
import { Tier2LoadingState } from '../types';

interface Tier2LoadingBannerProps {
  loadingState: Tier2LoadingState;
}

export const Tier2LoadingBanner: React.FC<Tier2LoadingBannerProps> = ({ loadingState }) => {
  if (loadingState.status === 'idle') return null;

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const isDownloading = loadingState.status === 'downloading';
  const isReady = loadingState.status === 'ready';
  const isError = loadingState.status === 'error';

  return (
    <div className={`tier2-banner-card ${isReady ? 'banner-ready' : isError ? 'banner-error' : 'banner-loading'}`}>
      <div className="tier2-banner-top">
        <div className="tier2-banner-title-group">
          {isDownloading && (
            <div className="icon-pulse-wrap">
              <DownloadCloud size={20} className="text-purple spinner-slow" />
            </div>
          )}
          {isReady && <CheckCircle2 size={20} className="text-emerald" />}
          {isError && <AlertCircle size={20} className="text-danger" />}

          <div>
            <div className="banner-heading-row">
              <h4 className="banner-title">
                {isDownloading && 'Downloading Tier 2 Model (multilingual-e5-small)...'}
                {isReady && 'Tier 2 Model Active & Stored in Local Cache'}
                {isError && 'Tier 2 Initialization Error'}
              </h4>
              <span className="badge-pill badge-purple">Transformers.js</span>
            </div>

            <p className="banner-subtitle">
              {isDownloading && (
                <>
                  Downloading from Hugging Face ({loadingState.file || 'ONNX asset'}). Automatically saved to browser local cache for instant future loads.
                </>
              )}
              {isReady && (
                <>
                  <HardDrive size={13} className="inline-icon text-muted" /> Quantized ONNX model (~110 MB) stored in local cache. Subsequent launches will be instant and work offline.
                </>
              )}
              {isError && loadingState.message}
            </p>
          </div>
        </div>

        {isDownloading && (
          <div className="progress-metric-wrap font-mono">
            <span className="progress-pct-huge">{Math.round(loadingState.progress)}%</span>
            {loadingState.totalBytes && (
              <span className="progress-bytes-label">
                {formatBytes(loadingState.loadedBytes)} / {formatBytes(loadingState.totalBytes)}
              </span>
            )}
          </div>
        )}

        {isReady && (
          <div className="ready-badge-chip">
            <Sparkles size={14} className="text-purple" />
            <span>Cosine Distance 384-dim</span>
          </div>
        )}
      </div>

      {isDownloading && (
        <div className="tier2-progress-track">
          <div
            className="tier2-progress-bar"
            style={{ width: `${Math.max(4, Math.min(100, loadingState.progress))}%` }}
          />
        </div>
      )}
    </div>
  );
};
