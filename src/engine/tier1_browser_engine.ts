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
    /\b(PAGAMENTO CONTABILIZZATO|ADDEBITO PREAUTORIZZATO|ADDEBITO DIRETTO SDD|ADEUDO POR DOMICILIACION|RECIBO DOMICILIADO|COMPRA EN COMERCIO|OPERACION TARJETA|PAGO CON TARJETA|COMPRA TARJETA|PAGAMENTO CARTA|PAGAMENTO POS|PAG BANCOMAT|PAG CONTACTLESS|OP POS CARTA|UTILIZZO CARTA|CARTA CREDITO|ADDEBITO SDD|CARGO RECIBO|CARGO REBO|ADEUDO SEPA|BIZUM COMPRA|PAGO TARJETA|SDD SEPA|PAG POS|RECIBO|BOLLETTA|FATTURA|MANDATO SEPA|MANDATO|SUMINISTRO|ADDEBITO PERIODICO|SERVIZI|AUT|ID|TX|REF|MND|SRL|SPA|SAU|SL|SA|MILANO|ROMA|TORINO|BOLOGNA|FIRENZE|NAPOLI|GENOVA|VERONA|PADOVA|BARI|MADRID|BARCELONA|VALENCIA|SEVILLA|BILBAO|ZARAGOZA|MALAGA|ALICANTE|MURCIA|VALLADOLID|VIA|VIALE|CORSO|PIAZZA|CALLE|PASEO|AVENIDA|ITALIA|ITALY|ESPANA)\b/g;

  /**
   * Computes L2-normalized sublinear TF-IDF sparse vector over 3-5 character n-grams.
   */
  private vectorize(rawDescription: string): Map<number, number> {
    const baseText = this.artifact.config.lowercase
      ? rawDescription.trim().toLowerCase()
      : rawDescription.trim().toUpperCase();
    const noTx = baseText.replace(/\b(AUT|ID|TX|REF|MND)\s*[0-9A-Z]*\b/gi, " ");
    const alphaOnly = noTx.replace(/[^A-Z\s]+/gi, " ");
    const stripped = alphaOnly
      .replace(MySpendLensTier1Engine.BANK_NOISE_REGEX, " ")
      .replace(/\s+/g, " ")
      .trim();
    const baseClean =
      stripped.length >= 3 ? stripped : alphaOnly.replace(/\s+/g, " ").trim();
    const tokens = baseClean.split(" ").filter(Boolean);
    const text =
      tokens.length >= 2
        ? ` ${tokens.slice(0, 2).join(" ")} ${baseClean} `
        : ` ${baseClean} `;

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
   */
  public predict(rawDescription: string): PredictionResult {
    const t0 = performance.now();
    const xVec = this.vectorize(rawDescription);
    const { classes, weights } = this.artifact;
    const numClasses = classes.length;

    const logits = weights.intercept.slice();
    for (const [featIdx, featVal] of xVec.entries()) {
      for (let c = 0; c < numClasses; c++) {
        logits[c] += weights.coef[c][featIdx] * featVal;
      }
    }

    // Numerically stable softmax
    const maxLogit = Math.max(...logits);
    const exps = logits.map((l) => Math.exp(l - maxLogit));
    const sumExps = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((e) => e / sumExps);

    let bestIdx = 0;
    const probabilities: Record<string, number> = {};
    for (let c = 0; c < numClasses; c++) {
      probabilities[classes[c]] = probs[c];
      if (probs[c] > probs[bestIdx]) {
        bestIdx = c;
      }
    }

    return {
      category: classes[bestIdx],
      confidence: probs[bestIdx],
      probabilities,
      inferenceTimeMs: performance.now() - t0,
    };
  }

  /**
   * Ensures that a given class name exists in the model's classes and weight matrix.
   * If it doesn't exist, dynamically expands weights.coef with a new row and weights.intercept with 0.
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
    this.artifact.weights.intercept.push(0);
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
   * Continuous Local Learning: updates the weight matrix in-place using a single step
   * of multinomial logistic regression SGD when the user corrects a transaction category,
   * ready to be persisted to IndexedDB or Origin Private File System (OPFS).
   */
  public learnFromUserFeedback(
    rawDescription: string,
    trueCategory: string,
    learningRate = this.artifact.incremental_learning.default_learning_rate
  ): void {
    const targetIdx = this.ensureClass(trueCategory);
    if (targetIdx === -1) return;

    const xVec = this.vectorize(rawDescription);
    if (xVec.size === 0) return;

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
    samples: Array<{ description: string; category: string }>,
    options: TrainingOptions = {}
  ): Promise<TrainingSummary> {
    const t0 = performance.now();
    const epochs = options.epochs ?? 10;
    const baseLr = options.learningRate ?? 0.25;
    const l2Reg = options.l2Reg ?? 0.0001;
    const yieldMs = options.yieldIntervalMs ?? 50;

    // 1. Ensure all classes from samples exist in the weight matrix
    for (const s of samples) {
      if (s.category) {
        this.ensureClass(s.category);
      }
    }

    // 2. Pre-vectorize dataset once (fast cache of sparse feature vectors)
    const vectorizedDataset: Array<{
      xVec: Map<number, number>;
      targetIdx: number;
    }> = [];

    for (const s of samples) {
      if (!s.description || !s.category) continue;
      const targetIdx = this.artifact.classes.indexOf(s.category.trim());
      if (targetIdx === -1) continue;
      const xVec = this.vectorize(s.description);
      if (xVec.size === 0) continue;
      vectorizedDataset.push({ xVec, targetIdx });
    }

    if (vectorizedDataset.length === 0) {
      throw new Error('No valid vectorized samples available for training.');
    }

    const { classes, weights } = this.artifact;
    const numClasses = classes.length;

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

    // 3. Epoch Training Loop
    for (let epoch = 1; epoch <= epochs; epoch++) {
      const stepStart = performance.now();
      // Decay learning rate gradually per epoch
      const currentLr = baseLr / (1 + 0.05 * (epoch - 1));

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

        for (let c = 0; c < numClasses; c++) {
          const grad = probs[c] - (c === item.targetIdx ? 1.0 : 0.0);
          weights.intercept[c] -= currentLr * 0.1 * grad;

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
