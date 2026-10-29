import { useState, useRef, useCallback, useMemo } from 'react';
import {
  MySpendLensTier1Engine,
  Tier1ModelArtifact,
} from '../engine/tier1_browser_engine';
import {
  MySpendLensTier2Engine,
  Tier2ProgressInfo,
} from '../engine/tier2_embedding_engine';
import {
  ProcessedTransaction,
  ModelStats,
  Tier2LoadingState,
} from '../types';
import { RawRow } from '../utils/csvParser';
import { parseTransactionAmount } from '../utils/financialCalculations';
import { CategoryDefinition } from '../utils/categories';
import {
  getCustomTier1ModelFromDB,
  saveAppSettingsToDB,
} from '../db/transactionDb';

export function useClassificationEngines(
  categories: CategoryDefinition[],
  existingTransactions?: ProcessedTransaction[]
) {
  const [isLoadingModel, setIsLoadingModel] = useState<boolean>(false);
  const [modelStats, setModelStats] = useState<ModelStats | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);

  // Tier 0: Deterministic Historical Merchant Memory
  // Builds a dictionary of verified clean merchant descriptions -> category from past transactions
  const merchantMemory = useMemo(() => {
    const memory = new Map<string, string>();
    if (!existingTransactions || existingTransactions.length === 0) return memory;
    for (const tx of existingTransactions) {
      if (tx.category && tx.category !== 'Income' && tx.rawDescription) {
        const cleanKey = tx.rawDescription
          .trim()
          .toLowerCase()
          .replace(/\b(?:AUT|ID|TX|REF|MND)\b[\s:.\-]*\d[\w-]*/gi, ' ')
          .replace(/[^A-Za-zÀ-ÿ0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleanKey.length >= 3) {
          memory.set(cleanKey, tx.category);
        }
      }
    }
    return memory;
  }, [existingTransactions]);

  const [tier2LoadingState, setTier2LoadingState] = useState<Tier2LoadingState>({
    status: 'idle',
    progress: 0,
  });

  const [useTier1, setUseTier1] = useState<boolean>(true);
  const [tier1Threshold, setTier1Threshold] = useState<number>(0.85);

  const engineTier1Ref = useRef<MySpendLensTier1Engine | null>(null);
  const engineTier2Ref = useRef<MySpendLensTier2Engine | null>(null);

  // Lazy loader for Tier 1 Engine (loaded on demand)
  const ensureTier1Engine = useCallback(async (
    onProgressUpdate?: (msg: string) => void
  ): Promise<MySpendLensTier1Engine> => {
    if (engineTier1Ref.current) return engineTier1Ref.current;

    setIsLoadingModel(true);
    onProgressUpdate?.('Loading Tier 1 base model...');
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

  // Lazy loader for Tier 2 Engine (downloaded & initialized on demand)
  const ensureTier2Engine = useCallback(async (
    onProgressUpdate?: (msg: string) => void
  ): Promise<MySpendLensTier2Engine> => {
    if (engineTier2Ref.current && engineTier2Ref.current.isReady) {
      return engineTier2Ref.current;
    }

    setTier2LoadingState({
      status: 'downloading',
      progress: 5,
      message: 'Initializing Transformers.js...',
    });
    onProgressUpdate?.('Loading multilingual embedding engine...');

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
          onProgressUpdate?.(`Loading Tier 2: ${Math.round(p.progress)}%`);
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
  }, [categories]);

  // Core cascade classification logic
  const classifyRows = useCallback(
    async (
      rows: RawRow[],
      tier1Active: boolean,
      threshold: number,
      onProgressUpdate?: (msg: string) => void
    ): Promise<ProcessedTransaction[]> => {
      if (rows.length === 0) return [];

      let t1Engine: MySpendLensTier1Engine | null = null;
      let t2Engine: MySpendLensTier2Engine | null = null;

      if (tier1Active) {
        t1Engine = await ensureTier1Engine(onProgressUpdate);
      } else {
        t2Engine = await ensureTier2Engine(onProgressUpdate);
      }

      const activeCategoryNames = categories.filter((c) => c.isActive && c.name !== 'Income').map((c) => c.name);
      const processed: ProcessedTransaction[] = [];

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        // Incomes (>0) are tracked directly as Income without ML expense categorization
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
          continue;
        }

        // TIER 0: Deterministic Historical Merchant Memory (0ms, 100% confidence)
        const cleanMerchantKey = row.description
          .trim()
          .toLowerCase()
          .replace(/\b(?:AUT|ID|TX|REF|MND)\b[\s:.\-]*\d[\w-]*/gi, ' ')
          .replace(/[^A-Za-zÀ-ÿ0-9\s]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        if (cleanMerchantKey && merchantMemory.has(cleanMerchantKey)) {
          const memorizedCategory = merchantMemory.get(cleanMerchantKey)!;
          if (activeCategoryNames.includes(memorizedCategory)) {
            processed.push({
              id: `tx-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
              originalIndex: i,
              date: row.date,
              amount: row.amount,
              rawDescription: row.description,
              category: memorizedCategory,
              systemCategory: memorizedCategory,
              confidence: 1.0,
              probabilities: { [memorizedCategory]: 1.0 },
              inferenceTimeMs: 0,
              sourceTier: 'Tier 0',
              tier1Result: undefined,
              tier2Result: undefined,
            });
            continue;
          }
        }

        onProgressUpdate?.(`Classifying ${i + 1} of ${rows.length}...`);

        let chosenCategory = '';
        let chosenConfidence = 0;
        let chosenProbabilities: Record<string, number> = {};
        let chosenSourceTier: 'Tier 1' | 'Tier 2 (Fallback)' | 'Tier 2 (Solo)' = 'Tier 1';
        let txInferenceTime = 0;

        let t1Result: ProcessedTransaction['tier1Result'] = undefined;
        let t2Result: ProcessedTransaction['tier2Result'] = undefined;

        // Run Tier 1 if enabled
        if (tier1Active && t1Engine) {
          const pred1 = t1Engine.predict(row.description, activeCategoryNames);
          t1Result = {
            category: pred1.category,
            confidence: pred1.confidence,
            margin: pred1.margin,
            probabilities: pred1.probabilities,
            inferenceTimeMs: pred1.inferenceTimeMs,
          };

          // Confident only if both probability threshold is met AND runner-up margin is >= 0.15
          const isConfident = pred1.confidence >= threshold && (pred1.margin === undefined || pred1.margin >= 0.15);

          if (isConfident) {
            chosenCategory = pred1.category;
            chosenConfidence = pred1.confidence;
            chosenProbabilities = pred1.probabilities;
            chosenSourceTier = 'Tier 1';
            txInferenceTime = pred1.inferenceTimeMs;
          } else {
            // On-demand escalation to Tier 2 (Fallback)
            let tier2Success = false;
            try {
              if (!t2Engine) {
                onProgressUpdate?.('Loading Tier 2 for low-confidence description...');
                t2Engine = await ensureTier2Engine(onProgressUpdate);
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
              tier2Success = true;
            } catch (escalateErr) {
              console.warn('Tier 2 fallback escalation failed, using Tier 1 prediction:', escalateErr);
            }

            if (!tier2Success) {
              // Graceful fallback to Tier 1 prediction if Tier 2 fails (e.g. offline, network error)
              chosenCategory = pred1.category;
              chosenConfidence = pred1.confidence;
              chosenProbabilities = pred1.probabilities;
              chosenSourceTier = 'Tier 1';
              txInferenceTime = pred1.inferenceTimeMs;
            }
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
            const pred1 = t1Engine.predict(row.description, activeCategoryNames);
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
        } else if (t1Engine) {
          const pred1 = t1Engine.predict(row.description, activeCategoryNames);
          chosenCategory = pred1.category;
          chosenConfidence = pred1.confidence;
          chosenProbabilities = pred1.probabilities;
          chosenSourceTier = 'Tier 1';
          txInferenceTime = pred1.inferenceTimeMs;
        }

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

      return processed;
    },
    [categories, merchantMemory, ensureTier1Engine, ensureTier2Engine]
  );

  const handleToggleTier1 = useCallback(async (enabled: boolean) => {
    setUseTier1(enabled);
    try {
      await saveAppSettingsToDB({ useTier1: enabled, tier1Threshold });
    } catch (e) {
      console.warn('Could not persist setting useTier1:', e);
    }
  }, [tier1Threshold]);

  const handleChangeThreshold = useCallback(async (threshold: number) => {
    setTier1Threshold(threshold);
    try {
      await saveAppSettingsToDB({ useTier1, tier1Threshold: threshold });
    } catch (e) {
      console.warn('Could not persist setting tier1Threshold:', e);
    }
  }, [useTier1]);

  return {
    useTier1,
    setUseTier1,
    tier1Threshold,
    setTier1Threshold,
    isLoadingModel,
    modelStats,
    setModelStats,
    modelError,
    tier2LoadingState,
    engineTier1Ref,
    engineTier2Ref,
    ensureTier1Engine,
    ensureTier2Engine,
    classifyRows,
    handleToggleTier1,
    handleChangeThreshold,
  };
}
