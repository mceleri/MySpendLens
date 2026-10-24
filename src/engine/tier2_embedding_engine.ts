/**
 * MySpendLens — Tier 2 Semantic Embedding Engine
 *
 * Uses Transformers.js with Xenova/multilingual-e5-small.
 * Supports standard browser CacheStorage API and IndexedDB fallback for insecure HTTP contexts
 * (e.g. mobile browser accessing over remote Tailscale/LAN without HTTPS).
 */

import { env, pipeline, FeatureExtractionPipeline } from '@xenova/transformers';
import { PredictionResult } from './tier1_browser_engine';
import { CategoryDefinition } from '../utils/categories';

export interface Tier2ProgressInfo {
  status: 'initiate' | 'download' | 'progress' | 'done' | 'ready';
  name?: string;
  file?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface Tier2PredictionResult extends PredictionResult {
  sourceTier: 'Tier 2';
  cosineSimilarities: Record<string, number>;
  rawQueryText: string;
}

/**
 * Custom IndexedDB cache adapter adhering to Cache API match/put signature.
 * Used when CacheStorage is restricted by browser security policies in HTTP contexts.
 */
class IndexedDBCache {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('myspendlens-transformers-cache', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files');
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  async match(key: string | Request): Promise<Response | undefined> {
    try {
      const url = typeof key === 'string' ? key : (key?.url || String(key));
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('files', 'readonly');
        const store = tx.objectStore('files');
        const req = store.get(url);
        req.onsuccess = () => {
          const val = req.result;
          if (val && val.buffer) {
            const headers = new Headers(val.headers || {});
            if (!headers.has('content-length')) {
              headers.set('content-length', String(val.buffer.byteLength));
            }
            resolve(new Response(val.buffer, { status: 200, statusText: 'OK', headers }));
          } else {
            resolve(undefined);
          }
        };
        req.onerror = () => resolve(undefined);
      });
    } catch {
      return undefined;
    }
  }

  async put(key: string | Request, response: Response): Promise<void> {
    try {
      const url = typeof key === 'string' ? key : (key?.url || String(key));
      const buffer = await response.arrayBuffer();
      const headers: Record<string, string> = {
        'content-length': String(buffer.byteLength),
      };
      if (response.headers && typeof response.headers.forEach === 'function') {
        response.headers.forEach((v, k) => {
          headers[k.toLowerCase()] = v;
        });
      }
      headers['content-length'] = String(buffer.byteLength);

      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        const req = store.put({ buffer, headers }, url);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (e) {
      console.warn('Could not cache file in IndexedDB:', e);
    }
  }

  async delete(key: string | Request): Promise<boolean> {
    try {
      const url = typeof key === 'string' ? key : (key?.url || String(key));
      const db = await this.getDB();
      return new Promise((resolve) => {
        const tx = db.transaction('files', 'readwrite');
        const store = tx.objectStore('files');
        const req = store.delete(url);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      });
    } catch {
      return false;
    }
  }
}

let cachedIDBInstance: IndexedDBCache | null = null;
function getIndexedDBCacheInstance(): IndexedDBCache {
  if (!cachedIDBInstance) {
    cachedIDBInstance = new IndexedDBCache();
  }
  return cachedIDBInstance;
}

// Safely configure caching based on available APIs in the current environment
function configureTransformersCache() {
  // Allow loading model files directly from local origin (/models/) with remote fallback
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  env.localModelPath = '/models/';

  const hasCacheStorage =
    typeof window !== 'undefined' &&
    typeof window.caches !== 'undefined' &&
    typeof window.caches.open === 'function';

  const hasIndexedDB =
    typeof window !== 'undefined' &&
    typeof window.indexedDB !== 'undefined';

  if (hasCacheStorage) {
    // Standard secure context (HTTPS or localhost)
    env.useBrowserCache = true;
    env.useCustomCache = false;
  } else if (hasIndexedDB) {
    // Remote HTTP context (e.g. smartphone over Tailscale / LAN without HTTPS)
    env.useBrowserCache = false;
    env.useCustomCache = true;
    // @ts-ignore customCache definition in transformers.js
    env.customCache = getIndexedDBCacheInstance();
  } else {
    // Direct in-memory download fallback
    env.useBrowserCache = false;
    env.useCustomCache = false;
  }
}

configureTransformersCache();

export class MySpendLensTier2Engine {
  private extractor: FeatureExtractionPipeline | null = null;
  private classCentroids: Record<string, number[]> = {};
  public isReady: boolean = false;

  private static readonly MODEL_ID = 'Xenova/multilingual-e5-small';

  // Standard MySpendLens 6 categories with rich anchors (IT, ES, EN)
  private static readonly CATEGORY_PASSAGES: Record<string, string[]> = {
    Groceries: [
      'passage: spesa alimentare al supermercato, ipermercato, prodotti alimentari, market, cibo, Esselunga, Mercadona, Conad, Carrefour, Coop, Lidl, Eurospin, alimentari',
      'passage: compra de alimentos en supermercado, hipermercado, comida fresca, ultramarinos, Dia, Alcampo, Eroski, Bonpreu, Consum',
      'passage: grocery store, supermarket shopping, food groceries, bakery, fresh market',
    ],
    'Dining Out': [
      'passage: ristorante, cena fuori, pranzo al ristorante, pizzeria, trattoria, bar, caffetteria, McDonald, Burger King, 100 Montaditos, fast food, aperitivo, pub',
      'passage: restaurante, cafeteria, bar de tapas, comida rapida, cena, cerveceria, pizzerias, bocadillos',
      'passage: dining out, restaurant dinner, lunch, cafe, pizza, burger, fast food, coffee shop',
    ],
    'Transport & Auto': [
      'passage: rifornimento carburante, benzina, diesel, stazione di servizio, Repsol, Eni Station, Q8, IP, biglietto treno Trenitalia, Renfe, metro, pedaggio Telepass, taxi',
      'passage: gasolinera, estacion de servicio, combustible, billete de tren, abono transporte, metro, peaje autopista, parking',
      'passage: gas station, fuel, public transit, train ticket, subway, highway toll, parking, taxi',
    ],
    Healthcare: [
      'passage: farmacia, acquisto medicinali, farmaci, prodotti sanitari, parafarmacia, dottore, clinica medica, esami del sangue, dentista, salute, ottica',
      'passage: farmacia, medicamentos, salud, clinica dental, medico, analisis clinicos, optica, parafarmacia',
      'passage: pharmacy, drugstore, medicine, medical clinic, doctor appointment, dentist, health care',
    ],
    Shopping: [
      'passage: shopping abbigliamento, vestiti, scarpe, Zara, Mango, Decathlon abbigliamento sportivo, Sephora profumeria make up, acquisti moda, elettronica, MediaWorld',
      'passage: tienda de ropa, calzado, moda, compras, articulos deportivos, perfumeria, cosmetica, electrodomesticos, grandes almacenes',
      'passage: retail shopping, clothes, apparel, shoes, sportswear, cosmetics, consumer electronics, department store',
    ],
    Utilities: [
      'passage: bolletta utenze domestiche, fornitura energia elettrica e gas, Enel Energia, Iberdrola, A2A, Naturgy, Edison, canone telefono fibra TIM Vodafone',
      'passage: recibo de luz y gas, suministro electrico, factura agua, compañia de telecomunicaciones, internet, factura mensual',
      'passage: utility bills, electricity power supply, natural gas invoice, water bill, telecommunications and home broadband',
    ],
  };

  private static readonly BANK_NOISE_REGEX =
    /\b(PAGAMENTO CONTABILIZZATO|ADDEBITO PREAUTORIZZATO|ADDEBITO DIRETTO SDD|ADEUDO POR DOMICILIACION|RECIBO DOMICILIADO|COMPRA EN COMERCIO|OPERACION TARJETA|PAGO CON TARJETA|COMPRA TARJETA|PAGAMENTO CARTA|PAGAMENTO POS|PAG BANCOMAT|PAG CONTACTLESS|OP POS CARTA|UTILIZZO CARTA|CARTA CREDITO|ADDEBITO SDD|CARGO RECIBO|CARGO REBO|ADEUDO SEPA|BIZUM COMPRA|PAGO TARJETA|SDD SEPA|PAG POS|RECIBO|BOLLETTA|FATTURA|MANDATO SEPA|MANDATO|SUMINISTRO|ADDEBITO PERIODICO|SERVIZI|AUT|ID|TX|REF|MND|SRL|SPA|SAU|SL|SA|MILANO|ROMA|TORINO|BOLOGNA|FIRENZE|NAPOLI|GENOVA|VERONA|PADOVA|BARI|MADRID|BARCELONA|VALENCIA|SEVILLA|BILBAO|ZARAGOZA|MALAGA|ALICANTE|MURCIA|VALLADOLID|VIA|VIALE|CORSO|PIAZZA|CALLE|PASEO|AVENIDA|ITALIA|ITALY|ESPANA)\b/gi;

  /**
   * Cleans banking noise to maximize semantic clarity for multilingual sentence embeddings.
   */
  public cleanDescription(rawDescription: string): string {
    const withoutCodes = rawDescription
      .replace(/\b(AUT|ID|TX|REF|MND)\s*[0-9A-Z]*\b/gi, ' ')
      .replace(/\b\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\b/g, ' ')
      .replace(/[.,\-_/\\#;:()]/g, ' ');

    const stripped = withoutCodes
      .replace(MySpendLensTier2Engine.BANK_NOISE_REGEX, ' ')
      .replace(/[^A-Za-zÀ-ÿ0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return stripped.length >= 3 ? stripped : rawDescription.replace(/\s+/g, ' ').trim();
  }

  /**
   * Initializes the pipeline and calculates class centroids.
   */
  public async init(
    onProgress?: (info: Tier2ProgressInfo) => void,
    categories?: CategoryDefinition[]
  ): Promise<void> {
    configureTransformersCache();

    this.extractor = await pipeline('feature-extraction', MySpendLensTier2Engine.MODEL_ID, {
      quantized: true,
      progress_callback: (p: Record<string, unknown>) => {
        if (onProgress) {
          onProgress({
            status: p.status as Tier2ProgressInfo['status'],
            name: typeof p.name === 'string' ? p.name : undefined,
            file: typeof p.file === 'string' ? p.file : undefined,
            progress: typeof p.progress === 'number' ? p.progress : undefined,
            loaded: typeof p.loaded === 'number' ? p.loaded : undefined,
            total: typeof p.total === 'number' ? p.total : undefined,
          });
        }
      },
    });

    // Compute class centroid embedding vectors
    await this.computeClassCentroids(categories);
    this.isReady = true;
  }

  private async computeClassCentroids(categories?: CategoryDefinition[]): Promise<void> {
    if (!this.extractor) throw new Error('Extractor not initialized');

    if (categories && categories.length > 0) {
      await this.syncDynamicCategories(categories);
      return;
    }

    for (const [category, passages] of Object.entries(
      MySpendLensTier2Engine.CATEGORY_PASSAGES
    )) {
      let centroid: number[] | null = null;

      for (const text of passages) {
        const out = await this.extractor(text, {
          pooling: 'mean',
          normalize: true,
        });
        const arr = Array.from(out.data as Float32Array);

        if (!centroid) {
          centroid = arr;
        } else {
          for (let i = 0; i < arr.length; i++) {
            centroid[i] += arr[i];
          }
        }
      }

      if (centroid) {
        // Re-normalize centroid vector
        let sumSq = 0;
        for (let i = 0; i < centroid.length; i++) {
          sumSq += centroid[i] * centroid[i];
        }
        const invNorm = 1 / Math.sqrt(sumSq || 1);
        this.classCentroids[category] = centroid.map((v) => v * invNorm);
      }
    }
  }

  /**
   * Synchronizes active categories with Tier 2 class centroids.
   * Calculates embedding centroids for any dynamic / custom category.
   */
  public async syncDynamicCategories(categories: CategoryDefinition[]): Promise<void> {
    if (!this.extractor) return;

    const newCentroids: Record<string, number[]> = {};
    const activeExpenseCategories = categories.filter((c) => c.isActive && c.name !== 'Income');

    for (const cat of activeExpenseCategories) {
      // If centroid already exists and was cached, reuse it
      if (this.classCentroids[cat.name]) {
        newCentroids[cat.name] = this.classCentroids[cat.name];
        continue;
      }

      // Check standard passages fallback
      const standardPassages = MySpendLensTier2Engine.CATEGORY_PASSAGES[cat.name];
      const passages = standardPassages || (
        cat.examples
          ? cat.examples.split(/[,;\n]+/).map((s) => `passage: ${s.trim()}`).filter((s) => s.length > 10)
          : [`passage: ${cat.name}`]
      );

      let centroid: number[] | null = null;
      for (const text of passages) {
        const out = await this.extractor(text, {
          pooling: 'mean',
          normalize: true,
        });
        const arr = Array.from(out.data as Float32Array);

        if (!centroid) {
          centroid = arr;
        } else {
          for (let i = 0; i < arr.length; i++) {
            centroid[i] += arr[i];
          }
        }
      }

      if (centroid) {
        let sumSq = 0;
        for (let i = 0; i < centroid.length; i++) {
          sumSq += centroid[i] * centroid[i];
        }
        const invNorm = 1 / Math.sqrt(sumSq || 1);
        newCentroids[cat.name] = centroid.map((v) => v * invNorm);
      }
    }

    this.classCentroids = newCentroids;
  }

  private static dotProduct(a: number[], b: number[]): number {
    let sum = 0;
    const len = a.length;
    for (let i = 0; i < len; i++) {
      sum += a[i] * b[i];
    }
    return sum;
  }

  /**
   * Classifies a transaction using multilingual sentence embeddings and cosine similarity.
   */
  public async predict(rawDescription: string): Promise<Tier2PredictionResult> {
    if (!this.extractor || !this.isReady) {
      throw new Error('Tier 2 Engine not ready');
    }

    const t0 = performance.now();
    const cleanText = this.cleanDescription(rawDescription);
    const query = `query: ${cleanText}`;

    const out = await this.extractor(query, {
      pooling: 'mean',
      normalize: true,
    });
    const queryVec = Array.from(out.data as Float32Array);

    const cosineSimilarities: Record<string, number> = {};
    const categories = Object.keys(this.classCentroids);
    const sims: number[] = [];

    for (const cat of categories) {
      const centroid = this.classCentroids[cat];
      const sim = MySpendLensTier2Engine.dotProduct(queryVec, centroid);
      cosineSimilarities[cat] = sim;
      sims.push(sim);
    }

    // Softmax with temperature scaling (tau = 0.02) to produce calibrated confidence probabilities
    const tau = 0.02;
    const maxSim = Math.max(...sims);
    const exps = sims.map((s) => Math.exp((s - maxSim) / tau));
    const sumExps = exps.reduce((a, b) => a + b, 0);

    const probabilities: Record<string, number> = {};
    let bestIdx = 0;

    for (let i = 0; i < categories.length; i++) {
      const p = exps[i] / sumExps;
      probabilities[categories[i]] = p;
      if (p > probabilities[categories[bestIdx]]) {
        bestIdx = i;
      }
    }

    const bestCat = categories[bestIdx];

    return {
      sourceTier: 'Tier 2',
      category: bestCat,
      confidence: probabilities[bestCat],
      probabilities,
      cosineSimilarities,
      rawQueryText: query,
      inferenceTimeMs: performance.now() - t0,
    };
  }
}
