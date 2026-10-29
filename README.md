# MySpendLens

A local-first, privacy-focused bank statement categorizer and financial visualization tool that runs entirely in the browser. No server uploads, no telemetry, and no external AI API calls.

> 🌐 **Live Web App**: [https://mceleri.github.io/MySpendLens/](https://mceleri.github.io/MySpendLens/)  
> Try it directly online — all processing and data storage remain 100% private and local to your device.

---

## Overview

**MySpendLens** lets you import, categorize, and analyze bank statements locally on your device. All data parsing, machine learning inference, and storage happen directly in the browser using WebAssembly and IndexedDB.

Transactions are classified using a tiered cascade:
1. **Tier 0 (Merchant Memory)**: Instant matching against previously verified transactions from your history.
2. **Tier 1 (Linear Model)**: Fast multinomial logistic regression over 3–5 character n-grams (~0.2 ms per transaction), pre-trained on Italian and Spanish merchant datasets. It provides very good practical accuracy in initial exploratory tests of this work-in-progress application (validated on the author's real-world bank statements, measuring ~93.8% on a synthetic variation holdout benchmark).
3. **Tier 2 (Embedding Model Fallback)**: `Xenova/multilingual-e5-small` embedding model running via [Transformers.js](https://huggingface.co/docs/transformers.js) and ONNX Runtime Web, invoked only when Tier 1 confidence falls below a user-configured threshold.

---

## Features

- **Private by Design**: Financial records, account details, and amounts never leave your browser.
- **Statement Import (CSV & Excel)**:
  - Supports CSV (`.csv`) and Excel (`.xlsx`, `.xls`) statement files.
  - Automatic column detection (Date, Description, Amount) with interactive 3-row preview.
  - Date format ambiguity detection (e.g. distinguishing `DD/MM/YYYY` from `MM/DD/YYYY`).
  - Automatic filtering of non-transaction header/footer metadata.
- **Multi-Tier Classification**:
  - Combined Tier 0 / Tier 1 / Tier 2 cascade.
  - Option to toggle Tier 1 off to evaluate Tier 2 embeddings as a baseline.
  - Configurable Tier 1 confidence threshold (50%–95%).
- **In-Browser Model Adaptation**:
  - Retrain Tier 1 weights locally via Stochastic Gradient Descent (SGD) directly in browser memory.
  - Automatic semantic distillation with Tier 2 when custom categories are added or renamed.
- **Financial Visualizations**:
  - **Category Donut Chart**: Interactive SVG spending distribution with category drill-down.
  - **Cash Flow Trajectory**: Chronological cumulative balance tracking, net burn rate, and daily expense erosion curves.
  - **Expense Breakdown**: Segmented expenditure distribution over rolling timeframes (30d, 60d, 90d, month, all).
- **Transaction Registry**:
  - Client-side pagination (25, 50, 100, 250 items per page) for fluid browsing of large statement files.
  - Real-time search, multi-column sorting, and inline manual category reassignment.
  - Detailed inference inspector showing latency, probabilities, and model tier per transaction.
- **Storage & Backup**:
  - Local persistence in IndexedDB with multiset occurrence fingerprint deduplication.
  - Export and import full `.zip` backup archives containing transactions, categories, configuration, and trained Tier 1 model weights.
  - Granular `.json` export options.

---

## Architecture & Codebase Structure

```
src/
├── components/          # UI views and components
│   ├── ActionGrid.tsx               # Quick-action dashboard navigation
│   ├── CategoriesView.tsx           # Category customization, color palette & icon picker
│   ├── ChartsView.tsx               # SVG category donut and cash flow trajectory
│   ├── ErrorBoundary.tsx            # Global application error boundary
│   ├── ExpensesDistributionView.tsx # Categorized expenditure breakdown list
│   ├── ExportImportView.tsx         # Full backup packaging (.zip) and JSON restore
│   ├── Header.tsx                   # Top navigation bar and model status indicators
│   ├── HomeHeroOverview.tsx         # Financial overview card & segmented expenditure bar
│   ├── SettingsView.tsx             # Strategy thresholds, model preloading & database reset
│   ├── Tier1TrainingModal.tsx       # Local distillation and fine-tuning pipeline
│   ├── TransactionsTable.tsx        # Paginated, filterable transaction table with manual review
│   └── UploadView.tsx               # 3-step CSV/Excel upload and column mapping wizard
├── db/                  # IndexedDB schema and operations
│   └── transactionDb.ts             # Persistent storage, multiset deduplication, batch merge
├── engine/              # In-browser machine learning engines
│   ├── tier1_browser_engine.ts      # Logistic regression inference & in-browser SGD training
│   └── tier2_embedding_engine.ts    # Multilingual-e5 embedding pipeline & cache adapters
├── hooks/               # Application logic hooks
│   ├── useAppNavigation.ts          # History-aware view navigation
│   ├── useClassificationEngines.ts  # Model lifecycle, lazy loading, and cascade predictions
│   └── useTransactionData.ts        # Database state, CRUD operations, and backups
├── utils/               # Formatting and parsing utilities
│   ├── categories.ts                # Default definitions, color palettes, and Lucide icons
│   ├── csvParser.ts                 # CSV/Excel parsing, header heuristics, row extraction
│   └── financialCalculations.ts     # Currency formatting, date parsing, cash flow metrics
├── types.ts             # TypeScript domain interfaces
├── App.tsx              # Root application component with code-split views
├── index.css            # Stylesheet
└── main.tsx             # Application entrypoint
```

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or later)
- `npm`

### Installation & Development
```bash
# Clone the repository
git clone https://github.com/mceleri/MySpendLens.git
cd MySpendLens

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open `http://localhost:3000` in your browser.

### Production Build
```bash
# Typecheck and bundle with Vite
npm run build

# Preview the production build locally
npm run preview
```

---

## Privacy Model

1. **Local Processing**: Raw transaction strings, amounts, dates, and account details never leave your browser sandbox.
2. **Local Storage**: All data is stored in the browser's `IndexedDB` under `myspendlens_db`.
3. **Model Caching**: Pre-trained model weights are retrieved once and cached locally via the browser Cache API or IndexedDB.

---

## License

This project is licensed under the [MIT License](LICENSE).
