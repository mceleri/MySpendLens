import React, { useState, useMemo } from 'react';
import {
  PieChart,
  TrendingDown,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  ChevronRight,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
} from 'lucide-react';
import { ProcessedTransaction } from '../types';
import {
  formatCurrency,
  formatDisplayDate,
  parseTransactionAmount,
  parseTransactionDate,
} from '../utils/financialCalculations';
import { getCategoryMeta } from '../utils/categories';

export type TimeRangeOption = '30d' | '60d' | '90d' | 'this_month' | 'all';

interface ChartsViewProps {
  transactions: ProcessedTransaction[];
  onOpenUpload?: () => void;
  onFilterByCategory?: (category: string) => void;
}

interface DailyCashFlowPoint {
  dateStr: string;
  dateObj: Date;
  dayIn: number;
  dayOut: number;
  cumIn: number;
  cumOut: number;
  netBalance: number;
}

export const ChartsView: React.FC<ChartsViewProps> = ({
  transactions,
  onOpenUpload,
  onFilterByCategory,
}) => {
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('60d');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activePointIndex, setActivePointIndex] = useState<number | null>(null);

  // 1. Pre-parse and cache dates and amounts
  const parsedTransactions = useMemo(() => {
    return transactions.map((t) => ({
      ...t,
      parsedAmount: parseTransactionAmount(t.amount),
      parsedDate: parseTransactionDate(t.date),
    }));
  }, [transactions]);

  // Find dataset boundary dates
  const datasetDateRange = useMemo(() => {
    let minDate: Date | null = null;
    let maxDate: Date | null = null;

    for (const t of parsedTransactions) {
      if (t.parsedDate && !isNaN(t.parsedDate.getTime())) {
        if (!minDate || t.parsedDate.getTime() < minDate.getTime()) {
          minDate = t.parsedDate;
        }
        if (!maxDate || t.parsedDate.getTime() > maxDate.getTime()) {
          maxDate = t.parsedDate;
        }
      }
    }

    return { minDate, maxDate: maxDate || new Date() };
  }, [parsedTransactions]);

  // 2. Filter transactions based on selected TimeRange
  const filteredTransactions = useMemo(() => {
    if (parsedTransactions.length === 0) return [];
    if (timeRange === 'all') return parsedTransactions;

    const refDate = datasetDateRange.maxDate;
    let startMs = 0;

    if (timeRange === '30d') {
      startMs = refDate.getTime() - 30 * 24 * 60 * 60 * 1000;
    } else if (timeRange === '60d') {
      startMs = refDate.getTime() - 60 * 24 * 60 * 60 * 1000;
    } else if (timeRange === '90d') {
      startMs = refDate.getTime() - 90 * 24 * 60 * 60 * 1000;
    } else if (timeRange === 'this_month') {
      const year = refDate.getFullYear();
      const month = refDate.getMonth();
      startMs = new Date(year, month, 1).getTime();
    }

    return parsedTransactions.filter((t) => {
      if (!t.parsedDate || isNaN(t.parsedDate.getTime())) return true;
      return t.parsedDate.getTime() >= startMs && t.parsedDate.getTime() <= refDate.getTime() + 24 * 60 * 60 * 1000;
    });
  }, [parsedTransactions, timeRange, datasetDateRange]);

  // 3. Category Distribution (Expenses only)
  const categoryDistribution = useMemo(() => {
    const map: Record<string, { amount: number; count: number }> = {};
    let totalExpenses = 0;

    for (const t of filteredTransactions) {
      if (t.parsedAmount < 0) {
        const out = Math.abs(t.parsedAmount);
        totalExpenses += out;
        if (!map[t.category]) {
          map[t.category] = { amount: 0, count: 0 };
        }
        map[t.category].amount += out;
        map[t.category].count += 1;
      }
    }

    const items = Object.entries(map).map(([category, val]) => {
      const meta = getCategoryMeta(category);
      const percentage = totalExpenses > 0 ? (val.amount / totalExpenses) * 100 : 0;
      return {
        category,
        label: meta ? meta.label : category,
        color: meta ? meta.color : '#94a3b8',
        amount: val.amount,
        count: val.count,
        percentage,
      };
    });

    items.sort((a, b) => b.amount - a.amount);

    return {
      items,
      totalExpenses,
    };
  }, [filteredTransactions]);

  // 4. Budget Erosion & Cash Flow Trajectory Time Series
  const budgetTrajectory = useMemo(() => {
    const dailyMap: Record<string, { dateObj: Date; dayIn: number; dayOut: number }> = {};

    let totalIn = 0;
    let totalOut = 0;

    for (const t of filteredTransactions) {
      const d = t.parsedDate || datasetDateRange.maxDate;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

      if (!dailyMap[key]) {
        dailyMap[key] = { dateObj: d, dayIn: 0, dayOut: 0 };
      }

      if (t.parsedAmount > 0) {
        dailyMap[key].dayIn += t.parsedAmount;
        totalIn += t.parsedAmount;
      } else if (t.parsedAmount < 0) {
        const out = Math.abs(t.parsedAmount);
        dailyMap[key].dayOut += out;
        totalOut += out;
      }
    }

    const sortedDays = Object.entries(dailyMap)
      .map(([k, v]) => ({ dateStr: k, ...v }))
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

    let cumIn = 0;
    let cumOut = 0;

    const points: DailyCashFlowPoint[] = sortedDays.map((d) => {
      cumIn += d.dayIn;
      cumOut += d.dayOut;
      return {
        dateStr: d.dateStr,
        dateObj: d.dateObj,
        dayIn: d.dayIn,
        dayOut: d.dayOut,
        cumIn,
        cumOut,
        netBalance: cumIn - cumOut,
      };
    });

    const netFinal = totalIn - totalOut;
    const isSurplus = netFinal >= 0;
    const daysCount = Math.max(1, sortedDays.length);
    const dailyErosionRate = totalOut / daysCount;
    const burnRatio = totalIn > 0 ? (totalOut / totalIn) * 100 : 100;

    return {
      points,
      totalIn,
      totalOut,
      netFinal,
      isSurplus,
      dailyErosionRate,
      burnRatio,
    };
  }, [filteredTransactions, datasetDateRange]);

  // 5. SVG Donut Path Generator
  const donutArcs = useMemo(() => {
    const { items, totalExpenses } = categoryDistribution;
    if (totalExpenses === 0 || items.length === 0) return [];

    const cx = 120;
    const cy = 120;
    const R = 95;
    const r = 62;

    let currentAngle = -Math.PI / 2; // start at top (12 o'clock)
    const arcs = [];

    // If only one item with 100%
    if (items.length === 1) {
      const it = items[0];
      const mid = currentAngle + Math.PI;
      const end = currentAngle + 2 * Math.PI;

      const path =
        `M ${cx + R * Math.cos(currentAngle)} ${cy + R * Math.sin(currentAngle)} ` +
        `A ${R} ${R} 0 0 1 ${cx + R * Math.cos(mid)} ${cy + R * Math.sin(mid)} ` +
        `L ${cx + r * Math.cos(mid)} ${cy + r * Math.sin(mid)} ` +
        `A ${r} ${r} 0 0 0 ${cx + r * Math.cos(currentAngle)} ${cy + r * Math.sin(currentAngle)} Z ` +
        `M ${cx + R * Math.cos(mid)} ${cy + R * Math.sin(mid)} ` +
        `A ${R} ${R} 0 0 1 ${cx + R * Math.cos(end)} ${cy + R * Math.sin(end)} ` +
        `L ${cx + r * Math.cos(end)} ${cy + r * Math.sin(end)} ` +
        `A ${r} ${r} 0 0 0 ${cx + r * Math.cos(mid)} ${cy + r * Math.sin(mid)} Z`;

      arcs.push({
        ...it,
        d: path,
        startAngle: currentAngle,
        endAngle: end,
      });
      return arcs;
    }

    for (const it of items) {
      const sliceAngle = (it.amount / totalExpenses) * 2 * Math.PI;
      const startAngle = currentAngle;
      const endAngle = currentAngle + sliceAngle;

      const x1 = cx + R * Math.cos(startAngle);
      const y1 = cy + R * Math.sin(startAngle);
      const x2 = cx + R * Math.cos(endAngle);
      const y2 = cy + R * Math.sin(endAngle);
      const x3 = cx + r * Math.cos(endAngle);
      const y3 = cy + r * Math.sin(endAngle);
      const x4 = cx + r * Math.cos(startAngle);
      const y4 = cy + r * Math.sin(startAngle);

      const largeArc = sliceAngle > Math.PI ? 1 : 0;
      const d = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${R} ${R} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${r} ${r} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;

      arcs.push({
        ...it,
        d,
        startAngle,
        endAngle,
      });

      currentAngle = endAngle;
    }

    return arcs;
  }, [categoryDistribution]);

  // Active donut slice data for the center display
  const activeSlice = useMemo(() => {
    if (!selectedCategory) return null;
    return categoryDistribution.items.find((i) => i.category === selectedCategory) || null;
  }, [selectedCategory, categoryDistribution]);

  // 6. SVG Line & Area Path Coordinates for Budget Trajectory
  const lineChartData = useMemo(() => {
    const { points } = budgetTrajectory;
    if (points.length === 0) return null;

    const width = 460;
    const height = 200;
    const padX = 24;
    const padY = 24;

    const plotW = width - padX * 2;
    const plotH = height - padY * 2;

    const balances = points.map((p) => p.netBalance);
    const minVal = Math.min(0, ...balances);
    const maxVal = Math.max(0, ...balances);
    const range = maxVal - minVal || 1;

    // Zero-line Y position
    const zeroY = padY + plotH * (1 - (0 - minVal) / range);

    const coords = points.map((p, idx) => {
      const x = padX + (points.length === 1 ? plotW / 2 : (idx / (points.length - 1)) * plotW);
      const y = padY + plotH * (1 - (p.netBalance - minVal) / range);
      return { x, y, point: p };
    });

    // Build SVG path
    let linePath = `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`;
    for (let i = 1; i < coords.length; i++) {
      linePath += ` L ${coords[i].x.toFixed(1)} ${coords[i].y.toFixed(1)}`;
    }

    // Closed Area path down to zero-line
    const areaPath =
      `${linePath} ` +
      `L ${coords[coords.length - 1].x.toFixed(1)} ${zeroY.toFixed(1)} ` +
      `L ${coords[0].x.toFixed(1)} ${zeroY.toFixed(1)} Z`;

    return {
      width,
      height,
      zeroY,
      coords,
      linePath,
      areaPath,
      minVal,
      maxVal,
    };
  }, [budgetTrajectory]);

  // Hovered or focused point on line chart
  const activeTrajectoryPoint = useMemo(() => {
    if (activePointIndex === null || !budgetTrajectory.points[activePointIndex]) {
      return budgetTrajectory.points[budgetTrajectory.points.length - 1] || null;
    }
    return budgetTrajectory.points[activePointIndex];
  }, [activePointIndex, budgetTrajectory]);

  if (transactions.length === 0) {
    return (
      <div className="view-container">
        <div className="empty-charts-card">
          <div className="empty-charts-icon-wrap">
            <PieChart size={36} className="text-cyan" />
          </div>
          <h3 className="empty-charts-title">No Transaction Data Available</h3>
          <p className="empty-charts-desc">
            Upload your bank statement to unlock visual expense breakdowns, donut distribution, and real-time budget cash-flow trajectories.
          </p>
          {onOpenUpload && (
            <button type="button" className="btn-primary mt-3" onClick={onOpenUpload}>
              <span>Upload Statements</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="view-container charts-view-container">
      {/* Time Range Filter Bar */}
      <div className="time-filter-strip">
        <div className="time-filter-label">
          <Calendar size={14} className="text-cyan" />
          <span>Period:</span>
        </div>
        <div className="time-pills-row">
          {(
            [
              { key: '30d', label: '30 Days' },
              { key: '60d', label: '60 Days' },
              { key: '90d', label: '90 Days' },
              { key: 'this_month', label: 'This Month' },
              { key: 'all', label: 'All Time' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`time-pill-btn ${timeRange === opt.key ? 'active' : ''}`}
              onClick={() => {
                setTimeRange(opt.key);
                setSelectedCategory(null);
                setActivePointIndex(null);
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* =========================================================================
          CARD 1: DONUT CHART — EXPENSE DISTRIBUTION ACROSS CATEGORIES
          ========================================================================= */}
      <div className="charts-card">
        <div className="charts-card-header">
          <div className="charts-card-title-wrap">
            <div className="charts-card-icon-pill bg-purple-subtle">
              <PieChart size={18} className="text-purple" />
            </div>
            <div>
              <h3 className="charts-card-title">Category Distribution</h3>
              <p className="charts-card-subtitle">Spending breakdown across active classes</p>
            </div>
          </div>
          <div className="charts-badge-pill">
            <span className="font-mono font-bold text-rose">
              {formatCurrency(categoryDistribution.totalExpenses)}
            </span>
          </div>
        </div>

        {categoryDistribution.items.length === 0 ? (
          <div className="chart-empty-state">
            <AlertCircle size={20} className="text-muted" />
            <span>No expense transactions recorded in this period.</span>
          </div>
        ) : (
          <div className="donut-section-body">
            {/* SVG Donut Visualizer */}
            <div className="donut-svg-wrapper">
              <svg
                viewBox="0 0 240 240"
                className="donut-svg"
                role="img"
                aria-label="Expense distribution donut chart"
              >
                <defs>
                  <filter id="donut-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.4" />
                  </filter>
                </defs>
                {donutArcs.map((arc) => {
                  const isSelected = selectedCategory === arc.category;
                  return (
                    <path
                      key={arc.category}
                      d={arc.d}
                      fill={arc.color}
                      stroke="var(--bg-card, #0f172a)"
                      strokeWidth="2.5"
                      className={`donut-slice ${isSelected ? 'slice-selected' : ''}`}
                      onClick={() =>
                        setSelectedCategory(selectedCategory === arc.category ? null : arc.category)
                      }
                      onMouseEnter={() => setSelectedCategory(arc.category)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${arc.label}: ${formatCurrency(arc.amount)} (${arc.percentage.toFixed(1)}%)`}
                    />
                  );
                })}
              </svg>

              {/* Donut Center Display */}
              <div
                className="donut-center-overlay"
                onClick={() => setSelectedCategory(null)}
                title="Click to reset slice focus"
              >
                {activeSlice ? (
                  <>
                    <span className="donut-center-label" style={{ color: activeSlice.color }}>
                      {activeSlice.label}
                    </span>
                    <span className="donut-center-amount font-mono">
                      {formatCurrency(activeSlice.amount)}
                    </span>
                    <span className="donut-center-pct font-mono badge-pill badge-primary">
                      {activeSlice.percentage.toFixed(1)}% ({activeSlice.count} tx)
                    </span>
                  </>
                ) : (
                  <>
                    <span className="donut-center-label text-dim">Total Spent</span>
                    <span className="donut-center-amount font-mono text-main">
                      {formatCurrency(categoryDistribution.totalExpenses)}
                    </span>
                    <span className="donut-center-sub text-dim">
                      {categoryDistribution.items.length} categories
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Interactive Legend Grid */}
            <div className="donut-legend-grid">
              {categoryDistribution.items.map((item) => {
                const isSelected = selectedCategory === item.category;
                return (
                  <button
                    key={item.category}
                    type="button"
                    className={`legend-item-btn ${isSelected ? 'legend-item-active' : ''}`}
                    onClick={() =>
                      setSelectedCategory(selectedCategory === item.category ? null : item.category)
                    }
                    title="Click to highlight category in donut"
                  >
                    <div className="legend-item-left">
                      <span className="legend-color-dot" style={{ backgroundColor: item.color }} />
                      <span className="legend-cat-name">{item.label}</span>
                    </div>
                    <div className="legend-item-right">
                      <span className="legend-cat-pct font-mono">{item.percentage.toFixed(1)}%</span>
                      <span className="legend-cat-amount font-mono">{formatCurrency(item.amount)}</span>
                      {onFilterByCategory && (
                        <div
                          className="legend-drilldown-icon"
                          onClick={(e) => {
                            e.stopPropagation();
                            onFilterByCategory(item.category);
                          }}
                          title={`View ${item.label} transactions`}
                        >
                          <ChevronRight size={13} />
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* =========================================================================
          CARD 2: BUDGET RUN-DOWN & CASH FLOW EROSION TRAJECTORY
          ========================================================================= */}
      <div className="charts-card">
        <div className="charts-card-header">
          <div className="charts-card-title-wrap">
            <div
              className={`charts-card-icon-pill ${budgetTrajectory.isSurplus ? 'bg-emerald-subtle' : 'bg-rose-subtle'}`}
            >
              {budgetTrajectory.isSurplus ? (
                <TrendingUp size={18} className="text-emerald" />
              ) : (
                <TrendingDown size={18} className="text-danger" />
              )}
            </div>
            <div>
              <h3 className="charts-card-title">Budget Trajectory & Cash Flow</h3>
              <p className="charts-card-subtitle">
                Income erosion rate and net balance over time
              </p>
            </div>
          </div>

          <div
            className={`badge-pill ${budgetTrajectory.isSurplus ? 'badge-emerald' : 'badge-danger'}`}
          >
            {budgetTrajectory.isSurplus ? 'Surplus (Active)' : 'Deficit (Passive)'}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="cashflow-kpi-grid">
          <div className="cashflow-kpi-card in-card">
            <div className="kpi-card-header">
              <ArrowDownRight size={14} className="text-emerald" />
              <span className="kpi-title">Total Inflow</span>
            </div>
            <div className="kpi-val font-mono text-emerald">
              {formatCurrency(budgetTrajectory.totalIn)}
            </div>
            <span className="kpi-hint text-dim">Total income received</span>
          </div>

          <div className="cashflow-kpi-card out-card">
            <div className="kpi-card-header">
              <ArrowUpRight size={14} className="text-rose" />
              <span className="kpi-title">Total Outflow</span>
            </div>
            <div className="kpi-val font-mono text-rose">
              {formatCurrency(budgetTrajectory.totalOut)}
            </div>
            <span className="kpi-hint text-dim">
              Avg. ~{formatCurrency(budgetTrajectory.dailyErosionRate)}/day
            </span>
          </div>

          <div
            className={`cashflow-kpi-card net-card ${budgetTrajectory.isSurplus ? 'surplus' : 'deficit'}`}
          >
            <div className="kpi-card-header">
              {budgetTrajectory.isSurplus ? (
                <CheckCircle2 size={14} className="text-emerald" />
              ) : (
                <AlertCircle size={14} className="text-danger" />
              )}
              <span className="kpi-title">Net Cash Balance</span>
            </div>
            <div
              className={`kpi-val font-mono ${budgetTrajectory.isSurplus ? 'text-emerald' : 'text-danger'}`}
            >
              {budgetTrajectory.netFinal >= 0 ? '+' : ''}
              {formatCurrency(budgetTrajectory.netFinal)}
            </div>
            <span className="kpi-hint text-dim">
              {budgetTrajectory.burnRatio.toFixed(1)}% of income consumed
            </span>
          </div>
        </div>

        {/* Progress Bar of Budget Erosion */}
        {budgetTrajectory.totalIn > 0 && (
          <div className="budget-burn-bar-container">
            <div className="burn-bar-header">
              <span className="burn-bar-label">Income Consumption Level</span>
              <span
                className={`burn-bar-pct font-mono ${budgetTrajectory.burnRatio > 100 ? 'text-danger font-bold' : 'text-cyan'}`}
              >
                {budgetTrajectory.burnRatio.toFixed(1)}%
              </span>
            </div>
            <div className="burn-bar-track">
              <div
                className={`burn-bar-fill ${budgetTrajectory.burnRatio > 100 ? 'fill-danger' : budgetTrajectory.burnRatio > 80 ? 'fill-amber' : 'fill-cyan'}`}
                style={{ width: `${Math.min(100, budgetTrajectory.burnRatio)}%` }}
              />
            </div>
          </div>
        )}

        {/* SVG Time Series Area & Line Chart */}
        {lineChartData && lineChartData.coords.length > 0 ? (
          <div className="trajectory-chart-container">
            {/* Interactive Inspector Badge */}
            {activeTrajectoryPoint && (
              <div className="trajectory-inspector-bar">
                <div className="inspector-date">
                  <Calendar size={13} className="text-cyan" />
                  <span className="font-mono">{formatDisplayDate(activeTrajectoryPoint.dateObj)}</span>
                </div>
                <div className="inspector-values">
                  {activeTrajectoryPoint.dayIn > 0 && (
                    <span className="text-emerald font-mono">
                      +{formatCurrency(activeTrajectoryPoint.dayIn)}
                    </span>
                  )}
                  {activeTrajectoryPoint.dayOut > 0 && (
                    <span className="text-rose font-mono">
                      -{formatCurrency(activeTrajectoryPoint.dayOut)}
                    </span>
                  )}
                  <div className="inspector-balance-tag">
                    <span className="text-dim">Net:</span>
                    <strong
                      className={`font-mono ${activeTrajectoryPoint.netBalance >= 0 ? 'text-emerald' : 'text-danger'}`}
                    >
                      {activeTrajectoryPoint.netBalance >= 0 ? '+' : ''}
                      {formatCurrency(activeTrajectoryPoint.netBalance)}
                    </strong>
                  </div>
                </div>
              </div>
            )}

            <div className="trajectory-svg-wrap">
              <svg
                viewBox={`0 0 ${lineChartData.width} ${lineChartData.height}`}
                className="trajectory-svg"
                preserveAspectRatio="none"
              >
                <defs>
                  {/* Surplus (Active) Gradient */}
                  <linearGradient id="area-surplus-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.32" />
                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.02" />
                  </linearGradient>

                  {/* Deficit (Passive) Gradient */}
                  <linearGradient id="area-deficit-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity="0.02" />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity="0.32" />
                  </linearGradient>
                </defs>

                {/* Zero Reference Line */}
                <line
                  x1="16"
                  y1={lineChartData.zeroY}
                  x2={lineChartData.width - 16}
                  y2={lineChartData.zeroY}
                  stroke="rgba(255, 255, 255, 0.2)"
                  strokeDasharray="4 4"
                  strokeWidth="1.2"
                />

                {/* Shaded Area under Curve */}
                <path
                  d={lineChartData.areaPath}
                  fill={budgetTrajectory.isSurplus ? 'url(#area-surplus-grad)' : 'url(#area-deficit-grad)'}
                />

                {/* Main Trajectory Line */}
                <path
                  d={lineChartData.linePath}
                  fill="none"
                  stroke={budgetTrajectory.isSurplus ? '#10b981' : '#ef4444'}
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Points on Line */}
                {lineChartData.coords.map((c, idx) => {
                  const isActive = activePointIndex === idx;
                  const isPositive = c.point.netBalance >= 0;
                  return (
                    <g key={c.point.dateStr}>
                      {isActive && (
                        <line
                          x1={c.x}
                          y1={16}
                          x2={c.x}
                          y2={lineChartData.height - 16}
                          stroke="rgba(255, 255, 255, 0.35)"
                          strokeDasharray="2 2"
                        />
                      )}
                      <circle
                        cx={c.x}
                        cy={c.y}
                        r={isActive ? 6 : 3.5}
                        fill={isPositive ? '#10b981' : '#ef4444'}
                        stroke="#0f172a"
                        strokeWidth="2"
                        className="trajectory-dot"
                        onMouseEnter={() => setActivePointIndex(idx)}
                        onTouchStart={() => setActivePointIndex(idx)}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Date Edge Labels */}
            <div className="trajectory-x-labels">
              <span className="font-mono text-dim text-xs">
                {formatDisplayDate(budgetTrajectory.points[0]?.dateObj)}
              </span>
              <span className="font-mono text-dim text-xs">
                {formatDisplayDate(budgetTrajectory.points[budgetTrajectory.points.length - 1]?.dateObj)}
              </span>
            </div>
          </div>
        ) : (
          <div className="chart-empty-state">
            <HelpCircle size={18} className="text-muted" />
            <span>Not enough date points to construct cash flow trajectory.</span>
          </div>
        )}
      </div>
    </div>
  );
};
