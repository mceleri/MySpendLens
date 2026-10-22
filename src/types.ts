export interface ProcessedTransaction {
  id: string;
  originalIndex: number;
  date?: string;
  amount?: string;
  rawDescription: string;
  cleanedDescription?: string;
  category: string;
  systemCategory?: string;
  confidence: number;
  probabilities: Record<string, number>;
  inferenceTimeMs: number;
  sourceTier: 'Tier 1' | 'Tier 2 (Fallback)' | 'Tier 2 (Solo)' | 'Income' | 'Manual';
  tier1Result?: {
    category: string;
    confidence: number;
    probabilities: Record<string, number>;
    inferenceTimeMs: number;
  };
  tier2Result?: {
    category: string;
    confidence: number;
    probabilities: Record<string, number>;
    cosineSimilarities: Record<string, number>;
    inferenceTimeMs: number;
  };
}

export interface ModelStats {
  version: string;
  featuresCount: number;
  classesCount: number;
  validationAccuracy: number;
  countries: string[];
}

export interface Tier2LoadingState {
  status: 'idle' | 'downloading' | 'ready' | 'error';
  file?: string;
  progress: number;
  loadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

export type CategoryName =
  | 'Groceries'
  | 'Dining Out'
  | 'Transport & Auto'
  | 'Healthcare'
  | 'Shopping'
  | 'Utilities';

export interface BatchProcessingSummary {
  totalProcessed: number;
  totalTimeMs: number;
  avgTimeMs: number;
  avgConfidence: number;
  tier1Count: number;
  tier2Count: number;
  categoryCounts: Record<string, number>;
}
