# MySpendLens 🔍💳

> **100% Client-Side, Privacy-First Transaction Categorizer & Financial Lens**  
> Classify, explore, and analyze your bank statements entirely in your browser. Zero telemetry. Zero server calls. Zero financial data leaves your device.

---

## ✨ Overview

**MySpendLens** is an open-source, local-first web application designed to categorize and visualize bank statement transactions without sending sensitive financial records to external servers or proprietary cloud AI APIs.

It features a **Hybrid Two-Tier Edge Machine Learning Cascade** that combines ultra-fast local linear classification with semantic deep embedding models, running entirely in browser memory using WebAssembly.

---

## 🚀 Key Features

- **🛡️ 100% Private & Local**:
  All parsing, categorization, and storage run on your device. The app operates offline and works without internet connection once assets are cached.
- **⚡ Hybrid Two-Tier AI Cascade**:
  - **Tier 1 (Sub-millisecond Engine)**: Multinomial Logistic Regression running over sparse word & character n-grams directly in pure JavaScript (<1 ms inference per record).
  - **Tier 2 (Deep Semantic Fallback)**: `Xenova/multilingual-e5-small` running client-side via [Transformers.js](https://huggingface.co/docs/transformers.js) and ONNX Runtime Web. Automatically invoked only when Tier 1 confidence falls below user-configured thresholds.
- **🧠 In-Browser Personal AI Training**:
  Fine-tune and retrain the Tier 1 model directly in your browser. When you add new custom categories or modify labels, the app performs semantic anchor distillation with Tier 2 and retrains Tier 1 weights with in-place Stochastic Gradient Descent.
- **📊 Financial Analytics & Visualizations**:
  - **Interactive Expense Donut**: SVG-based category distribution with instant percentage and drill-down inspection.
  - **Budget Trajectory & Cash Flow**: Daily chronological cash flow tracking with surplus/deficit status, burn rate metrics, and erosion curves.
- **📥 Universal Statement Parser**:
  Automatic column detection and 2-row preview wizard supporting diverse European and international CSV statement formats.
- **🗄️ Offline IndexedDB Storage & Portable Backups**:
  - Deterministic cryptographic fingerprint deduplication (`date + description + amount`).
  - Full database ZIP backup and restore functionality.
- **📱 Responsive Layout**:
  Optimized for touchscreens and mobile browsers, while seamlessly expanding into a full-featured desktop dashboard on laptops and tablets ($\ge 768\text{px}$).

---

## 🏛️ Architecture & Project Structure

The codebase is structured around clean React hooks and standalone domain engines:

```
src/
├── components/          # Specialized UI views & presentation components
│   ├── ActionGrid.tsx               # Main dashboard action hub
│   ├── CategoriesView.tsx           # Dynamic category management & customization
│   ├── ChartsView.tsx               # Responsive SVG donut & cash flow trajectory
│   ├── ExpensesDistributionView.tsx # Categorized expenditure breakdown
│   ├── ExportImportView.tsx         # Full database backup & restore (.zip)
│   ├── Header.tsx                   # Top navigation & system status
│   ├── HomeHeroOverview.tsx         # Executive financial overview & segmented bar
│   ├── SettingsView.tsx             # Strategy thresholds & database controls
│   ├── Tier1TrainingModal.tsx       # In-browser model distillation & training modal
│   ├── TransactionsTable.tsx        # Filterable & editable transaction registry
│   └── UploadView.tsx               # 3-step CSV upload & column mapping wizard
├── db/                  # IndexedDB schema, operations, and deduplication
│   └── transactionDb.ts
├── engine/              # In-browser machine learning inference & training engines
│   ├── tier1_browser_engine.ts      # Multinomial Logistic Regression & in-memory SGD
│   └── tier2_embedding_engine.ts    # Transformers.js ONNX embedding pipeline
├── hooks/               # Composable business logic hooks
│   ├── useAppNavigation.ts          # History-aware view routing
│   ├── useClassificationEngines.ts  # ML lifecycle, lazy loaders, and cascade prediction
│   └── useTransactionData.ts        # Database state, CRUD handlers, and backups
├── utils/               # Numerical, financial, and string utilities
│   ├── categories.ts                # Metadata, color palette, and dynamic icon resolver
│   ├── csvParser.ts                 # PapaParse wrapper & column header heuristics
│   └── financialCalculations.ts     # Cash flow aggregations & currency formatting
├── types.ts             # Domain TypeScript interfaces
├── App.tsx              # Root declarative orchestrator
└── main.tsx             # React DOM entrypoint
```

---

## 🛠️ Quickstart

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18 or later)
- `npm` or `pnpm`

### Installation & Development
```bash
# Clone the repository
git clone https://github.com/mceleri/MySpendLens.git
cd MySpendLens

# Install dependencies
npm install

# Start local development server
npm run dev
```

Open `http://localhost:3000` in your browser.

### Production Build
```bash
# Typecheck and bundle with Vite
npm run build

# Preview production build locally
npm run preview
```

---

## 🔒 Privacy & Threat Model

1. **No External API Calls**: Transaction descriptions, dates, and amounts are never transmitted across network boundaries.
2. **Local Persistence**: Data is saved exclusively in your browser's local `IndexedDB` storage (`myspendlens_db`).
3. **Cache Storage Support**: Pre-trained model artifacts are cached locally using standard Cache API or IndexedDB.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
