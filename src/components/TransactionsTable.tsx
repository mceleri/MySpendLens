import React, { useState, useMemo } from 'react';
import {
  Search,
  Download,
  ChevronDown,
  ChevronUp,
  Info,
  Cpu,
  Brain,
  Tag,
  Trash2,
  X,
  Check,
  ArrowDownLeft,
  Zap,
} from 'lucide-react';
import { ProcessedTransaction } from '../types';
import {
  CATEGORIES_META,
  ALL_CATEGORIES,
  CategoryDefinition,
  getCategoryMeta,
  getConfidenceBadgeClass,
} from '../utils/categories';
import { parseTransactionDate } from '../utils/financialCalculations';

interface TransactionsTableProps {
  transactions: ProcessedTransaction[];
  categories?: CategoryDefinition[];
  fileName: string | null;
  initialCategory?: string;
  onDeleteTransaction: (id: string) => Promise<void>;
  onUpdateTransactionCategory: (id: string, newCategory: string) => Promise<void>;
}

type SortField = 'date' | 'confidence' | 'category' | 'description' | 'tier';
type SortOrder = 'asc' | 'desc';

function getSystemCategory(tx: ProcessedTransaction): string {
  if (tx.systemCategory) return tx.systemCategory;
  if (tx.tier2Result?.category) return tx.tier2Result.category;
  if (tx.tier1Result?.category) return tx.tier1Result.category;
  if (tx.sourceTier === 'Income') return 'Income';
  return tx.category;
}

export const TransactionsTable: React.FC<TransactionsTableProps> = ({
  transactions,
  categories,
  fileName,
  initialCategory,
  onDeleteTransaction,
  onUpdateTransactionCategory,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory || 'ALL');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // Manual classification & delete state
  const [editingTx, setEditingTx] = useState<ProcessedTransaction | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (tx: ProcessedTransaction) => {
    const desc = tx.rawDescription ? `"${tx.rawDescription}"` : 'this transaction';
    const amt = tx.amount ? ` (${tx.amount})` : '';
    if (window.confirm(`Delete ${desc}${amt}? This cannot be undone.`)) {
      setDeletingId(tx.id);
      try {
        await onDeleteTransaction(tx.id);
      } finally {
        setDeletingId(null);
      }
    }
  };

  // Filter & Sort
  const filteredAndSorted = useMemo(() => {
    let result = transactions.filter((tx) => {
      const matchesSearch =
        searchTerm === '' ||
        tx.rawDescription.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tx.category.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (tx.date && tx.date.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesCat =
        selectedCategory === 'ALL' || tx.category === selectedCategory;

      return matchesSearch && matchesCat;
    });

    result = [...result].sort((a, b) => {
      let comparison = 0;
      if (sortField === 'date') {
        const timeA = a.date ? (parseTransactionDate(a.date)?.getTime() ?? 0) : 0;
        const timeB = b.date ? (parseTransactionDate(b.date)?.getTime() ?? 0) : 0;
        if (timeA !== timeB) {
          comparison = timeA - timeB;
        } else {
          // Tie-break for same date: keep CSV order (most recent first in typical bank statement)
          return sortOrder === 'desc'
            ? a.originalIndex - b.originalIndex
            : b.originalIndex - a.originalIndex;
        }
      } else if (sortField === 'confidence') {
        comparison = a.confidence - b.confidence;
      } else if (sortField === 'category') {
        comparison = a.category.localeCompare(b.category);
      } else if (sortField === 'description') {
        comparison = a.rawDescription.localeCompare(b.rawDescription);
      } else if (sortField === 'tier') {
        comparison = a.sourceTier.localeCompare(b.sourceTier);
      }

      if (comparison === 0) {
        return sortOrder === 'asc'
          ? a.originalIndex - b.originalIndex
          : b.originalIndex - a.originalIndex;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [transactions, searchTerm, selectedCategory, sortField, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'date' || field === 'confidence' ? 'desc' : 'asc');
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedRowId((prev) => (prev === id ? null : id));
  };

  const exportClassifiedCsv = () => {
    const headers = [
      'Date',
      'Original_Description',
      'Amount',
      'Assigned_Category',
      'Confidence',
      'Tier_Engine',
      'Latency_ms',
    ];
    const rows = filteredAndSorted.map((tx) => [
      `"${tx.date || ''}"`,
      `"${tx.rawDescription.replace(/"/g, '""')}"`,
      `"${tx.amount || ''}"`,
      `"${tx.category}"`,
      (tx.confidence * 100).toFixed(2) + '%',
      `"${tx.sourceTier}"`,
      tx.inferenceTimeMs.toFixed(3),
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `myspendlens_categorized_${fileName ? fileName.replace(/\.[^/.]+$/, '') : 'export'}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Category counts for filter tabs
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: transactions.length };
    for (const tx of transactions) {
      counts[tx.category] = (counts[tx.category] || 0) + 1;
    }
    return counts;
  }, [transactions]);

  // Categories sorted by usage (most used to least used)
  const sortedCategories = useMemo(() => {
    const knownKeys =
      categories && categories.length > 0
        ? categories.filter((c) => c.isActive).map((c) => c.name)
        : Object.keys(CATEGORIES_META);

    const allKeys = Array.from(
      new Set([
        ...knownKeys,
        ...Object.keys(categoryCounts).filter((k) => k !== 'ALL'),
      ])
    );

    return allKeys.sort((a, b) => {
      const countA = categoryCounts[a] || 0;
      const countB = categoryCounts[b] || 0;
      if (countB !== countA) {
        return countB - countA;
      }
      return a.localeCompare(b);
    });
  }, [categoryCounts, categories]);

  // Active categories available for manual classification
  const activeCategoryKeys = useMemo(() => {
    if (categories && categories.length > 0) {
      return categories.filter((c) => c.isActive).map((c) => c.name);
    }
    return ALL_CATEGORIES as readonly string[];
  }, [categories]);

  const hasDates = transactions.some((tx) => !!tx.date);
  const hasAmounts = transactions.some((tx) => !!tx.amount);

  return (
    <div className="view-container">
      <div className="table-card">
        <div className="table-header-controls">
          <div className="search-box-wrap">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              className="search-input"
              placeholder="Search description, date or category..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button
                type="button"
                className="clear-search-btn"
                onClick={() => setSearchTerm('')}
              >
                ✕
              </button>
            )}
          </div>

          <button
            type="button"
            className="btn-export"
            onClick={exportClassifiedCsv}
            title="Export CSV with categories, confidences and tiers"
          >
            <Download size={15} />
            <span>Export CSV</span>
          </button>
        </div>

        {/* Category Filter Pills */}
        <div className="category-filter-bar">
          <button
            type="button"
            className={`cat-pill ${selectedCategory === 'ALL' ? 'cat-pill-active' : ''}`}
            onClick={() => setSelectedCategory('ALL')}
          >
            All ({categoryCounts.ALL || 0})
          </button>

          {sortedCategories.map((catKey) => {
            const meta = getCategoryMeta(catKey);
            const count = categoryCounts[catKey] || 0;
            const Icon = meta.icon;
            const isActive = selectedCategory === catKey;

            return (
              <button
                key={catKey}
                type="button"
                className={`cat-pill ${isActive ? 'cat-pill-active' : ''}`}
                style={{
                  borderColor: isActive ? meta.color : undefined,
                  color: isActive ? meta.color : undefined,
                  background: isActive ? meta.bgLight : undefined,
                }}
                onClick={() => setSelectedCategory(catKey)}
              >
                <Icon size={12} />
                <span>{meta.label}</span>
                <span className="pill-count">{count}</span>
              </button>
            );
          })}
        </div>

        {/* Table */}
        <div className="table-responsive">
          <table className="transactions-table">
            <thead>
              <tr>
                {hasDates && (
                  <th
                    className="th-sortable col-date"
                    onClick={() => handleSort('date')}
                  >
                    <div className="th-content">
                      <span>Date</span>
                      {sortField === 'date' && (
                        sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                      )}
                    </div>
                  </th>
                )}

                <th
                  className="th-sortable col-desc"
                  onClick={() => handleSort('description')}
                >
                  <div className="th-content">
                    <span>Description</span>
                    {sortField === 'description' && (
                      sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>

                {hasAmounts && (
                  <th className="col-amount text-right">
                    <div className="th-content justify-end">
                      <span>Amount</span>
                    </div>
                  </th>
                )}

                <th
                  className="th-sortable col-category"
                  onClick={() => handleSort('category')}
                >
                  <div className="th-content">
                    <span>Category</span>
                    {sortField === 'category' && (
                      sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>

                <th
                  className="th-sortable col-tier"
                  onClick={() => handleSort('tier')}
                >
                  <div className="th-content">
                    <span>Engine</span>
                    {sortField === 'tier' && (
                      sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>

                <th
                  className="th-sortable col-confidence"
                  onClick={() => handleSort('confidence')}
                >
                  <div className="th-content">
                    <span>Confidence</span>
                    {sortField === 'confidence' && (
                      sortOrder === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                    )}
                  </div>
                </th>

                <th className="col-actions text-center">
                  <span>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={5 + (hasDates ? 1 : 0) + (hasAmounts ? 1 : 0)}
                    className="table-empty-cell"
                  >
                    {transactions.length === 0
                      ? 'No transactions loaded yet. Upload a bank statement to get started.'
                      : 'No transactions found matching the selected search criteria.'}
                  </td>
                </tr>
              ) : (
                filteredAndSorted.map((tx) => {
                  const catMeta = getCategoryMeta(tx.category);
                  const confMeta = getConfidenceBadgeClass(tx.confidence);
                  const IconComponent = catMeta.icon;
                  const isExpanded = expandedRowId === tx.id;
                  const confPercent = (tx.confidence * 100).toFixed(1);
                  const isTier1 = tx.sourceTier === 'Tier 1';

                  return (
                    <React.Fragment key={tx.id}>
                      <tr
                        className={`tx-row ${isExpanded ? 'tx-row-expanded' : ''}`}
                        onClick={() => toggleExpand(tx.id)}
                      >
                        {hasDates && (
                          <td className="col-date font-mono text-muted">
                            {tx.date || '—'}
                          </td>
                        )}

                        <td className="col-desc">
                          <div className="tx-description-cell">
                            <span className="tx-desc-text">{tx.rawDescription}</span>
                          </div>
                        </td>

                        {hasAmounts && (
                          <td className="col-amount font-mono text-right font-medium">
                            {tx.amount ? (
                              <span
                                className={
                                  tx.amount.startsWith('-')
                                    ? 'amount-negative'
                                    : 'amount-positive'
                                }
                              >
                                {tx.amount}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        )}

                        <td className="col-category">
                          <div
                            className="category-badge-chip"
                            style={{
                              backgroundColor: catMeta.bgLight,
                              borderColor: catMeta.borderLight,
                              color: catMeta.color,
                            }}
                          >
                            <IconComponent size={14} />
                            <span className="cat-name-main">{catMeta.name}</span>
                          </div>
                        </td>

                        <td className="col-tier">
                          {tx.sourceTier === 'Income' ? (
                            <span className="tier-badge-chip tier-badge-income" title="Positive movement (Income) - ML classification skipped">
                              <ArrowDownLeft size={12} />
                              <span>Income</span>
                            </span>
                          ) : tx.sourceTier === 'Tier 0' ? (
                            <span className="tier-badge-chip tier-badge-t0" title="Classified with Tier 0 Exact Memory (0 ms, 100% confidence)">
                              <Zap size={12} />
                              <span>Tier 0</span>
                            </span>
                          ) : tx.sourceTier === 'Manual' ? (
                            <span className="tier-badge-chip tier-badge-manual" title="Manually classified">
                              <Tag size={12} />
                              <span>Manual</span>
                            </span>
                          ) : isTier1 ? (
                            <span className="tier-badge-chip tier-badge-t1" title="Classified with Tier 1 Base Model (~0.2 ms)">
                              <Cpu size={12} />
                              <span>Tier 1</span>
                            </span>
                          ) : (
                            <span
                              className="tier-badge-chip tier-badge-t2"
                              title={
                                tx.sourceTier === 'Tier 2 (Fallback)'
                                  ? 'Tier 2 Fallback: Tier 1 confidence < 85%, verified with multilingual-e5-small'
                                  : 'Classified exclusively with Tier 2 multilingual-e5-small'
                              }
                            >
                              <Brain size={12} />
                              <span>{tx.sourceTier === 'Tier 2 (Fallback)' ? 'T2 (Fallback)' : 'Tier 2'}</span>
                            </span>
                          )}
                        </td>

                        <td className="col-confidence">
                          <div className="confidence-cell-wrap">
                            <div className="confidence-bar-bg">
                              <div
                                className="confidence-bar-fill"
                                style={{
                                  width: `${tx.confidence * 100}%`,
                                  backgroundColor: confMeta.color,
                                }}
                              />
                            </div>
                            <div className="confidence-meta">
                              <span
                                className="confidence-pct font-mono font-semibold"
                                style={{ color: confMeta.color }}
                              >
                                {confPercent}%
                              </span>
                              <span
                                className="confidence-level-tag"
                                style={{
                                  color: confMeta.color,
                                  backgroundColor: confMeta.bg,
                                  borderColor: confMeta.border,
                                }}
                              >
                                {confMeta.label}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="col-actions text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="table-actions-cluster">
                            <button
                              type="button"
                              className="btn-tx-action btn-tx-tag"
                              onClick={() => setEditingTx(tx)}
                              title="Classify manually"
                              aria-label="Classify manually"
                            >
                              <Tag size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn-tx-action btn-tx-delete"
                              onClick={() => handleDelete(tx)}
                              disabled={deletingId === tx.id}
                              title="Delete transaction"
                              aria-label="Delete transaction"
                            >
                              <Trash2 size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn-tx-action btn-tx-info"
                              onClick={() => toggleExpand(tx.id)}
                              title="Details"
                              aria-label="Details"
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <Info size={14} />}
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Detail Panel */}
                      {isExpanded && (
                        <tr className="tx-detail-row">
                          <td
                            colSpan={5 + (hasDates ? 1 : 0) + (hasAmounts ? 1 : 0)}
                            className="tx-detail-cell"
                          >
                            <div className="tx-detail-content">
                              {/* Action buttons inside expanded panel */}
                              <div className="tx-detail-actions-panel">
                                <button
                                  type="button"
                                  className="btn-detail-action btn-detail-classify"
                                  onClick={() => setEditingTx(tx)}
                                >
                                  <Tag size={14} />
                                  <span>Classify Manually</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn-detail-action btn-detail-delete"
                                  onClick={() => handleDelete(tx)}
                                  disabled={deletingId === tx.id}
                                >
                                  <Trash2 size={14} />
                                  <span>Delete Transaction</span>
                                </button>
                              </div>

                              {/* Comparison Cards if both tiers ran */}
                              <div className="tier-comparison-row">
                                {tx.tier1Result && (
                                  <div className={`tier-inspect-box ${isTier1 ? 'inspect-winner' : 'inspect-secondary'}`}>
                                    <div className="inspect-header">
                                      <div className="inspect-title-wrap text-blue">
                                        <Cpu size={14} />
                                        <strong>Tier 1 (Base n-grams)</strong>
                                        {isTier1 && <span className="winner-tag">CHOSEN</span>}
                                      </div>
                                      <span className="font-mono text-muted">
                                        {tx.tier1Result.inferenceTimeMs.toFixed(3)} ms
                                      </span>
                                    </div>
                                    <div className="inspect-body">
                                      <div className="inspect-cat">
                                        Category: <strong>{tx.tier1Result.category}</strong>
                                      </div>
                                      <div className="inspect-conf font-mono">
                                        Confidence: {(tx.tier1Result.confidence * 100).toFixed(1)}%
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {tx.tier2Result && (
                                  <div className={`tier-inspect-box ${!isTier1 ? 'inspect-winner' : 'inspect-secondary'}`}>
                                    <div className="inspect-header">
                                      <div className="inspect-title-wrap text-purple">
                                        <Brain size={14} />
                                        <strong>Tier 2 (multilingual-e5-small)</strong>
                                        {!isTier1 && <span className="winner-tag">CHOSEN</span>}
                                      </div>
                                      <span className="font-mono text-muted">
                                        {tx.tier2Result.inferenceTimeMs.toFixed(1)} ms
                                      </span>
                                    </div>
                                    <div className="inspect-body">
                                      <div className="inspect-cat">
                                        Category: <strong>{tx.tier2Result.category}</strong>
                                      </div>
                                      <div className="inspect-conf font-mono">
                                        Softmax Confidence: {(tx.tier2Result.confidence * 100).toFixed(1)}%
                                      </div>
                                      {tx.tier2Result.cosineSimilarities && (
                                        <div className="inspect-sim font-mono text-muted">
                                          Top Cosine Sim: {(tx.tier2Result.cosineSimilarities[tx.tier2Result.category] || 0).toFixed(4)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Probabilities Distribution */}
                              <div className="detail-meta-header">
                                <div>
                                  <strong>Final Prediction Probability Distribution</strong>
                                  <span className="detail-subtext">
                                    Processed by {tx.sourceTier} • Total latency: {tx.inferenceTimeMs.toFixed(2)} ms
                                  </span>
                                </div>
                              </div>

                              <div className="probabilities-grid">
                                {Object.entries(tx.probabilities)
                                  .sort(([, pA], [, pB]) => pB - pA)
                                  .map(([cat, prob]) => {
                                    const cMeta = getCategoryMeta(cat);
                                    const CIcon = cMeta.icon;
                                    const isTop = cat === tx.category;
                                    const pct = (prob * 100).toFixed(1);
                                    const cosSim = tx.tier2Result?.cosineSimilarities?.[cat];

                                    return (
                                      <div
                                        key={cat}
                                        className={`prob-card ${isTop ? 'prob-card-winner' : ''}`}
                                      >
                                        <div className="prob-card-top">
                                          <div className="prob-label-wrap">
                                            <CIcon size={13} style={{ color: cMeta.color }} />
                                            <span className="prob-cat-name">{cat}</span>
                                          </div>
                                          <span className="prob-pct font-mono">
                                            {pct}%
                                          </span>
                                        </div>
                                        <div className="prob-meter">
                                          <div
                                            className="prob-meter-fill"
                                            style={{
                                              width: `${pct}%`,
                                              backgroundColor: cMeta.color,
                                            }}
                                          />
                                        </div>
                                        {cosSim !== undefined && (
                                          <div className="prob-card-footer font-mono">
                                            Cosine Sim: {cosSim.toFixed(3)}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer-status">
          <span>
            Showing {filteredAndSorted.length} of {transactions.length} transactions
          </span>
          <div className="footer-status-chips">
            {selectedCategory !== 'ALL' && (
              <span className="text-muted">
                (Category: <strong>{selectedCategory}</strong>)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Manual Classification Modal */}
      {editingTx && (
        <div className="manual-classify-overlay" onClick={() => setEditingTx(null)}>
          <div className="manual-classify-modal" onClick={(e) => e.stopPropagation()}>
            <div className="manual-classify-header">
              <div>
                <h3 className="manual-classify-title">Classify Movement</h3>
                <p className="manual-classify-subtitle">Select the appropriate category for this transaction</p>
              </div>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setEditingTx(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="manual-classify-info-card">
              <div className="manual-tx-desc">{editingTx.rawDescription}</div>
              <div className="manual-tx-meta-row">
                {editingTx.date && <span className="font-mono text-muted">{editingTx.date}</span>}
                {editingTx.amount && (
                  <span
                    className={`font-mono font-semibold ${
                      editingTx.amount.startsWith('-') ? 'amount-negative' : 'amount-positive'
                    }`}
                  >
                    {editingTx.amount}
                  </span>
                )}
                <span className="manual-current-badge">
                  System: <strong>{getSystemCategory(editingTx)}</strong>
                </span>
              </div>
            </div>

            <div className="manual-classify-categories-grid">
              {activeCategoryKeys.map((catKey) => {
                const meta = getCategoryMeta(catKey);
                const Icon = meta.icon;
                const isSelected = editingTx.category === catKey;

                return (
                  <button
                    key={catKey}
                    type="button"
                    className={`cat-picker-btn ${isSelected ? 'cat-picker-selected' : ''}`}
                    style={{
                      borderColor: isSelected ? meta.color : undefined,
                      background: isSelected ? meta.bgLight : undefined,
                    }}
                    onClick={async () => {
                      const sysCat = getSystemCategory(editingTx);
                      await onUpdateTransactionCategory(editingTx.id, catKey);
                      setEditingTx((prev) =>
                        prev
                          ? {
                              ...prev,
                              category: catKey,
                              sourceTier: 'Manual',
                              systemCategory: sysCat,
                            }
                          : null
                      );
                    }}
                  >
                    <div
                      className="cat-picker-icon-box"
                      style={{ backgroundColor: meta.bgLight, color: meta.color }}
                    >
                      <Icon size={18} />
                    </div>
                    <div className="cat-picker-label-wrap">
                      <span
                        className="cat-picker-title"
                        style={{ color: isSelected ? meta.color : undefined }}
                      >
                        {meta.name}
                      </span>
                      <span className="cat-picker-examples">{meta.examples}</span>
                    </div>
                    {isSelected && (
                      <div className="cat-picker-check" style={{ color: meta.color }}>
                        <Check size={18} />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
