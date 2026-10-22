import React from 'react';
import { UploadCloud, Search, TableProperties, Settings, ChevronRight } from 'lucide-react';

interface ActionGridProps {
  onOpenUpload: () => void;
  onOpenDistribution: () => void;
  onOpenTransactions: () => void;
  onOpenSettings: () => void;
  totalTransactions: number;
  useTier1: boolean;
  tier2Ready: boolean;
}

export const ActionGrid: React.FC<ActionGridProps> = ({
  onOpenUpload,
  onOpenDistribution,
  onOpenTransactions,
  onOpenSettings,
  totalTransactions,
  useTier1,
  tier2Ready,
}) => {
  return (
    <section className="action-grid-section">
      <div className="section-title-wrap">
        <h3 className="section-title">Quick Actions</h3>
      </div>

      <div className="action-grid-container">
        {/* 1. Upload */}
        <button
          type="button"
          className="action-card action-upload"
          onClick={onOpenUpload}
        >
          <div className="action-card-top">
            <div className="action-icon-wrap icon-upload">
              <UploadCloud size={22} />
            </div>
            <ChevronRight size={16} className="action-arrow" />
          </div>
          <div className="action-card-text">
            <h4 className="action-title">Upload File</h4>
          </div>
        </button>

        {/* 2. Visualizza Distribuzione Spese (Lens Icon) */}
        <button
          type="button"
          className="action-card action-distribution"
          onClick={onOpenDistribution}
        >
          <div className="action-card-top">
            <div className="action-icon-wrap icon-lens">
              <Search size={22} />
            </div>
            <ChevronRight size={16} className="action-arrow" />
          </div>
          <div className="action-card-text">
            <h4 className="action-title">Distribution</h4>
          </div>
        </button>

        {/* 3. Visualizza Movimenti (Table Icon) */}
        <button
          type="button"
          className="action-card action-transactions"
          onClick={onOpenTransactions}
        >
          <div className="action-card-top">
            <div className="action-icon-wrap icon-table">
              <TableProperties size={22} />
            </div>
            {totalTransactions > 0 && (
              <span className="action-counter-badge font-mono">{totalTransactions}</span>
            )}
            <ChevronRight size={16} className="action-arrow" />
          </div>
          <div className="action-card-text">
            <h4 className="action-title">Transactions</h4>
          </div>
        </button>

        {/* 4. Settings */}
        <button
          type="button"
          className="action-card action-settings"
          onClick={onOpenSettings}
        >
          <div className="action-card-top">
            <div className="action-icon-wrap icon-settings">
              <Settings size={22} />
            </div>
            <div className="engine-status-micro-dot" title="Engines status">
              <span className={`micro-dot ${useTier1 ? 'dot-blue' : 'dot-off'}`} />
              <span className={`micro-dot ${tier2Ready ? 'dot-purple' : 'dot-amber'}`} />
            </div>
            <ChevronRight size={16} className="action-arrow" />
          </div>
          <div className="action-card-text">
            <h4 className="action-title">Settings</h4>
          </div>
        </button>
      </div>
    </section>
  );
};
