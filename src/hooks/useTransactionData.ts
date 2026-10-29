import { useState, useEffect, useCallback, useMemo } from 'react';
import { ProcessedTransaction } from '../types';
import {
  CategoryDefinition,
  DEFAULT_CATEGORY_DEFINITIONS,
  registerDynamicCategories,
} from '../utils/categories';
import {
  getAllTransactionsFromDB,
  addTransactionsToDB,
  batchMergeTransactionsInDB,
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
  factoryResetAppInDB,
} from '../db/transactionDb';
import {
  computeFinancialOverview,
  parseTransactionAmount,
} from '../utils/financialCalculations';
import { RawRow } from '../utils/csvParser';
import { Tier1ModelArtifact } from '../engine/tier1_browser_engine';

interface UseTransactionDataOptions {
  onSettingsLoaded?: (settings: { useTier1?: boolean; tier1Threshold?: number }) => void;
}

export function useTransactionData(options: UseTransactionDataOptions = {}) {
  const [transactions, setTransactions] = useState<ProcessedTransaction[]>([]);
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [processingProgress, setProcessingProgress] = useState<string>('');
  const [hasPendingTraining, setHasPendingTraining] = useState<boolean>(false);

  // Persists pending training flag to IndexedDB app_settings so it survives page reloads
  const updatePendingTraining = useCallback(async (pending: boolean) => {
    setHasPendingTraining(pending);
    try {
      const current = (await getAppSettingsFromDB()) || {};
      await saveAppSettingsToDB({ ...current, hasPendingTraining: pending });
    } catch (e) {
      console.warn('Could not persist pending training flag:', e);
    }
  }, []);

  // 1. Initial Mount: Load existing transactions, categories, and settings from IndexedDB
  useEffect(() => {
    const initDb = async () => {
      try {
        await migrateFromLocalStorageIfNeeded();

        // Load categories
        const storedCats = await getAllCategoriesFromDB();
        setCategories(storedCats);
        registerDynamicCategories(storedCats);

        // Load app settings
        const savedSettings = await getAppSettingsFromDB();
        if (savedSettings) {
          options.onSettingsLoaded?.({
            useTier1: savedSettings.useTier1,
            tier1Threshold: savedSettings.tier1Threshold,
          });
          if (typeof savedSettings.hasPendingTraining === 'boolean') {
            setHasPendingTraining(savedSettings.hasPendingTraining);
          }
        }

        // Load transactions and normalize any legacy incomes
        const stored = await getAllTransactionsFromDB();
        if (stored.length > 0) {
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
        }
      } catch (e) {
        console.warn('Could not read from IndexedDB:', e);
      }
    };
    initDb();
  }, []);

  // Fast duplicate check set for file uploads with multiset occurrence indexing
  const existingFingerprints = useMemo(() => {
    const set = new Set<string>();
    const counts = new Map<string, number>();
    for (const t of transactions) {
      if (t.fingerprint) {
        set.add(t.fingerprint);
      } else {
        const baseFp = generateTransactionFingerprint(t.date, t.rawDescription, t.amount);
        const occ = counts.get(baseFp) ?? 0;
        counts.set(baseFp, occ + 1);
        set.add(occ > 0 ? `${baseFp}#${occ}` : baseFp);
      }
    }
    return set;
  }, [transactions]);

  // Computed financial overview
  const financialOverview = useMemo(() => {
    return computeFinancialOverview(transactions, 60);
  }, [transactions]);

  // Import flow
  const handleConfirmImport = useCallback(
    async (
      newRows: RawRow[],
      fileName: string,
      totalInFile: number,
      _skippedDuplicates: number,
      classifyFn: (rows: RawRow[], onProgress: (msg: string) => void) => Promise<ProcessedTransaction[]>,
      onSuccessNavigation?: () => void
    ) => {
      if (newRows.length === 0) {
        alert(`All ${totalInFile} transactions in "${fileName}" are already stored in your local database (duplicates skipped).`);
        return;
      }

      setIsProcessing(true);
      try {
        setProcessingProgress(`Classifying ${newRows.length} new transactions...`);
        const classified = await classifyFn(newRows, (msg) => setProcessingProgress(msg));
        await addTransactionsToDB(classified, fileName);

        const allUpdated = await getAllTransactionsFromDB();
        setTransactions(allUpdated);
        setLoadedFileName(fileName);
        await updatePendingTraining(true);
        onSuccessNavigation?.();
      } catch (err) {
        console.error('Import error:', err);
        alert(`Error importing transactions: ${(err as Error).message}`);
      } finally {
        setIsProcessing(false);
        setProcessingProgress('');
      }
    },
    [updatePendingTraining]
  );

  // Re-classify all records
  const handleReclassify = useCallback(
    async (
      classifyFn: (rows: RawRow[], onProgress: (msg: string) => void) => Promise<ProcessedTransaction[]>
    ) => {
      if (transactions.length === 0) return;
      setIsProcessing(true);
      try {
        const rowsToReclassify: RawRow[] = transactions.map((t) => ({
          date: t.date,
          description: t.rawDescription,
          amount: t.amount,
        }));

        const reclassified = await classifyFn(rowsToReclassify, (msg) => setProcessingProgress(msg));

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
    },
    [transactions]
  );

  // Transaction single delete
  const handleDeleteTransaction = useCallback(async (id: string) => {
    try {
      await deleteTransactionFromDB(id);
      setTransactions((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      console.error('Failed to delete transaction:', err);
      alert(`Error deleting transaction: ${(err as Error).message}`);
    }
  }, []);

  // Update single transaction category manually
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
        await updatePendingTraining(true);
      } catch (err) {
        console.error('Failed to update category:', err);
        alert(`Error updating category: ${(err as Error).message}`);
      }
    },
    [transactions, updatePendingTraining]
  );

  // Category management handlers
  const handleSaveCategory = useCallback(
    async (cat: CategoryDefinition, onSyncTier2?: (cats: CategoryDefinition[]) => Promise<void>) => {
      try {
        await saveCategoryToDB(cat);
        const updatedCats = await getAllCategoriesFromDB();
        setCategories(updatedCats);
        registerDynamicCategories(updatedCats);
        await updatePendingTraining(true);
        if (onSyncTier2) {
          await onSyncTier2(updatedCats);
        }
      } catch (err) {
        console.error('Failed to save category:', err);
        alert(`Error saving category: ${(err as Error).message}`);
      }
    },
    [updatePendingTraining]
  );

  const handleRenameCategory = useCallback(
    async (
      oldName: string,
      updatedCategory: CategoryDefinition,
      onSyncTier2?: (cats: CategoryDefinition[]) => Promise<void>
    ) => {
      try {
        await renameCategoryInDB(oldName, updatedCategory);
        const updatedCats = await getAllCategoriesFromDB();
        const updatedTxs = await getAllTransactionsFromDB();
        setCategories(updatedCats);
        setTransactions(updatedTxs);
        registerDynamicCategories(updatedCats);
        await updatePendingTraining(true);
        if (onSyncTier2) {
          await onSyncTier2(updatedCats);
        }
      } catch (err) {
        console.error('Failed to rename category:', err);
        alert(`Error renaming category: ${(err as Error).message}`);
      }
    },
    [updatePendingTraining]
  );

  const handleDeleteCategory = useCallback(
    async (id: string, onSyncTier2?: (cats: CategoryDefinition[]) => Promise<void>) => {
      try {
        await deleteCategoryFromDB(id);
        const updatedCats = await getAllCategoriesFromDB();
        setCategories(updatedCats);
        registerDynamicCategories(updatedCats);
        await updatePendingTraining(true);
        if (onSyncTier2) {
          await onSyncTier2(updatedCats);
        }
      } catch (err) {
        console.error('Failed to delete category:', err);
        alert(`Error deleting category: ${(err as Error).message}`);
      }
    },
    [updatePendingTraining]
  );

  const handleReassignCategory = useCallback(
    async (
      oldCategory: string,
      newCategory: string,
      categoryIdToDelete?: string,
      onSyncTier2?: (cats: CategoryDefinition[]) => Promise<void>
    ) => {
      try {
        await reassignCategoryInDB(oldCategory, newCategory, categoryIdToDelete);
        const updatedCats = await getAllCategoriesFromDB();
        const updatedTxs = await getAllTransactionsFromDB();
        setCategories(updatedCats);
        setTransactions(updatedTxs);
        registerDynamicCategories(updatedCats);
        await updatePendingTraining(true);
        if (onSyncTier2) {
          await onSyncTier2(updatedCats);
        }
      } catch (err) {
        console.error('Failed to reassign category:', err);
        alert(`Error reassigning category: ${(err as Error).message}`);
      }
    },
    [updatePendingTraining]
  );

  // Clear all database records
  const handleClearDatabase = useCallback(async () => {
    setIsProcessing(true);
    try {
      await clearAllTransactionsInDB();
      setTransactions([]);
      setLoadedFileName(null);
      await updatePendingTraining(false);
    } catch (err) {
      console.error('Failed to clear database:', err);
      alert(`Error clearing database: ${(err as Error).message}`);
    } finally {
      setIsProcessing(false);
    }
  }, [updatePendingTraining]);

  // Factory reset
  const handleFactoryReset = useCallback(
    async (
      onResetEngines?: () => Promise<void>
    ) => {
      setIsProcessing(true);
      try {
        await factoryResetAppInDB();
        setTransactions([]);
        setLoadedFileName(null);
        setCategories(DEFAULT_CATEGORY_DEFINITIONS);
        registerDynamicCategories(DEFAULT_CATEGORY_DEFINITIONS);
        await updatePendingTraining(false);

        if (onResetEngines) {
          await onResetEngines();
        }
      } catch (err) {
        console.error('Failed to factory reset app:', err);
        alert(`Error during reset: ${(err as Error).message}`);
      } finally {
        setIsProcessing(false);
      }
    },
    [updatePendingTraining]
  );

  // Backup & Restore
  const handleRestoreAll = useCallback(
    async (
      data: {
        transactions?: ProcessedTransaction[];
        categories?: CategoryDefinition[];
        config?: { useTier1?: boolean; tier1Threshold?: number };
        tier1Artifact?: Tier1ModelArtifact;
        replaceTransactions?: boolean;
      },
      onRestoreTier1Model?: (artifact: Tier1ModelArtifact) => void
    ) => {
      let txCount = 0;
      let catCount = 0;

      // 1. Transactions
      if (data.transactions && data.transactions.length > 0) {
        if (data.replaceTransactions) {
          await replaceAllTransactionsInDB(data.transactions);
          setTransactions(data.transactions);
          txCount = data.transactions.length;
        } else {
          // Single-transaction batch merge with deduplication (avoids N+1 sequential transactions)
          txCount = await batchMergeTransactionsInDB(data.transactions);
          const allTxs = await getAllTransactionsFromDB();
          setTransactions(allTxs);
        }
      }

      // 2. Categories
      if (data.categories && data.categories.length > 0) {
        await replaceAllCategoriesInDB(data.categories);
        setCategories(data.categories);
        registerDynamicCategories(data.categories);
        catCount = data.categories.length;
      }

      // 3. Settings
      if (data.config) {
        options.onSettingsLoaded?.(data.config);
        await saveAppSettingsToDB({
          useTier1: data.config.useTier1,
          tier1Threshold: data.config.tier1Threshold,
        });
      }

      // 4. Tier 1 Model Artifact
      if (data.tier1Artifact) {
        await saveCustomTier1ModelToDB(data.tier1Artifact);
        onRestoreTier1Model?.(data.tier1Artifact);
      }

      await updatePendingTraining(true);
      return { transactionsAdded: txCount, categoriesSaved: catCount };
    },
    [options, updatePendingTraining]
  );

  return {
    transactions,
    setTransactions,
    categories,
    setCategories,
    loadedFileName,
    isProcessing,
    processingProgress,
    hasPendingTraining,
    existingFingerprints,
    financialOverview,
    updatePendingTraining,
    handleConfirmImport,
    handleReclassify,
    handleDeleteTransaction,
    handleUpdateTransactionCategory,
    handleSaveCategory,
    handleRenameCategory,
    handleDeleteCategory,
    handleReassignCategory,
    handleClearDatabase,
    handleFactoryReset,
    handleRestoreAll,
  };
}
