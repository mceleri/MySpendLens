import React from 'react';
import { Layers, Gauge, PieChart, Cpu, Brain } from 'lucide-react';
import { BatchProcessingSummary } from '../types';
import { getCategoryMeta } from '../utils/categories';

interface StatsCardsProps {
  summary: BatchProcessingSummary;
}

export const StatsCards: React.FC<StatsCardsProps> = ({ summary }) => {
  let topCategory = '—';
  let topCount = 0;
  for (const [cat, count] of Object.entries(summary.categoryCounts)) {
    if (count > topCount) {
      topCount = count;
      topCategory = cat;
    }
  }

  const topCategoryMeta = getCategoryMeta(topCategory);
  const total = summary.totalProcessed || 1;
  const tier1Pct = ((summary.tier1Count / total) * 100).toFixed(0);
  const tier2Pct = ((summary.tier2Count / total) * 100).toFixed(0);

  return (
    <div className="stats-grid">
      <div className="stat-card">
        <div className="stat-card-header">
          <span className="stat-label">Processed Transactions</span>
          <div className="stat-icon-wrap bg-blue-subtle">
            <Layers size={18} className="text-blue" />
          </div>
        </div>
        <div className="stat-value">{summary.totalProcessed}</div>
        <div className="stat-footnote">
          Total time: {summary.totalTimeMs.toFixed(1)} ms
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-card-header">
          <span className="stat-label">Tier Breakdown</span>
          <div className="stat-icon-wrap bg-purple-subtle">
            <Brain size={18} className="text-purple" />
          </div>
        </div>
        <div className="stat-split-row">
          <div className="split-item text-blue font-mono">
            <Cpu size={14} />
            <span>T1: {summary.tier1Count} ({tier1Pct}%)</span>
          </div>
          <div className="split-item text-purple font-mono">
            <Brain size={14} />
            <span>T2: {summary.tier2Count} ({tier2Pct}%)</span>
          </div>
        </div>
        <div className="stat-footnote">
          {summary.tier1Count > 0 ? `${tier1Pct}% resolved in ~0.2ms without GPU` : 'Processed with E5 embeddings'}
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-card-header">
          <span className="stat-label">Average Confidence</span>
          <div className="stat-icon-wrap bg-emerald-subtle">
            <Gauge size={18} className="text-emerald" />
          </div>
        </div>
        <div className="stat-value">
          {(summary.avgConfidence * 100).toFixed(1)}%
        </div>
        <div className="stat-footnote text-emerald">
          Calibrated via multinomial Softmax
        </div>
      </div>

      <div className="stat-card">
        <div className="stat-card-header">
          <span className="stat-label">Top Category</span>
          <div className="stat-icon-wrap" style={{ background: topCategoryMeta.bgLight }}>
            <PieChart size={18} style={{ color: topCategoryMeta.color }} />
          </div>
        </div>
        <div className="stat-value stat-value-category" style={{ color: topCategoryMeta.color }}>
          {topCategory}
        </div>
        <div className="stat-footnote">
          {topCount} transactions ({((topCount / total) * 100).toFixed(0)}%)
        </div>
      </div>
    </div>
  );
};
