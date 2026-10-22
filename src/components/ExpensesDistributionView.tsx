import React from 'react';
import { PieChart, HelpCircle } from 'lucide-react';
import { FinancialOverviewData, formatCurrency } from '../utils/financialCalculations';
import { ProcessedTransaction } from '../types';
import { getCategoryMeta } from '../utils/categories';

interface ExpensesDistributionViewProps {
  overview: FinancialOverviewData;
  transactions: ProcessedTransaction[];
  onBack?: () => void;
  onFilterByCategory: (category: string) => void;
}

export const ExpensesDistributionView: React.FC<ExpensesDistributionViewProps> = ({
  overview,
  transactions,
  onFilterByCategory,
}) => {
  // Count transactions per category
  const txCounts: Record<string, number> = {};
  for (const tx of transactions) {
    txCounts[tx.category] = (txCounts[tx.category] || 0) + 1;
  }

  const topCategory = overview.spendSegments[0];

  return (
    <div className="view-container">
      {/* Hero Breakdown Card */}
      <div className="dist-hero-card">
        <div className="dist-hero-top">
          <div>
            <span className="dist-label">Total Spending (Last {overview.windowDays} days)</span>
            <div className="dist-huge-amount font-mono text-rose">
              {formatCurrency(overview.totalOut)}
            </div>
          </div>
          <div className="dist-icon-pill">
            <PieChart size={20} className="text-purple" />
          </div>
        </div>

        {/* Segmented bar */}
        <div className="segmented-bar-track mt-3">
          {overview.spendSegments.map((segment) => (
            <div
              key={segment.category}
              className="segmented-bar-item"
              style={{
                width: `${Math.max(2, segment.percentage)}%`,
                backgroundColor: segment.color,
              }}
              title={`${segment.label}: ${formatCurrency(segment.amount)}`}
            />
          ))}
        </div>

        {topCategory && (
          <div className="dist-top-insight">
            <span>Top spending category:</span>
            <strong style={{ color: topCategory.color }}>
              {topCategory.label} ({topCategory.percentage.toFixed(0)}% of total expenses)
            </strong>
          </div>
        )}
      </div>

      {/* Category List */}
      <div className="dist-category-list-section">
        <div className="dist-list-header">
          <span className="dist-section-title">Breakdown by Expense Category</span>
          <span className="dist-section-sub">Tap to filter transactions</span>
        </div>

        <div className="dist-cards-list">
          {overview.spendSegments.length === 0 ? (
            <div className="table-empty-cell p-4 text-center">
              <p className="font-semibold text-main">No categorized expenses found.</p>
              <p className="text-dim text-xs mt-1">Upload a bank statement to view your expense distribution.</p>
            </div>
          ) : (
            overview.spendSegments.map((segment) => {
              const catMeta = getCategoryMeta(segment.category);
              const IconComp = catMeta.icon || HelpCircle;
              const count = txCounts[segment.category] || 0;

            return (
              <div
                key={segment.category}
                className="dist-class-card"
                onClick={() => onFilterByCategory(segment.category)}
              >
                <div className="dist-class-top">
                  <div className="dist-class-identity">
                    <div
                      className="dist-class-icon-circle"
                      style={{
                        backgroundColor: `${segment.color}1a`,
                        borderColor: `${segment.color}40`,
                        color: segment.color,
                      }}
                    >
                      <IconComp size={16} />
                    </div>
                    <div>
                      <h4 className="dist-class-title">{segment.label}</h4>
                      <span className="dist-class-sub">
                        {count} {count === 1 ? 'transaction' : 'transactions'}
                      </span>
                    </div>
                  </div>

                  <div className="dist-class-numbers text-right">
                    <div className="dist-class-amount font-mono font-bold">
                      {formatCurrency(segment.amount)}
                    </div>
                    <span
                      className="dist-class-pct font-mono font-semibold"
                      style={{ color: segment.color }}
                    >
                      {segment.percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="dist-class-meter">
                  <div
                    className="dist-class-meter-fill"
                    style={{
                      width: `${Math.max(2, segment.percentage)}%`,
                      backgroundColor: segment.color,
                    }}
                  />
                </div>
              </div>
            );
          }))}
        </div>
      </div>
    </div>
  );
};
