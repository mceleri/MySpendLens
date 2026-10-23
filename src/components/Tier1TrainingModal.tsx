import React, { useState, useMemo } from 'react';
import {
  Brain,
  Sparkles,
  Zap,
  CheckCircle2,
  AlertCircle,
  X,
  RefreshCw,
  Database,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Cpu,
  DownloadCloud,
  ArrowRight,
  GitMerge,
} from 'lucide-react';
import { ProcessedTransaction } from '../types';
import { CategoryDefinition } from '../utils/categories';
import {
  MySpendLensTier1Engine,
  TrainingProgress,
  TrainingSummary,
} from '../engine/tier1_browser_engine';
import { MySpendLensTier2Engine } from '../engine/tier2_embedding_engine';

interface CleanAnchor {
  name: string;
  category: string;
  country?: string;
}

interface Tier1TrainingModalProps {
  isOpen: boolean;
  onClose: () => void;
  transactions: ProcessedTransaction[];
  categories: CategoryDefinition[];
  tier1Engine: MySpendLensTier1Engine | null;
  tier2Engine: MySpendLensTier2Engine | null;
  ensureTier1Engine: () => Promise<MySpendLensTier1Engine>;
  ensureTier2Engine: () => Promise<MySpendLensTier2Engine>;
  onTrainingComplete: () => Promise<void>;
}

type StepStatus = 'idle' | 'running' | 'success' | 'skipped' | 'error';

interface ExecutionStep {
  id: string;
  label: string;
  description: string;
  status: StepStatus;
  detail?: string;
}

export const Tier1TrainingModal: React.FC<Tier1TrainingModalProps> = ({
  isOpen,
  onClose,
  transactions,
  categories,
  tier1Engine,
  tier2Engine,
  ensureTier1Engine,
  ensureTier2Engine,
  onTrainingComplete,
}) => {
  const [phase, setPhase] = useState<'confirm' | 'running' | 'success' | 'error'>('confirm');
  const [steps, setSteps] = useState<ExecutionStep[]>([]);
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const [summary, setSummary] = useState<TrainingSummary | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Compute dataset statistics
  const validTransactions = useMemo(
    () => transactions.filter((t) => t.rawDescription && t.category && t.category.trim() !== ''),
    [transactions]
  );

  const activeCategories = useMemo(
    () => categories.filter((c) => c.isActive),
    [categories]
  );

  const activeCategoryNames = useMemo(
    () => new Set(activeCategories.map((c) => c.name)),
    [activeCategories]
  );

  // Check if standard base categories were altered/removed (e.g., 'Utilities' replaced with 'Luce'/'Gas')
  const standardBaseCategories = ['Groceries', 'Dining Out', 'Transport & Auto', 'Healthcare', 'Shopping', 'Utilities'];
  const missingBaseCategories = standardBaseCategories.filter((c) => !activeCategoryNames.has(c));
  const hasCustomTaxonomy = missingBaseCategories.length > 0;

  if (!isOpen) return null;

  const updateStep = (id: string, updates: Partial<ExecutionStep>) => {
    setSteps((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
  };

  const handleStartPipeline = async () => {
    setPhase('running');
    setErrorMsg(null);
    setProgress(null);
    setSummary(null);

    // Initial step setup
    const initialSteps: ExecutionStep[] = [
      {
        id: 'anchors_download',
        label: '1. Download Ancore Base',
        description: 'Carica 1.000 POI commerciali certificati (IT & ES)',
        status: 'idle',
      },
      {
        id: 'tier2_load',
        label: '2. Inizializzazione Tier 2 ONNX',
        description: hasCustomTaxonomy
          ? 'Carica il transformer multilingue per riallineare le classi rimosse'
          : 'Verifica prontezza modello semantico',
        status: 'idle',
      },
      {
        id: 'distillation',
        label: '3. Distillazione & Ri-etichettatura',
        description: hasCustomTaxonomy
          ? `Ri-etichetta con Tier 2 i merchant di [${missingBaseCategories.join(', ')}] verso le nuove classi`
          : 'Tutte le ancore corrispondono alle classi attive',
        status: 'idle',
      },
      {
        id: 'assemble',
        label: '4. Assemblaggio Training Set',
        description: 'Unione di movimenti reali utente, ancore base e keywords',
        status: 'idle',
      },
      {
        id: 'training',
        label: '5. Training Loop Tier 1',
        description: '10 Epoche SGD multinomiale con regolarizzazione L2',
        status: 'idle',
      },
      {
        id: 'save',
        label: '6. Persistenza IndexedDB',
        description: 'Salva i pesi aggiornati nello storage locale privato',
        status: 'idle',
      },
    ];

    setSteps(initialSteps);

    try {
      // STEP 1: Download & Carica myspendlens_clean_anchors.json
      updateStep('anchors_download', { status: 'running', detail: 'Download da /myspendlens_clean_anchors.json...' });
      const anchorsRes = await fetch('/myspendlens_clean_anchors.json');
      if (!anchorsRes.ok) {
        throw new Error(`Impossibile scaricare le ancore base (HTTP ${anchorsRes.status})`);
      }
      const rawAnchors: CleanAnchor[] = await anchorsRes.json();
      updateStep('anchors_download', {
        status: 'success',
        detail: `1.000 ancore base caricate in memoria (${rawAnchors.length} POI).`,
      });

      // STEP 2 & 3: Check se serve ri-etichettatura con Tier 2
      const anchorsNeedingRelabel = rawAnchors.filter((a) => !activeCategoryNames.has(a.category));
      let processedAnchors = [...rawAnchors];

      if (anchorsNeedingRelabel.length > 0) {
        updateStep('tier2_load', { status: 'running', detail: 'Caricamento pesi ONNX in RAM...' });
        const t2 = tier2Engine || (await ensureTier2Engine());
        updateStep('tier2_load', { status: 'success', detail: 'Tier 2 ONNX pronto in memoria.' });

        // STEP 3: Distillazione & Ri-etichettatura semantica con Tier 2
        updateStep('distillation', {
          status: 'running',
          detail: `Ri-etichettatura di ${anchorsNeedingRelabel.length} ancore orfane...`,
        });

        let relabeledCount = 0;
        const relabeledMap = new Map<string, string>();

        for (let i = 0; i < anchorsNeedingRelabel.length; i++) {
          const item = anchorsNeedingRelabel[i];
          const pred = await t2.predict(item.name);
          relabeledMap.set(item.name, pred.category);
          relabeledCount++;

          if (i % 10 === 0 || i === anchorsNeedingRelabel.length - 1) {
            updateStep('distillation', {
              detail: `Ri-etichettate ${relabeledCount}/${anchorsNeedingRelabel.length} ancore (${item.name} ➔ ${pred.category})`,
            });
            // Yield per fluidità UI
            await new Promise((r) => setTimeout(r, 10));
          }
        }

        // Applica le nuove etichette alle ancore
        processedAnchors = rawAnchors.map((a) => {
          if (relabeledMap.has(a.name)) {
            return { ...a, category: relabeledMap.get(a.name)! };
          }
          return a;
        });

        updateStep('distillation', {
          status: 'success',
          detail: `${relabeledCount} ancore riallineate con successo sulle classi attive!`,
        });
      } else {
        updateStep('tier2_load', { status: 'skipped', detail: 'Non necessario (classi base allineate)' });
        updateStep('distillation', { status: 'skipped', detail: 'Nessun merchant da ri-etichettare' });
      }

      // STEP 4: Assemblaggio Dataset Unificato
      updateStep('assemble', { status: 'running', detail: 'Fusione campioni utente, ancore e keywords...' });

      const fullDataset: Array<{ description: string; category: string }> = [];

      // 4a. Movimenti storici dell'utente dal DB
      for (const t of validTransactions) {
        if (activeCategoryNames.has(t.category)) {
          fullDataset.push({ description: t.rawDescription, category: t.category });
        }
      }

      // 4b. Ancore base (1.000 merchant)
      for (const a of processedAnchors) {
        if (activeCategoryNames.has(a.category)) {
          fullDataset.push({ description: a.name, category: a.category });
        }
      }

      // 4c. Keywords / Esempi delle categorie
      for (const cat of activeCategories) {
        if (cat.examples) {
          const parts = cat.examples.split(/[,;\n]/).map((p) => p.trim());
          for (const p of parts) {
            if (p.length >= 2) {
              fullDataset.push({ description: p, category: cat.name });
            }
          }
        }
      }

      updateStep('assemble', {
        status: 'success',
        detail: `Dataset completato: ${fullDataset.length} campioni totali (${validTransactions.length} tuoi movimenti + ${processedAnchors.length} ancore base riallineate).`,
      });

      // STEP 5: Training Loop Tier 1
      updateStep('training', { status: 'running', detail: 'Inizializzazione matrici pesi...' });
      const t1 = tier1Engine || (await ensureTier1Engine());

      // Sincronizza tutte le classi attive
      t1.syncClassesWithCategories(activeCategories.map((c) => c.name));

      const trainSummary = await t1.trainDataset(fullDataset, {
        epochs: 10,
        learningRate: 0.25,
        l2Reg: 0.0001,
        yieldIntervalMs: 60,
        onProgress: (p) => {
          setProgress(p);
          updateStep('training', {
            detail: `Epoca ${p.epoch}/10 | Loss: ${p.loss.toFixed(3)} | Acc: ${p.accuracy.toFixed(1)}%`,
          });
        },
      });

      updateStep('training', {
        status: 'success',
        detail: `10 Epoche completate | Loss: ${trainSummary.initialLoss.toFixed(3)} ➔ ${trainSummary.finalLoss.toFixed(3)} | Accuracy: ${trainSummary.finalAccuracy.toFixed(1)}%`,
      });

      // STEP 6: Persistenza IndexedDB
      updateStep('save', { status: 'running', detail: 'Salvataggio pesi in IndexedDB...' });
      await onTrainingComplete();
      updateStep('save', { status: 'success', detail: 'Pesi salvati e persistiti con successo!' });

      setSummary(trainSummary);
      setPhase('success');
    } catch (err) {
      console.error('Training Pipeline Error:', err);
      setErrorMsg((err as Error).message || 'Si è verificato un errore durante la pipeline di training.');
      setPhase('error');
    }
  };

  const currentEpoch = progress?.epoch || 0;
  const progressPercent = phase === 'success' ? 100 : Math.round((currentEpoch / 10) * 100);

  return (
    <div className="training-modal-backdrop" onClick={phase === 'running' ? undefined : onClose}>
      <div className="training-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="training-modal-header">
          <div className="training-modal-title-group">
            <div className="training-modal-icon-wrap">
              <Brain size={24} className="text-cyan animate-pulse" />
              <Sparkles size={13} className="sparkle-accent text-amber" />
            </div>
            <div>
              <h3 className="training-modal-title">Personal Tier 1 Training</h3>
              <span className="training-modal-subtitle">Pipeline di Distillazione & Fine-Tuning Locale</span>
            </div>
          </div>
          {phase !== 'running' && (
            <button
              type="button"
              className="btn-modal-close"
              onClick={onClose}
              aria-label="Chiudi"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="training-modal-body">
          {/* Error Message */}
          {errorMsg && (
            <div className="alert-box alert-error">
              <AlertCircle size={18} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* PHASE 1: PRE-FLIGHT CONFIRMATION */}
          {phase === 'confirm' && (
            <div className="training-confirm-container">
              <p className="training-info-text">
                Questa procedura addestra il tuo classificatore locale (<strong>Tier 1 da 0.2ms</strong>) integrando i tuoi movimenti reali con le <strong>1.000 ancore commerciali certificate</strong> di MySpendLens.
              </p>

              {/* Informative Taxomomy Notice */}
              {hasCustomTaxonomy && (
                <div className="taxonomy-alert-notice">
                  <div className="taxonomy-alert-header">
                    <GitMerge size={16} className="text-cyan shrink-0" />
                    <strong>Tassonomia Personalizzata Rilevata</strong>
                  </div>
                  <p className="taxonomy-alert-body">
                    Hai rimosso o rinominato <strong>{missingBaseCategories.join(', ')}</strong>.
                    Durante la procedura, il modello semantico <strong>Tier 2</strong> ri-etichetterà automaticamente le relative ancore storiche sulle tue nuove classi (es. <em>Luce</em> e <em>Gas</em>), così il Tier 1 imparerà centinaia di brand sin da subito!
                  </p>
                </div>
              )}

              {/* Pipeline Overview Card */}
              <div className="pipeline-preview-card">
                <h4 className="pipeline-preview-title">Fasi di esecuzione previste:</h4>
                <div className="pipeline-steps-preview">
                  <div className="preview-step">
                    <DownloadCloud size={15} className="text-cyan" />
                    <span>Download e caricamento 1.000 ancore base (~89 KB)</span>
                  </div>
                  {hasCustomTaxonomy && (
                    <div className="preview-step">
                      <Cpu size={15} className="text-purple" />
                      <span>Inizializzazione Tier 2 ONNX & Distillazione semantica per classi personalizzate</span>
                    </div>
                  )}
                  <div className="preview-step">
                    <Database size={15} className="text-emerald" />
                    <span>Fusione con <strong>{validTransactions.length}</strong> movimenti storici e parole chiave</span>
                  </div>
                  <div className="preview-step">
                    <Zap size={15} className="text-amber" />
                    <span>Training Loop di 10 epoche con L2 Weight Decay</span>
                  </div>
                  <div className="preview-step">
                    <ShieldCheck size={15} className="text-emerald" />
                    <span>Salvataggio definitivo dei pesi in IndexedDB (100% privato)</span>
                  </div>
                </div>
              </div>

              <div className="privacy-micro-note mt-2">
                <ShieldCheck size={16} className="text-emerald shrink-0" />
                <span>
                  Nessun download viene effettuato prima della tua conferma. Tutti i calcoli avverranno interamente nel tuo browser.
                </span>
              </div>
            </div>
          )}

          {/* PHASE 2: RUNNING PIPELINE WITH DETAILED STEPS */}
          {phase === 'running' && (
            <div className="training-live-pipeline">
              {/* Progress Bar & Epoch Indicator */}
              <div className="training-progress-header">
                <span className="font-mono text-sm font-bold text-cyan">
                  {currentEpoch > 0 ? `Epoca ${currentEpoch} / 10` : 'Preparazione dataset...'}
                </span>
                <span className="font-mono text-sm text-dim">{progressPercent}%</span>
              </div>

              <div className="training-progress-bar-track">
                <div
                  className="training-progress-bar-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* Dynamic Loss & Accuracy metrics */}
              {progress && (
                <div className="training-metrics-row mt-2 mb-2">
                  <div className="training-metric-card">
                    <div className="metric-label">
                      <TrendingDown size={14} className="text-cyan" />
                      <span>Cross-Entropy Loss</span>
                    </div>
                    <span className="metric-value font-mono text-cyan">
                      {progress.loss.toFixed(4)}
                    </span>
                  </div>

                  <div className="training-metric-card">
                    <div className="metric-label">
                      <TrendingUp size={14} className="text-emerald" />
                      <span>Training Accuracy</span>
                    </div>
                    <span className="metric-value font-mono text-emerald">
                      {progress.accuracy.toFixed(1)}%
                    </span>
                  </div>
                </div>
              )}

              {/* Multi-Step Execution List */}
              <div className="execution-steps-list">
                {steps.map((s) => (
                  <div key={s.id} className={`step-row status-${s.status}`}>
                    <div className="step-icon-wrap">
                      {s.status === 'running' && <RefreshCw size={15} className="spinner text-cyan" />}
                      {s.status === 'success' && <CheckCircle2 size={15} className="text-emerald" />}
                      {s.status === 'skipped' && <ArrowRight size={14} className="text-muted" />}
                      {s.status === 'idle' && <span className="step-dot-idle" />}
                      {s.status === 'error' && <AlertCircle size={15} className="text-danger" />}
                    </div>
                    <div className="step-text-wrap">
                      <span className="step-label">{s.label}</span>
                      <span className="step-detail">{s.detail || s.description}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PHASE 3: SUCCESS SUMMARY */}
          {phase === 'success' && summary && (
            <div className="training-success-box">
              <div className="success-badge-top">
                <CheckCircle2 size={36} className="text-emerald" />
                <h4 className="success-heading">Training Completato con Successo!</h4>
              </div>

              <p className="success-subtext">
                Il tuo classificatore Tier 1 personale è stato calibrato su <strong>{summary.sampleCount} campioni</strong> e salvato nel database locale.
                Le categorie personalizzate (incluse quelle ri-etichettate) verranno riconosciute a freddo in <strong>0.2 ms</strong>!
              </p>

              <div className="success-stats-table">
                <div className="stat-row">
                  <span className="stat-name">Campioni Addestrati</span>
                  <span className="stat-val font-mono font-bold">{summary.sampleCount}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Classi Attive Coperte</span>
                  <span className="stat-val font-mono font-bold">{summary.classes.length} classi</span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Calo della Loss</span>
                  <span className="stat-val font-mono text-cyan">
                    {summary.initialLoss.toFixed(3)} ➔ {summary.finalLoss.toFixed(3)}
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Accuratezza Finale</span>
                  <span className="stat-val font-mono text-emerald font-bold">
                    {summary.finalAccuracy.toFixed(1)}%
                  </span>
                </div>
                <div className="stat-row">
                  <span className="stat-name">Tempo Totale Esecuzione</span>
                  <span className="stat-val font-mono">{Math.round(summary.totalTimeMs)} ms</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="training-modal-footer">
          {phase === 'confirm' && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
              >
                Annulla
              </button>
              <button
                type="button"
                className="btn-primary btn-start-training"
                onClick={handleStartPipeline}
              >
                <Zap size={16} />
                <span>Conferma & Avvia Training</span>
              </button>
            </>
          )}

          {phase === 'running' && (
            <button
              type="button"
              className="btn-primary w-full opacity-70 cursor-wait"
              disabled
            >
              <RefreshCw size={16} className="spinner" />
              <span>Esecuzione Pipeline in Corso...</span>
            </button>
          )}

          {phase === 'success' && (
            <button
              type="button"
              className="btn-primary w-full"
              onClick={onClose}
            >
              <span>Fatto</span>
            </button>
          )}

          {phase === 'error' && (
            <>
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
              >
                Chiudi
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={handleStartPipeline}
              >
                <RefreshCw size={16} />
                <span>Riprova</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
