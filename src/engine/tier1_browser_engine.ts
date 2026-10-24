/**
 * MySpendLens — Tier 1 In-Browser Inference & Incremental Learning Engine
 *
 * Loads the pre-trained Global Base Model JSON (`myspendlens_tier1_base_model.json`)
 * exported by `train_base_model.py` (7,000 char 3-5 n-grams + LogisticRegression weights).
 * Executes sub-millisecond transaction classification on the main thread or in a Web Worker,
 * and supports continuous local adaptation via online SGD persisted in IndexedDB / OPFS.
 */

export interface Tier1ModelArtifact {
  format: string;
  version: string;
  created_at: string;
  config: {
    analyzer: "char";
    ngram_range: [number, number];
    max_features: number;
    lowercase: boolean;
    sublinear_tf: boolean;
    norm: "l2";
    classifier: "LogisticRegression";
    countries: string[];
  };
  metrics: {
    num_training_samples: number;
    num_features: number;
    num_classes: number;
    validation_accuracy: number;
    training_accuracy: number;
  };
  classes: string[];
  vocabulary: Record<string, number>;
  idf: number[];
  weights: {
    coef: number[][];
    intercept: number[];
  };
  incremental_learning: {
    storage_backends: string[];
    update_rule: string;
    default_learning_rate: number;
    user_feedback_count: number;
  };
}

export interface PredictionResult {
  category: string;
  confidence: number;
  margin?: number;
  probabilities: Record<string, number>;
  inferenceTimeMs: number;
}

export interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  accuracy: number;
  sampleCount: number;
  stepTimeMs: number;
}

export interface TrainingSummary {
  epochs: number;
  initialLoss: number;
  finalLoss: number;
  initialAccuracy: number;
  finalAccuracy: number;
  sampleCount: number;
  totalTimeMs: number;
  classes: string[];
}

export interface TrainingSample {
  description: string;
  category: string;
  weight?: number;
}

export interface TrainingOptions {
  epochs?: number;
  learningRate?: number;
  l2Reg?: number;
  onProgress?: (progress: TrainingProgress) => void;
  yieldIntervalMs?: number;
}

export class MySpendLensTier1Engine {
  private artifact: Tier1ModelArtifact;

  constructor(artifact: Tier1ModelArtifact) {
    this.artifact = artifact;
  }

  private static readonly BANK_NOISE_REGEX =
    /\b(PAGAMENTO CONTABILIZZATO|ADDEBITO PREAUTORIZZATO|ADDEBITO DIRETTO SDD|ADEUDO POR DOMICILIACION|RECIBO DOMICILIADO|COMPRA EN COMERCIO|OPERACION TARJETA|PAGO CON TARJETA|COMPRA TARJETA|PAGAMENTO CARTA|PAGAMENTO POS|PAG BANCOMAT|PAG CONTACTLESS|OP POS CARTA|UTILIZZO CARTA|CARTA CREDITO|ADDEBITO SDD|CARGO RECIBO|CARGO REBO|ADEUDO SEPA|BIZUM COMPRA|PAGO TARJETA|SDD SEPA|PAG POS|RECIBO|BOLLETTA|FATTURA|MANDATO SEPA|MANDATO|SUMINISTRO|ADDEBITO PERIODICO|SERVIZI|SRL|SPA|SAU|SL|SA|MILANO|ROMA|TORINO|BOLOGNA|FIRENZE|NAPOLI|GENOVA|VERONA|PADOVA|BARI|MADRID|BARCELONA|VALENCIA|SEVILLA|BILBAO|ZARAGOZA|MALAGA|ALICANTE|MURCIA|VALLADOLID|VIA|VIALE|CORSO|PIAZZA|CALLE|PASEO|AVENIDA|ITALIA|ITALY|ESPANA)\b/gi;

  /**
   * Cleans text and computes L2-normalized sublinear TF-IDF sparse vector over 3-5 character n-grams.
   * Matches train_base_model.py tokenization identically to prevent train/serve skew.
   */
  private vectorize(rawDescription: string): Map<number, number> {
    // 1. Python-identical preprocessing in uppercase first
    const upper = rawDescription.trim().toUpperCase();
    // Match only transaction identifiers followed by digits/separators (preserves Autogrill, Autostrade, etc.)
    const noTx = upper.replace(/\b(?:AUT|ID|TX|REF|MND)\b[\s:.\-]*\d[\w-]*/gi, " ");
    const alphaOnly = noTx.replace(/[^A-Z\s]+/gi, " ");
    const stripped = alphaOnly
      .replace(MySpendLensTier1Engine.BANK_NOISE_REGEX, " ")
      .replace(/\s+/g, " ")
      .trim();
    const baseClean =
      stripped.length >= 3 ? stripped : alphaOnly.replace(/\s+/g, " ").trim();
    const tokens = baseClean.split(" ").filter(Boolean);
    const textFormatted =
      tokens.length >= 2
        ? ` ${tokens.slice(0, 2).join(" ")} ${baseClean} `
        : ` ${baseClean} `;

    // 2. Lowercase if model was trained with lowercase: true (matching scikit-learn TfidfVectorizer)
    const text = this.artifact.config.lowercase
      ? textFormatted.toLowerCase()
      : textFormatted;

    const [nMin, nMax] = this.artifact.config.ngram_range;
    const vocab = this.artifact.vocabulary;
    const idf = this.artifact.idf;

    const counts = new Map<number, number>();
    const len = text.length;

    for (let n = nMin; n <= nMax; n++) {
      for (let i = 0; i <= len - n; i++) {
        const ngram = text.slice(i, i + n);
        const featIdx = vocab[ngram];
        if (featIdx !== undefined) {
          counts.set(featIdx, (counts.get(featIdx) ?? 0) + 1);
        }
      }
    }

    const tfidf = new Map<number, number>();
    let normSq = 0;

    for (const [featIdx, count] of counts.entries()) {
      const tf = this.artifact.config.sublinear_tf ? 1 + Math.log(count) : count;
      const val = tf * idf[featIdx];
      tfidf.set(featIdx, val);
      normSq += val * val;
    }

    if (normSq > 0) {
      const invNorm = 1 / Math.sqrt(normSq);
      for (const [featIdx, val] of tfidf.entries()) {
        tfidf.set(featIdx, val * invNorm);
      }
    }

    return tfidf;
  }

  /**
   * Sub-millisecond Tier 1 classification directly in browser / Web Worker.
   * Can optionally mask predictions to active categories only.
   */
  public predict(rawDescription: string, activeCategories?: string[]): PredictionResult {
    const t0 = performance.now();
    const xVec = this.vectorize(rawDescription);
    const { classes, weights } = this.artifact;
    const numClasses = classes.length;

    // Filter to active classes if provided
    const activeSet = activeCategories && activeCategories.length > 0 ? new Set(activeCategories) : null;
    const activeIndices: number[] = [];
    for (let c = 0; c < numClasses; c++) {
      if (!activeSet || activeSet.has(classes[c])) {
        activeIndices.push(c);
      }
    }
    const candidateIndices = activeIndices.length > 0 ? activeIndices : Array.from({ length: numClasses }, (_, i) => i);

    // If description has zero matching n-grams, confidence is 0 so it immediately escalates to Tier 2
    if (xVec.size === 0) {
      const uniformP = candidateIndices.length > 0 ? 1 / candidateIndices.length : 0;
      const probabilities: Record<string, number> = {};
      for (const idx of candidateIndices) {
        probabilities[classes[idx]] = uniformP;
      }
      return {
        category: candidateIndices.length > 0 ? classes[candidateIndices[0]] : 'Other',
        confidence: 0,
        probabilities,
        inferenceTimeMs: performance.now() - t0,
      };
    }

    const logits = weights.intercept.slice();
    for (const [featIdx, featVal] of xVec.entries()) {
      for (let c = 0; c < numClasses; c++) {
        logits[c] += weights.coef[c][featIdx] * featVal;
      }
    }

    // Numerically stable softmax over candidate (active) classes only
    const candidateLogits = candidateIndices.map((i) => logits[i]);
    const maxLogit = Math.max(...candidateLogits);
    const exps = candidateLogits.map((l) => Math.exp(l - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);

    let bestIdx = candidateIndices[0];
    let maxProb = -1;
    const probabilities: Record<string, number> = {};

    // Calculate top-1 and runner-up probability to determine the decision margin (p1 - p2)
    const sortedProbs: number[] = [];
    for (let i = 0; i < candidateIndices.length; i++) {
      const c = candidateIndices[i];
      const p = exps[i] / sumExps;
      probabilities[classes[c]] = p;
      sortedProbs.push(p);
      if (p > maxProb) {
        maxProb = p;
        bestIdx = c;
      }
    }
    sortedProbs.sort((a, b) => b - a);
    const runnerUpProb = sortedProbs.length > 1 ? sortedProbs[1] : 0;
    const margin = maxProb - runnerUpProb;

    return {
      category: classes[bestIdx],
      confidence: maxProb,
      margin,
      probabilities,
      inferenceTimeMs: performance.now() - t0,
    };
  }

  /**
   * Ensures that a given class name exists in the model's classes and weight matrix.
   * Initializes intercept with the median of existing intercepts for balanced prior calibration.
   */
  public ensureClass(className: string): number {
    const trimmed = className.trim();
    if (!trimmed) return -1;
    const existingIdx = this.artifact.classes.indexOf(trimmed);
    if (existingIdx !== -1) return existingIdx;

    // Dynamically append new class
    this.artifact.classes.push(trimmed);
    const numFeatures = this.artifact.metrics.num_features;
    this.artifact.weights.coef.push(new Array(numFeatures).fill(0));

    // Initialize new class intercept with median of existing intercepts
    const existingIntercepts = this.artifact.weights.intercept;
    let initialIntercept = -1.0;
    if (existingIntercepts.length > 0) {
      const sorted = [...existingIntercepts].sort((a, b) => a - b);
      initialIntercept = sorted[Math.floor(sorted.length / 2)];
    }
    this.artifact.weights.intercept.push(initialIntercept);
    this.artifact.metrics.num_classes = this.artifact.classes.length;
    return this.artifact.classes.length - 1;
  }

  /**
   * Synchronizes model classes with a list of active category names.
   */
  public syncClassesWithCategories(categoryNames: string[]): void {
    for (const name of categoryNames) {
      this.ensureClass(name);
    }
  }

  /**
   * Dynamically expands vocabulary with new character n-grams from unseen text.
   */
  private expandVocabularyWithUnseenNgrams(rawDescription: string): void {
    const upper = rawDescription.trim().toUpperCase();
    const noTx = upper.replace(/\b(?:AUT|ID|TX|REF|MND)\b[\s:.\-]*\d[\w-]*/gi, " ");
    const alphaOnly = noTx.replace(/[^A-Z\s]+/gi, " ").replace(/\s+/g, " ").trim();
    const cleanText = this.artifact.config.lowercase ? alphaOnly.toLowerCase() : alphaOnly;
    const text = ` ${cleanText} `;

    const [nMin, nMax] = this.artifact.config.ngram_range;
    const vocab = this.artifact.vocabulary;
    const len = text.length;
    const newGrams: string[] = [];

    for (let n = nMin; n <= nMax; n++) {
      for (let i = 0; i <= len - n; i++) {
        const ng = text.slice(i, i + n);
        if (vocab[ng] === undefined && !newGrams.includes(ng)) {
          newGrams.push(ng);
          if (newGrams.length >= 15) break; // Limit expansion per feedback
        }
      }
      if (newGrams.length >= 15) break;
    }

    if (newGrams.length === 0) return;

    // Compute median IDF as sensible default for newly discovered n-grams
    const sortedIdfs = [...this.artifact.idf].sort((a, b) => a - b);
    const medianIdf = sortedIdfs[Math.floor(sortedIdfs.length / 2)] || 4.5;

    for (const ng of newGrams) {
      const newFeatIdx = this.artifact.metrics.num_features;
      vocab[ng] = newFeatIdx;
      this.artifact.idf.push(medianIdf);
      for (let c = 0; c < this.artifact.classes.length; c++) {
        this.artifact.weights.coef[c].push(0);
      }
      this.artifact.metrics.num_features += 1;
    }
  }

  /**
   * Continuous Local Learning: updates the weight matrix in-place using a single step
   * of multinomial logistic regression SGD when the user corrects a transaction category.
   * Dynamically expands vocabulary if transaction has unseen n-grams so feedback is never dropped.
   */
  public learnFromUserFeedback(
    rawDescription: string,
    trueCategory: string,
    learningRate = this.artifact.incremental_learning.default_learning_rate
  ): void {
    const targetIdx = this.ensureClass(trueCategory);
    if (targetIdx === -1) return;

    let xVec = this.vectorize(rawDescription);
    if (xVec.size === 0) {
      // Unseen n-grams: expand vocabulary dynamically to capture user's merchant/term
      this.expandVocabularyWithUnseenNgrams(rawDescription);
      xVec = this.vectorize(rawDescription);
      if (xVec.size === 0) return;
    }

    const { classes, weights } = this.artifact;
    const numClasses = classes.length;

    const logits = weights.intercept.slice();
    for (const [featIdx, featVal] of xVec.entries()) {
      for (let c = 0; c < numClasses; c++) {
        logits[c] += weights.coef[c][featIdx] * featVal;
      }
    }

    const maxLogit = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((e) => e / sumExps);

    for (let c = 0; c < numClasses; c++) {
      const grad = probs[c] - (c === targetIdx ? 1.0 : 0.0);
      weights.intercept[c] -= learningRate * 0.1 * grad;
      const row = weights.coef[c];
      for (const [featIdx, featVal] of xVec.entries()) {
        row[featIdx] -= learningRate * grad * featVal;
      }
    }

    this.artifact.incremental_learning.user_feedback_count += 1;
  }

  /**
   * Multi-Epoch In-Browser Training Loop:
   * Trains or fine-tunes the Tier 1 Multinomial Logistic Regression model on all provided samples.
   * Includes L2 weight regularization, dynamic learning rate schedule, Fisher-Yates shuffling,
   * and yields between epochs to maintain smooth UI animation.
   */
  public async trainDataset(
    samples: TrainingSample[],
    options: TrainingOptions = {}
  ): Promise<TrainingSummary> {
    const t0 = performance.now();
    const epochs = options.epochs ?? 10;
    // Base LR of 0.08 prevents gradient explosion and loss oscillation with high sample weights
    const baseLr = options.learningRate ?? 0.08;
    const l2Reg = options.l2Reg ?? 0.0001;
    const yieldMs = options.yieldIntervalMs ?? 50;

    // 1. Ensure all classes from samples exist in the weight matrix
    for (const s of samples) {
      if (s.category) {
        this.ensureClass(s.category);
      }
    }

    // 2. Pre-vectorize dataset once (fast cache of sparse feature vectors and sample weights)
    const vectorizedDataset: Array<{
      xVec: Map<number, number>;
      targetIdx: number;
      weight: number;
    }> = [];

    for (const s of samples) {
      if (!s.description || !s.category) continue;
      const targetIdx = this.artifact.classes.indexOf(s.category.trim());
      if (targetIdx === -1) continue;
      let xVec = this.vectorize(s.description);
      if (xVec.size === 0) {
        // Expand vocabulary with user sample if unseen
        this.expandVocabularyWithUnseenNgrams(s.description);
        xVec = this.vectorize(s.description);
        if (xVec.size === 0) continue;
      }
      const weight = typeof s.weight === 'number' && s.weight > 0 ? s.weight : 1.0;
      vectorizedDataset.push({ xVec, targetIdx, weight });
    }

    if (vectorizedDataset.length === 0) {
      throw new Error('No valid vectorized samples available for training.');
    }

    const { classes, weights } = this.artifact;
    const numClasses = classes.length;

    // Calculate balanced class weights ONLY over active classes with samples (prevents multiplier collapse to 0.5)
    const classWeightsSum = new Array(numClasses).fill(0);
    let totalSampleWeight = 0;
    for (const item of vectorizedDataset) {
      classWeightsSum[item.targetIdx] += item.weight;
      totalSampleWeight += item.weight;
    }
    const activeClassesWithSamples = classWeightsSum.filter((w) => w > 0).length || 1;
    const classBalanceMultiplier = classWeightsSum.map((w) =>
      w > 0 ? Math.min(5.0, Math.max(0.5, totalSampleWeight / (activeClassesWithSamples * w))) : 1.0
    );

    // Helper: evaluate current cross-entropy loss and accuracy over the dataset
    const evaluate = (): { loss: number; accuracy: number } => {
      let totalLoss = 0;
      let correct = 0;

      for (const item of vectorizedDataset) {
        const logits = weights.intercept.slice();
        for (const [featIdx, featVal] of item.xVec.entries()) {
          for (let c = 0; c < numClasses; c++) {
            logits[c] += weights.coef[c][featIdx] * featVal;
          }
        }
        const maxLogit = Math.max(...logits);
        const exps = logits.map((l) => Math.exp(l - maxLogit));
        const sumExps = exps.reduce((a, b) => a + b, 0);

        let bestClass = 0;
        let maxP = -1;
        for (let c = 0; c < numClasses; c++) {
          const p = exps[c] / sumExps;
          if (p > maxP) {
            maxP = p;
            bestClass = c;
          }
        }

        const targetP = Math.max(1e-12, exps[item.targetIdx] / sumExps);
        totalLoss += -Math.log(targetP);
        if (bestClass === item.targetIdx) {
          correct++;
        }
      }

      return {
        loss: totalLoss / vectorizedDataset.length,
        accuracy: (correct / vectorizedDataset.length) * 100,
      };
    };

    const initialMetrics = evaluate();
    let finalLoss = initialMetrics.loss;
    let finalAccuracy = initialMetrics.accuracy;

    // Safety Snapshot & Checkpoint: record initial and best weights for rollback if loss degrades
    let bestLoss = initialMetrics.loss;
    let bestAccuracy = initialMetrics.accuracy;
    let bestCoef = weights.coef.map((row) => row.slice());
    let bestIntercept = weights.intercept.slice();

    // 3. Epoch Training Loop
    for (let epoch = 1; epoch <= epochs; epoch++) {
      const stepStart = performance.now();
      // Decay learning rate proportionally to 1 / sqrt(epoch) for smooth, monotonic convergence
      const currentLr = baseLr / Math.sqrt(epoch);

      // In-place Fisher-Yates shuffle for stochastic gradient descent
      for (let i = vectorizedDataset.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = vectorizedDataset[i];
        vectorizedDataset[i] = vectorizedDataset[j];
        vectorizedDataset[j] = temp;
      }

      // Single pass over shuffled dataset with L2 weight regularization
      for (const item of vectorizedDataset) {
        const logits = weights.intercept.slice();
        for (const [featIdx, featVal] of item.xVec.entries()) {
          for (let c = 0; c < numClasses; c++) {
            logits[c] += weights.coef[c][featIdx] * featVal;
          }
        }

        const maxLogit = Math.max(...logits);
        const exps = logits.map((l) => Math.exp(l - maxLogit));
        const sumExps = exps.reduce((a, b) => a + b, 0);
        const probs = exps.map((e) => e / sumExps);

        const effWeight = item.weight * classBalanceMultiplier[item.targetIdx];

        for (let c = 0; c < numClasses; c++) {
          const grad = (probs[c] - (c === item.targetIdx ? 1.0 : 0.0)) * effWeight;
          weights.intercept[c] -= currentLr * 0.05 * grad;

          const row = weights.coef[c];
          for (const [featIdx, featVal] of item.xVec.entries()) {
            const regTerm = l2Reg * row[featIdx];
            row[featIdx] -= currentLr * (grad * featVal + regTerm);
          }
        }
      }

      // Evaluate after epoch
      const epochMetrics = evaluate();
      finalLoss = epochMetrics.loss;
      finalAccuracy = epochMetrics.accuracy;

      // Track best checkpoint
      if (epochMetrics.loss < bestLoss) {
        bestLoss = epochMetrics.loss;
        bestAccuracy = epochMetrics.accuracy;
        bestCoef = weights.coef.map((row) => row.slice());
        bestIntercept = weights.intercept.slice();
      }

      if (options.onProgress) {
        options.onProgress({
          epoch,
          totalEpochs: epochs,
          loss: finalLoss,
          accuracy: finalAccuracy,
          sampleCount: vectorizedDataset.length,
          stepTimeMs: performance.now() - stepStart,
        });
      }

      // Yield control to browser event loop so animation updates smoothly
      if (yieldMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, yieldMs));
      }
    }

    // Safety Rollback: if training ended at worse loss than best checkpoint, restore best weights
    if (finalLoss > bestLoss) {
      this.artifact.weights.coef = bestCoef;
      this.artifact.weights.intercept = bestIntercept;
      finalLoss = bestLoss;
      finalAccuracy = bestAccuracy;
    }

    // 4. Update artifact metadata
    this.artifact.incremental_learning.user_feedback_count += vectorizedDataset.length;
    this.artifact.metrics.training_accuracy = finalAccuracy / 100;

    return {
      epochs,
      initialLoss: initialMetrics.loss,
      finalLoss,
      initialAccuracy: initialMetrics.accuracy,
      finalAccuracy,
      sampleCount: vectorizedDataset.length,
      totalTimeMs: performance.now() - t0,
      classes: [...this.artifact.classes],
    };
  }

  public serialize(): string {
    return JSON.stringify(this.artifact);
  }

  public getArtifact(): Tier1ModelArtifact {
    return this.artifact;
  }
}
