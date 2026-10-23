import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Header } from './components/Header';
import { HomeHeroOverview } from './components/HomeHeroOverview';
import { ActionGrid } from './components/ActionGrid';
import { ExpensesDistributionView } from './components/ExpensesDistributionView';
import { SettingsView } from './components/SettingsView';
import { UploadView } from './components/UploadView';
import { TransactionsTable } from './components/TransactionsTable';
import { CategoriesView } from './components/CategoriesView';
import { ExportImportView } from './components/ExportImportView';
import { Tier1TrainingModal } from './components/Tier1TrainingModal';
import {
  MySpendLensTier1Engine,
  Tier1ModelArtifact,
} from './engine/tier1_browser_engine';
import {
  MySpendLensTier2Engine,
  Tier2ProgressInfo,
} from './engine/tier2_embedding_engine';
import {
  ProcessedTransaction,
  ModelStats,
  BatchProcessingSummary,
  Tier2LoadingState,
} from './types';
import { RawRow } from './utils/csvParser';
import {
  getAllTransactionsFromDB,
  addTransactionsToDB,
  updateTransactionsInDB,
  updateSingleTransactionInDB,
  deleteTransactionFromDB,
  clearAllTransactionsInDB,
  migrateFromLocalStorageIfNeeded,
  generateTransactionFingerprint,
  getAllCategoriesFromDB,
  saveCategoryToDB,
  deleteCategoryFromDB,
  renameCategoryInDB,
  reassignCategoryInDB,
  replaceAllTransactionsInDB,
  replaceAllCategoriesInDB,
  saveAppSettingsToDB,
  getAppSettingsFromDB,
  saveCustomTier1ModelToDB,
  getCustomTier1ModelFromDB,
  factoryResetAppInDB,
} from './db/transactionDb';
import {
  CategoryDefinition,
  DEFAULT_CATEGORY_DEFINITIONS,
  registerDynamicCategories,
} from './utils/categories';
import { computeFinancialOverview, parseTransactionAmount } from './utils/financialCalculations';
import { Loader2 } from 'lucide-react';

type ActiveView =
  | 'home'
  | 'distribution'
  | 'transactions'
  | 'settings'
  | 'upload'
  | 'categories'
  | 'export_import';

export const App: React.FC = () => {
  // Navigation & View State
  const [activeView, setActiveView] = useState<ActiveView>('home');
  const [categoryFilterForTransactions, setCategoryFilterForTransactions] = useState<string | undefined>(undefined);

  // Tier 1 State (loaded on demand)
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false);
  const [modelStats, setModelStats] = useState<ModelStats | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isTrainingModalOpen, setIsTrainingModalOpen] = useState<boolean>(false);
  const [hasPendingTraining, setHasPendingTraining] = useState<boolean>(false);

  // Tier 2 State (loaded on demand)
  const [tier2LoadingState, setTier2LoadingState] = useState<Tier2LoadingState>({
    status: 'idle',
    progress: 0,
  });

  // Classification Strategy Controls
  const [useTier1, setUseTier1] = useState<boolean>(true);
  const [tier1Threshold, setTier1Threshold] = useState<number>(0.85);

  // Data & Processing State
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingProgress, setProcessingProgress] = useState<string>('');
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<ProcessedTransaction[]>([]);
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [, setSummary] = useState<BatchProcessingSummary | null>(null);

  const engineTier1Ref = useRef<MySpendLensTier1Engine | null>(null);
  const engineTier2Ref = useRef<MySpendLensTier2Engine | null>(null);

  // 1. Initial Mount: Load existing transactions and categories from IndexedDB (Zero model downloads)
  useEffect(() => {
    const initDb = async () => {
      try {
        await migrateFromLocalStorageIfNeeded();

        // Load categories
        const storedCats = await getAllCategoriesFromDB();
        setCategories(storedCats);
        registerDynamicCategories(storedCats);

        // Load app settings (Tier 1 strategy & threshold)
        const savedSettings = await getAppSettingsFromDB();
        if (savedSettings) {
          if (typeof savedSettings.useTier1 === 'boolean') {
            setUseTier1(savedSettings.useTier1);
          }
          if (typeof savedSettings.tier1Threshold === 'number') {
            setTier1Threshold(savedSettings.tier1Threshold);
          }
        }

        const stored = await getAllTransactionsFromDB();
        if (stored.length > 0) {
          // Normalize existing positive movements to 'Income' (incomes should not be classified as expenses)
          let hasIncomeFix = false;
          const normalized = stored.map((t) => {
            if (parseTransactionAmount(t.amount) > 0 && t.category !== 'Income') {
              hasIncomeFix = true;
              return {
                ...t,
                category: 'Income',
                sourceTier: 'Income' as const,
                confidence: 1.0,
                probabilities: { Income: 1.0 },
              };
            }
            return t;
          });
          if (hasIncomeFix) {
            await updateTransactionsInDB(normalized);
          }
          setTransactions(normalized);
          setHasPendingTraining(true);
        }
      } catch (e) {
        console.warn('Could not read from IndexedDB:', e);
      }
    };
    initDb();
  }, []);

  // Set of fingerprints for fast duplicate check during multi-file upload
  const existingFingerprints = useMemo(() => {
    const set = new Set<string>();
    for (const t of transactions) {
      set.add(generateTransactionFingerprint(t.date, t.rawDescription, t.amount));
    }
    return set;
  }, [transactions]);

  // 2. Android Hardware Back Button & Browser History Interception
  useEffect(() => {
    // Initialize base history state on first mount
    if (!window.history.state || !window.history.state.myspendlens) {
      window.history.replaceState({ myspendlens: true, view: 'home' }, '');
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state;
      if (state && state.myspendlens) {
        setActiveView(state.view || 'home');
        if (state.categoryFilter !== undefined) {
          setCategoryFilterForTransactions(state.categoryFilter);
        }
      } else {
        setActiveView('home');
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Safe navigation handlers that push history
  const navigateToView = useCallback((targetView: ActiveView, categoryFilter?: string) => {
    setActiveView(targetView);
    setCategoryFilterForTransactions(categoryFilter);
    window.history.pushState(
      { myspendlens: true, view: targetView, categoryFilter },
      ''
    );
  }, []);

  const handleNavigateBack = useCallback(() => {
    if (window.history.state && window.history.state.myspendlens && window.history.state.view !== 'home') {
      window.history.back();
    } else {
      setActiveView('home');
    }
  }, []);

  const handleGoHome = useCallback(() => {
    setActiveView('home');
    setCategoryFilterForTransactions(undefined);
    window.history.pushState(
      { myspendlens: true, view: 'home' },
      ''
    );
  }, []);

  // Computed Financial Overview (IN, OUT, last movement date, segmented bar)
  const financialOverview = useMemo(() => {
    return computeFinancialOverview(transactions, 60);
  }, [transactions]);

  // Lazy loaders for ML engines (only invoked when an actual file is processed or re-classified)
  const ensureTier1Engine = useCallback(async (): Promise<MySpendLensTier1Engine> => {
    if (engineTier1Ref.current) return engineTier1Ref.current;

    setIsLoadingModel(true);
    setProcessingProgress('Loading Tier 1 base model...');
    try {
      // 1. Check if a custom or learned Tier 1 model is stored in IndexedDB
      let artifact: Tier1ModelArtifact | null = await getCustomTier1ModelFromDB();
      if (!artifact || !artifact.weights || !artifact.vocabulary) {
        const res = await fetch('/myspendlens_tier1_base_model.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        artifact = await res.json();
      }
      if (!artifact) throw new Error('Could not load Tier 1 model artifact.');

      const engine = new MySpendLensTier1Engine(artifact);
      engineTier1Ref.current = engine;

      setModelStats({
        version: artifact.version,
        featuresCount: artifact.metrics.num_features,
        classesCount: artifact.metrics.num_classes,
        validationAccuracy: artifact.metrics.validation_accuracy,
        countries: artifact.config.countries,
      });
      setIsLoadingModel(false);
      return engine;
    } catch (err) {
      console.error('Tier 1 load error:', err);
      setModelError((err as Error).message);
      setIsLoadingModel(false);
      throw err;
    }
  }, []);

  const ensureTier2Engine = useCallback(async (): Promise<MySpendLensTier2Engine> => {
    if (engineTier2Ref.current && engineTier2Ref.current.isReady) {
      return engineTier2Ref.current;
    }

    setTier2LoadingState({
      status: 'downloading',
      progress: 5,
      message: 'Initializing Transformers.js...',
    });
    setProcessingProgress('Loading multilingual embedding engine...');

    try {
      const t2Engine = engineTier2Ref.current || new MySpendLensTier2Engine();
      engineTier2Ref.current = t2Engine;

      await t2Engine.init((p: Tier2ProgressInfo) => {
        if (p.status === 'progress' && p.progress !== undefined) {
          setTier2LoadingState({
            status: 'downloading',
            file: p.file,
            progress: p.progress,
            loadedBytes: p.loaded,
            totalBytes: p.total,
          });
          setProcessingProgress(`Loading Tier 2: ${Math.round(p.progress)}%`);
        } else if (p.status === 'done') {
          setTier2LoadingState((prev) => ({
            ...prev,
            status: 'downloading',
            progress: 98,
            file: p.file,
          }));
        }
      }, categories);

      setTier2LoadingState({
        status: 'ready',
        progress: 100,
        message: 'Model loaded in memory.',
      });
      return t2Engine;
    } catch (err) {
      console.error('Tier 2 load error:', err);
      setTier2LoadingState({
        status: 'error',
        progress: 0,
        message: (err as Error).message,
      });
      throw err;
    }
  }, []);

  // Core batch classification engine: evaluates rows through Tier 1 and Tier 2 fallback
  const classifyRows = useCallback(
    async (
      rows: RawRow[],
      tier1Active: boolean,
      threshold: number
    ): Promise<ProcessedTransaction[]> => {
      if (rows.length === 0) return [];

      const tStartBatch = performance.now();
      let totalConfidence = 0;
      let tier1Count = 0;
      let tier2Count = 0;
      const categoryCounts: Record<string, number> = {};

      let t1Engine: MySpendLensTier1Engine | null = null;
      let t2Engine: MySpendLensTier2Engine | null = null;

      if (tier1Active) {
        t1Engine = await ensureTier1Engine();
      } else {
        t2Engine = await ensureTier2Engine();
      }

      const processed: ProcessedTransaction[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Positive movements (incomes) must NOT be classified (app is for tracking expenses)
        const parsedAmount = parseTransactionAmount(row.amount);
        if (parsedAmount > 0) {
          processed.push({
            id: `tx-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            originalIndex: i,
            date: row.date,
            amount: row.amount,
            rawDescription: row.description,
            category: 'Income',
            systemCategory: 'Income',
            confidence: 1.0,
            probabilities: { Income: 1.0 },
            inferenceTimeMs: 0,
            sourceTier: 'Income',
            tier1Result: undefined,
            tier2Result: undefined,
          });
          categoryCounts['Income'] = (categoryCounts['Income'] || 0) + 1;
          continue;
        }

        setProcessingProgress(`Classifying ${i + 1} of ${rows.length}...`);

        let chosenCategory = '';
        let chosenConfidence = 0;
        let chosenProbabilities: Record<string, number> = {};
        let chosenSourceTier: 'Tier 1' | 'Tier 2 (Fallback)' | 'Tier 2 (Solo)' = 'Tier 1';
        let txInferenceTime = 0;

        let t1Result: ProcessedTransaction['tier1Result'] = undefined;
        let t2Result: ProcessedTransaction['tier2Result'] = undefined;

        // Run Tier 1 if enabled
        if (tier1Active && t1Engine) {
          const pred1 = t1Engine.predict(row.description);
          t1Result = {
            category: pred1.category,
            confidence: pred1.confidence,
            probabilities: pred1.probabilities,
            inferenceTimeMs: pred1.inferenceTimeMs,
          };

          if (pred1.confidence >= threshold) {
            chosenCategory = pred1.category;
            chosenConfidence = pred1.confidence;
            chosenProbabilities = pred1.probabilities;
            chosenSourceTier = 'Tier 1';
            txInferenceTime = pred1.inferenceTimeMs;
            tier1Count++;
          } else {
            // On-demand escalation to Tier 2 (Fallback)
            if (!t2Engine) {
              setProcessingProgress(`Loading Tier 2 for low-confidence description...`);
              t2Engine = await ensureTier2Engine();
            }
            const pred2 = await t2Engine.predict(row.description);
            t2Result = {
              category: pred2.category,
              confidence: pred2.confidence,
              probabilities: pred2.probabilities,
              cosineSimilarities: pred2.cosineSimilarities,
              inferenceTimeMs: pred2.inferenceTimeMs,
            };

            chosenCategory = pred2.category;
            chosenConfidence = pred2.confidence;
            chosenProbabilities = pred2.probabilities;
            chosenSourceTier = 'Tier 2 (Fallback)';
            txInferenceTime = pred1.inferenceTimeMs + pred2.inferenceTimeMs;
            tier2Count++;
          }
        } else if (t2Engine && t2Engine.isReady) {
          // Tier 1 is disabled -> Baseline only Tier 2
          const pred2 = await t2Engine.predict(row.description);
          t2Result = {
            category: pred2.category,
            confidence: pred2.confidence,
            probabilities: pred2.probabilities,
            cosineSimilarities: pred2.cosineSimilarities,
            inferenceTimeMs: pred2.inferenceTimeMs,
          };

          if (t1Engine) {
            const pred1 = t1Engine.predict(row.description);
            t1Result = {
              category: pred1.category,
              confidence: pred1.confidence,
              probabilities: pred1.probabilities,
              inferenceTimeMs: pred1.inferenceTimeMs,
            };
          }

          chosenCategory = pred2.category;
          chosenConfidence = pred2.confidence;
          chosenProbabilities = pred2.probabilities;
          chosenSourceTier = 'Tier 2 (Solo)';
          txInferenceTime = pred2.inferenceTimeMs;
          tier2Count++;
        } else if (t1Engine) {
          const pred1 = t1Engine.predict(row.description);
          chosenCategory = pred1.category;
          chosenConfidence = pred1.confidence;
          chosenProbabilities = pred1.probabilities;
          chosenSourceTier = 'Tier 1';
          txInferenceTime = pred1.inferenceTimeMs;
          tier1Count++;
        }

        totalConfidence += chosenConfidence;
        categoryCounts[chosenCategory] = (categoryCounts[chosenCategory] || 0) + 1;

        processed.push({
          id: `tx-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
          originalIndex: i,
          date: row.date,
          amount: row.amount,
          rawDescription: row.description,
          cleanedDescription: t2Engine ? t2Engine.cleanDescription(row.description) : undefined,
          category: chosenCategory,
          systemCategory: chosenCategory,
          confidence: chosenConfidence,
          probabilities: chosenProbabilities,
          inferenceTimeMs: txInferenceTime,
          sourceTier: chosenSourceTier,
          tier1Result: t1Result,
          tier2Result: t2Result,
        });
      }

      const totalTimeMs = performance.now() - tStartBatch;
      setSummary({
        totalProcessed: processed.length,
        totalTimeMs,
        avgTimeMs: totalTimeMs / processed.length,
        avgConfidence: totalConfidence / processed.length,
        tier1Count,
        tier2Count,
        categoryCounts,
      });

      return processed;
    },
    [ensureTier1Engine, ensureTier2Engine]
  );

  // Confirms import of mapped CSV rows, classifies new items, and persists into IndexedDB
  const handleConfirmImport = async (
    newRows: RawRow[],
    fileName: string,
    totalInFile: number,
    _skippedDuplicates: number
  ) => {
    if (newRows.length === 0) {
      alert(`All ${totalInFile} movements in "${fileName}" are already stored in your local database (duplicates skipped).`);
      return;
    }

    setIsProcessing(true);
    try {
      setProcessingProgress(`Classifying ${newRows.length} new movements...`);
      const classified = await classifyRows(newRows, useTier1, tier1Threshold);
      await addTransactionsToDB(classified, fileName);

      // Refresh transactions state directly from IndexedDB
      const allUpdated = await getAllTransactionsFromDB();
      setTransactions(allUpdated);
      setLoadedFileName(fileName);
      setHasPendingTraining(true);
      console.info(`Imported ${classified.length} transactions (${_skippedDuplicates} duplicates skipped).`);
      navigateToView('transactions');
    } catch (err) {
      console.error('Import error:', err);
      alert(`Error importing transactions: ${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
      setProcessingProgress('');
    }
  };

  // Re-classifies all current transactions stored in IndexedDB with current strategy settings
  const handleReclassify = async () => {
    if (transactions.length === 0) return;
    setIsProcessing(true);
    try {
      const rowsToReclassify: RawRow[] = transactions.map((t) => ({
        date: t.date,
        description: t.rawDescription,
        amount: t.amount,
      }));

      const reclassified = await classifyRows(rowsToReclassify, useTier1, tier1Threshold);

      // Preserve existing IDs and update IndexedDB
      const updatedWithIds: ProcessedTransaction[] = reclassified.map((item, idx) => ({
        ...item,
        id: transactions[idx]?.id || item.id,
      }));

      await updateTransactionsInDB(updatedWithIds);
      const allUpdated = await getAllTransactionsFromDB();
      setTransactions(allUpdated);
    } catch (err) {
      console.error('Reclassification error:', err);
      alert(`Error re-classifying: ${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
      setProcessingProgress('');
    }
  };

  const handleToggleTier1 = async (enabled: boolean) => {
    setUseTier1(enabled);
    try {
      await saveAppSettingsToDB({ useTier1: enabled, tier1Threshold });
    } catch (e) {
      console.warn('Could not persist setting useTier1:', e);
    }
  };

  const handleChangeThreshold = async (threshold: number) => {
    setTier1Threshold(threshold);
    try {
      await saveAppSettingsToDB({ useTier1, tier1Threshold: threshold });
    } catch (e) {
      console.warn('Could not persist setting tier1Threshold:', e);
    }
  };

  // Clears all records from IndexedDB and storage
  const handleClearDatabase = async () => {
    setIsProcessing(true);
    try {
      await clearAllTransactionsInDB();
      setTransactions([]);
      setLoadedFileName(null);
      setHasPendingTraining(false);
      setActiveView('home');
    } catch (err) {
      console.error('Failed to clear database:', err);
      alert(`Error clearing database: ${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Factory reset: resets transactions, categories, models and configurations
  const handleFactoryReset = async () => {
    setIsProcessing(true);
    try {
      await factoryResetAppInDB();
      setTransactions([]);
      setLoadedFileName(null);
      setCategories(DEFAULT_CATEGORY_DEFINITIONS);
      registerDynamicCategories(DEFAULT_CATEGORY_DEFINITIONS);
      setUseTier1(true);
      setTier1Threshold(0.85);
      setHasPendingTraining(false);

      // Reset Tier 1 in memory
      try {
        const res = await fetch('/myspendlens_tier1_base_model.json');
        if (res.ok) {
          const artifact: Tier1ModelArtifact = await res.json();
          engineTier1Ref.current = new MySpendLensTier1Engine(artifact);
          setModelStats({
            version: artifact.version,
            featuresCount: artifact.metrics.num_features,
            classesCount: artifact.metrics.num_classes,
            validationAccuracy: artifact.metrics.validation_accuracy,
            countries: artifact.config.countries,
          });
        }
      } catch (e) {
        console.warn('Could not reload base tier 1 model JSON:', e);
      }

      if (engineTier2Ref.current?.isReady) {
        await engineTier2Ref.current.syncDynamicCategories(DEFAULT_CATEGORY_DEFINITIONS);
      }

      setActiveView('home');
    } catch (err) {
      console.error('Failed to factory reset app:', err);
      alert(`Error during reset: ${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Deletes a single transaction from database and state
  const handleDeleteTransaction = useCallback(async (id: string) => {
    try {
      await deleteTransactionFromDB(id);
      setTransactions((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Failed to delete transaction:', err);
      alert(`Error deleting transaction: ${(err as Error).message}`);
    }
  }, []);

  // Manually sets/updates category for a transaction
  const handleUpdateTransactionCategory = useCallback(
    async (id: string, newCategory: string) => {
      try {
        const tx = transactions.find((t) => t.id === id);
        if (!tx) return;

        const systemCategory =
          tx.systemCategory ||
          tx.tier2Result?.category ||
          tx.tier1Result?.category ||
          (tx.sourceTier === 'Income' ? 'Income' : tx.category);

        const updatedTx: ProcessedTransaction = {
          ...tx,
          category: newCategory,
          systemCategory,
          sourceTier: 'Manual',
          confidence: 1.0,
          probabilities: { [newCategory]: 1.0 },
        };

        await updateSingleTransactionInDB(updatedTx);
        setTransactions((prev) => prev.map((t) => (t.id === id ? updatedTx : t)));
        setHasPendingTraining(true);
      } catch (err) {
        console.error('Failed to update category:', err);
        alert(`Error updating category: ${(err as Error).message}`);
      }
    },
    [transactions]
  );

  // Category management handlers
  const handleSaveCategory = useCallback(async (cat: CategoryDefinition) => {
    try {
      await saveCategoryToDB(cat);
      const updatedCats = await getAllCategoriesFromDB();
      setCategories(updatedCats);
      registerDynamicCategories(updatedCats);
      setHasPendingTraining(true);
      if (engineTier2Ref.current?.isReady) {
        await engineTier2Ref.current.syncDynamicCategories(updatedCats);
      }
    } catch (err) {
      console.error('Failed to save category:', err);
      alert(`Error saving category: ${(err as Error).message}`);
    }
  }, []);

  const handleRenameCategory = useCallback(
    async (oldName: string, updatedCategory: CategoryDefinition) => {
      try {
        await renameCategoryInDB(oldName, updatedCategory);
        const updatedCats = await getAllCategoriesFromDB();
        const updatedTxs = await getAllTransactionsFromDB();
        setCategories(updatedCats);
        setTransactions(updatedTxs);
        registerDynamicCategories(updatedCats);
        setHasPendingTraining(true);
        if (engineTier2Ref.current?.isReady) {
          await engineTier2Ref.current.syncDynamicCategories(updatedCats);
        }
      } catch (err) {
        console.error('Failed to rename category:', err);
        alert(`Error renaming category: ${(err as Error).message}`);
      }
    },
    []
  );

  const handleDeleteCategory = useCallback(async (id: string) => {
    try {
      await deleteCategoryFromDB(id);
      const updatedCats = await getAllCategoriesFromDB();
      setCategories(updatedCats);
      registerDynamicCategories(updatedCats);
      setHasPendingTraining(true);
      if (engineTier2Ref.current?.isReady) {
        await engineTier2Ref.current.syncDynamicCategories(updatedCats);
      }
    } catch (err) {
      console.error('Failed to delete category:', err);
      alert(`Error deleting category: ${(err as Error).message}`);
    }
  }, []);

  const handleReassignCategory = useCallback(
    async (oldCategory: string, newCategory: string, categoryIdToDelete?: string) => {
      try {
        await reassignCategoryInDB(oldCategory, newCategory, categoryIdToDelete);
        const updatedCats = await getAllCategoriesFromDB();
        const updatedTxs = await getAllTransactionsFromDB();
        setCategories(updatedCats);
        setTransactions(updatedTxs);
        registerDynamicCategories(updatedCats);
        setHasPendingTraining(true);
        if (engineTier2Ref.current?.isReady) {
          await engineTier2Ref.current.syncDynamicCategories(updatedCats);
        }
      } catch (err) {
        console.error('Failed to reassign category:', err);
        alert(`Error reassigning category: ${(err as Error).message}`);
      }
    },
    []
  );

  // Backup & Restore handler
  const handleRestoreAll = useCallback(
    async (data: {
      transactions?: ProcessedTransaction[];
      categories?: CategoryDefinition[];
      config?: { useTier1?: boolean; tier1Threshold?: number };
      tier1Artifact?: Tier1ModelArtifact;
      replaceTransactions?: boolean;
    }) => {
      let txCount = 0;
      let catCount = 0;

      // 1. Transactions
      if (data.transactions && data.transactions.length > 0) {
        if (data.replaceTransactions) {
          await replaceAllTransactionsInDB(data.transactions);
          setTransactions(data.transactions);
          txCount = data.transactions.length;
        } else {
          await addTransactionsToDB(data.transactions, 'imported_backup');
          const updatedTxs = await getAllTransactionsFromDB();
          setTransactions(updatedTxs);
          txCount = data.transactions.length;
        }
      }

      // 2. Categories
      if (data.categories && data.categories.length > 0) {
        await replaceAllCategoriesInDB(data.categories);
        setCategories(data.categories);
        registerDynamicCategories(data.categories);
        catCount = data.categories.length;
        if (engineTier2Ref.current?.isReady) {
          await engineTier2Ref.current.syncDynamicCategories(data.categories);
        }
      }

      // 3. Config
      if (data.config) {
        if (typeof data.config.useTier1 === 'boolean') {
          setUseTier1(data.config.useTier1);
        }
        if (typeof data.config.tier1Threshold === 'number') {
          setTier1Threshold(data.config.tier1Threshold);
        }
        await saveAppSettingsToDB({
          useTier1: data.config.useTier1,
          tier1Threshold: data.config.tier1Threshold,
        });
      }

      // 4. Tier 1 Model
      if (data.tier1Artifact) {
        await saveCustomTier1ModelToDB(data.tier1Artifact);
        const newEngine = new MySpendLensTier1Engine(data.tier1Artifact);
        engineTier1Ref.current = newEngine;
        setModelStats({
          version: data.tier1Artifact.version,
          featuresCount: data.tier1Artifact.metrics.num_features,
          classesCount: data.tier1Artifact.metrics.num_classes,
          validationAccuracy: data.tier1Artifact.metrics.validation_accuracy,
          countries: data.tier1Artifact.config.countries,
        });
      }

      setHasPendingTraining(true);
      return { transactionsAdded: txCount, categoriesSaved: catCount };
    },
    []
  );

  const handleTrainingComplete = useCallback(async () => {
    if (engineTier1Ref.current) {
      await saveCustomTier1ModelToDB(engineTier1Ref.current.getArtifact());
      setModelStats({
        version: engineTier1Ref.current.getArtifact().version,
        featuresCount: engineTier1Ref.current.getArtifact().metrics.num_features,
        classesCount: engineTier1Ref.current.getArtifact().metrics.num_classes,
        validationAccuracy: engineTier1Ref.current.getArtifact().metrics.validation_accuracy,
        countries: engineTier1Ref.current.getArtifact().config.countries,
      });
    }
    setHasPendingTraining(false);
  }, []);

  return (
    <div className="mobile-app-layout">
      {/* Sleek Mobile Header */}
      <Header
        isLoadingModel={isLoadingModel}
        modelError={modelError}
        tier2LoadingState={tier2LoadingState}
        isProcessing={isProcessing}
        onGoHome={handleGoHome}
        hasPendingTraining={hasPendingTraining}
        onOpenTrainingModal={() => setIsTrainingModalOpen(true)}
      />

      {/* Main Mobile Viewport */}
      <main className="mobile-main-viewport">
        {/* View Routing */}
        {activeView === 'home' && (
          <div className="mobile-home-content">
            {/* Metà schermo con dati di base: Ultimo movimento, IN/OUT 60gg, barra multicolor */}
            <HomeHeroOverview
              overview={financialOverview}
              onOpenDistribution={() => navigateToView('distribution')}
            />

            {/* Griglia Azioni: Upload, Distribuzione, Movimenti, Categories, Settings, Export/Import */}
            <ActionGrid
              onOpenUpload={() => navigateToView('upload')}
              onOpenDistribution={() => navigateToView('distribution')}
              onOpenTransactions={() => navigateToView('transactions')}
              onOpenCategories={() => navigateToView('categories')}
              onOpenSettings={() => navigateToView('settings')}
              onOpenExportImport={() => navigateToView('export_import')}
              totalTransactions={transactions.length}
              categoriesCount={categories.filter((c) => c.isActive).length}
              useTier1={useTier1}
              tier2Ready={tier2LoadingState.status === 'ready'}
            />
          </div>
        )}

        {activeView === 'upload' && (
          <UploadView
            onConfirmImport={handleConfirmImport}
            existingFingerprints={existingFingerprints}
            disabled={isProcessing}
            totalLoaded={transactions.length}
            onCancel={handleNavigateBack}
          />
        )}

        {activeView === 'distribution' && (
          <ExpensesDistributionView
            overview={financialOverview}
            transactions={transactions}
            onFilterByCategory={(cat) => navigateToView('transactions', cat)}
          />
        )}

        {activeView === 'transactions' && (
          <TransactionsTable
            transactions={transactions}
            categories={categories}
            fileName={loadedFileName}
            initialCategory={categoryFilterForTransactions}
            onDeleteTransaction={handleDeleteTransaction}
            onUpdateTransactionCategory={handleUpdateTransactionCategory}
          />
        )}

        {activeView === 'categories' && (
          <CategoriesView
            categories={categories}
            transactions={transactions}
            onSaveCategory={handleSaveCategory}
            onRenameCategory={handleRenameCategory}
            onDeleteCategory={handleDeleteCategory}
            onReassignCategory={handleReassignCategory}
          />
        )}

        {activeView === 'export_import' && (
          <ExportImportView
            transactions={transactions}
            categories={categories}
            useTier1={useTier1}
            tier1Threshold={tier1Threshold}
            tier1Artifact={engineTier1Ref.current ? engineTier1Ref.current.getArtifact() : null}
            onRestoreAll={handleRestoreAll}
          />
        )}

        {activeView === 'settings' && (
          <SettingsView
            useTier1={useTier1}
            onToggleTier1={handleToggleTier1}
            tier1Threshold={tier1Threshold}
            onChangeThreshold={handleChangeThreshold}
            tier1Stats={modelStats}
            tier2State={tier2LoadingState}
            isProcessing={isProcessing}
            onReclassify={handleReclassify}
            hasTransactions={transactions.length > 0}
            totalTransactions={transactions.length}
            onClearDatabase={handleClearDatabase}
            onFactoryReset={handleFactoryReset}
            onOpenCategories={() => navigateToView('categories')}
          />
        )}

        {/* Processing Indicator Modal / Overlay */}
        {isProcessing && (
          <div className="mobile-processing-overlay">
            <div className="mobile-processing-card">
              <Loader2 size={24} className="spinner text-primary" />
              <span>{processingProgress || 'Classifying transactions...'}</span>
            </div>
          </div>
        )}
      </main>

      {/* Tier 1 Personal Training Modal */}
      <Tier1TrainingModal
        isOpen={isTrainingModalOpen}
        onClose={() => setIsTrainingModalOpen(false)}
        transactions={transactions}
        categories={categories}
        tier1Engine={engineTier1Ref.current}
        tier2Engine={engineTier2Ref.current}
        ensureTier1Engine={ensureTier1Engine}
        ensureTier2Engine={ensureTier2Engine}
        onTrainingComplete={handleTrainingComplete}
      />
    </div>
  );
};
