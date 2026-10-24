import React from 'react';
import { Calendar, ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react';
import { FinancialOverviewData, formatCurrency } from '../utils/financialCalculations';

interface HomeHeroOverviewProps {
  overview: FinancialOverviewData;
  onOpenDistribution: () => void;
}

export const HomeHeroOverview: React.FC<HomeHeroOverviewProps> = ({
  overview,
  onOpenDistribution,
}) => {
  return (
    <section className="hero-overview-card">
      {/* 1. Latest Movement Date */}
      <div className="hero-date-row">
        <div className="hero-date-badge">
          <Calendar size={13} className="text-primary" />
          <span className="hero-date-label">Latest transaction:</span>
          <span className="hero-date-val">{overview.latestMovementDateStr}</span>
        </div>
        <span className="window-pill">Last {overview.windowDays} days</span>
      </div>

      {/* 2. IN and OUT of the last 60 days */}
      <div className="in-out-hero-grid">
        <div className="in-out-box in-box">
          <div className="in-out-header">
            <div className="in-out-icon-circle in-circle">
              <ArrowDownRight size={14} className="text-emerald" />
            </div>
            <span className="in-out-label">Income</span>
          </div>
          <div className="in-out-amount font-mono text-emerald">
            {formatCurrency(overview.totalIn)}
          </div>
        </div>

        <div className="in-out-box out-box">
          <div className="in-out-header">
            <div className="in-out-icon-circle out-circle">
              <ArrowUpRight size={14} className="text-rose" />
            </div>
            <span className="in-out-label">Expenses</span>
          </div>
          <div className="in-out-amount font-mono text-rose">
            {formatCurrency(overview.totalOut)}
          </div>
        </div>
      </div>

      {/* 3. Multi-colored segmented bar under OUT figure */}
      <div className="out-bar-section">
        <div className="out-bar-header">
          <span className="out-bar-title">Expense Breakdown by Category</span>
          <button
            type="button"
            className="out-bar-link"
            onClick={onOpenDistribution}
            title="View expense distribution details"
          >
            <span>Details</span>
            <ChevronRight size={13} />
          </button>
        </div>

        {/* The single continuous segmented bar without internal rounded corners */}
        <div
          className="segmented-bar-track"
          onClick={onOpenDistribution}
          role="button"
          tabIndex={0}
          title="Tap to view category breakdown details"
        >
          {overview.spendSegments.map((segment) => (
            <div
              key={segment.category}
              className="segmented-bar-item"
              style={{
                width: `${Math.max(2, segment.percentage)}%`,
                backgroundColor: segment.color,
              }}
              title={`${segment.label}: ${formatCurrency(segment.amount)} (${segment.percentage.toFixed(1)}%)`}
            />
          ))}
        </div>

        {/* Desktop category preview chips (hidden on mobile, visible on laptop/desktop) */}
        {overview.spendSegments.length > 0 && (
          <div className="hero-desktop-legend">
            {overview.spendSegments.slice(0, 6).map((segment) => (
              <div
                key={segment.category}
                className="hero-desktop-legend-item"
                onClick={onOpenDistribution}
                title={`${segment.label}: ${formatCurrency(segment.amount)} (${segment.percentage.toFixed(1)}%)`}
              >
                <span
                  className="hero-legend-dot"
                  style={{ backgroundColor: segment.color }}
                />
                <span className="hero-legend-name">{segment.label}</span>
                <span className="hero-legend-pct font-mono">
                  {segment.percentage.toFixed(0)}%
                </span>
              </div>
            ))}
            {overview.spendSegments.length > 6 && (
              <span className="hero-legend-more" onClick={onOpenDistribution}>
                +{overview.spendSegments.length - 6} more
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
};
