/**
 * MySpendLens — IndexedDB Local Database
 *
 * Stores all historical transactions across multiple file uploads.
 * Provides deduplication based on transaction fingerprint: (date + causale/description + amount).
 * Also manages custom and default category definitions and reassignments.
 */

import { ProcessedTransaction } from '../types';
import { CategoryDefinition, DEFAULT_CATEGORY_DEFINITIONS } from '../utils/categories';
import { Tier1ModelArtifact } from '../engine/tier1_browser_engine';
import { normalizeDateToIso } from '../utils/financialCalculations';

export interface StoredTransaction extends ProcessedTransaction {
  fingerprint: string;
  sourceFile?: string;
  importedAt: number;
}

export interface AppStoredSettings {
  useTier1?: boolean;
  tier1Threshold?: number;
  hasPendingTraining?: boolean;
  [key: string]: unknown;
}

const DB_NAME = 'myspendlens_db';
const DB_VERSION = 3;
const STORE_NAME = 'transactions';
const CATEGORIES_STORE = 'categories';
const APP_SETTINGS_STORE = 'app_settings';

/**
 * Generates a deterministic normalized fingerprint for deduplication.
 * Uses normalized date, description, amount, and an optional occurrence index (multiset deduplication)
 * to prevent fusing legitimate identical transactions on the same day (e.g. two identical coffees).
 */
export function generateTransactionFingerprint(
  date?: string,
  rawDescription?: string,
  amount?: string,
  occurrence: number = 0
): string {
  // 1. Normalize date to standard ISO YYYY-MM-DD (e.g. "9/28/26" -> "2026-09-28")
  const isoDate = normalizeDateToIso(date);
  const normDate = isoDate || (date || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  // 2. Normalize description (strip multiple spaces, lowercase, trim)
  const normDesc = (rawDescription || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  // 3. Normalize amount (strip currency symbols and spaces, standardize commas to dot)
  let normAmt = (amount || '')
    .trim()
    .toLowerCase()
    .replace(/[€$£\s]/g, '');

  // If European format with comma as decimal
  if (normAmt.includes(',') && normAmt.includes('.')) {
    normAmt = normAmt.replace(/\./g, '').replace(',', '.');
  } else if (normAmt.includes(',')) {
    normAmt = normAmt.replace(',', '.');
  }

  // Remove trailing or leading zeroes after decimal if numeric
  const parsedAmt = parseFloat(normAmt);
  const formattedAmt = isNaN(parsedAmt) ? normAmt : parsedAmt.toFixed(2);

  const baseFp = `${normDate}|${normDesc}|${formattedAmt}`;
  return occurrence > 0 ? `${baseFp}#${occurrence}` : baseFp;
}

let dbInstancePromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbInstancePromise) {
    dbInstancePromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        return reject(new Error('IndexedDB is not available in this environment.'));
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by_fingerprint', 'fingerprint', { unique: false });
          store.createIndex('by_date', 'date', { unique: false });
          store.createIndex('by_imported', 'importedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains(CATEGORIES_STORE)) {
          db.createObjectStore(CATEGORIES_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(APP_SETTINGS_STORE)) {
          db.createObjectStore(APP_SETTINGS_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => {
          dbInstancePromise = null;
        };
        db.onversionchange = () => {
          db.close();
          dbInstancePromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        dbInstancePromise = null;
        reject(request.error || new Error('Failed to open database'));
      };
    });
  }
  return dbInstancePromise;
}

/**
 * Retrieves all stored transactions, sorted by date descending.
 */
export async function getAllTransactionsFromDB(): Promise<StoredTransaction[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const items = (request.result as StoredTransaction[]) || [];
      // Ensure each item has a multiset occurrence fingerprint
      const counts = new Map<string, number>();
      for (const item of items) {
        if (!item.fingerprint) {
          const baseFp = generateTransactionFingerprint(item.date, item.rawDescription, item.amount);
          const occ = counts.get(baseFp) ?? 0;
          counts.set(baseFp, occ + 1);
          item.fingerprint = occ > 0 ? `${baseFp}#${occ}` : baseFp;
        }
      }
      resolve(items);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to retrieve transactions'));
    };
  });
}

/**
 * Returns a Set of all existing transaction fingerprints in the database.
 * Used for fast duplicate checking during merge.
 */
export async function getExistingFingerprintsSet(): Promise<Set<string>> {
  const all = await getAllTransactionsFromDB();
  const set = new Set<string>();
  for (const t of all) {
    if (t.fingerprint) {
      set.add(t.fingerprint);
    }
  }
  return set;
}

/**
 * Adds new processed transactions to the database.
 */
export async function addTransactionsToDB(
  transactions: ProcessedTransaction[],
  sourceFileName?: string
): Promise<void> {
  if (transactions.length === 0) return;
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();

    const counts = new Map<string, number>();
    for (const item of transactions) {
      const baseFp = generateTransactionFingerprint(item.date, item.rawDescription, item.amount);
      const occ = counts.get(baseFp) ?? 0;
      counts.set(baseFp, occ + 1);
      const storedItem: StoredTransaction = {
        ...item,
        fingerprint: occ > 0 ? `${baseFp}#${occ}` : baseFp,
        sourceFile: sourceFileName || 'unknown',
        importedAt: now,
      };
      store.put(storedItem);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Merges a batch of transactions into IndexedDB in a single readwrite transaction,
 * ensuring multiset fingerprint deduplication and avoiding N+1 sequential transaction roundtrips.
 */
export async function batchMergeTransactionsInDB(
  transactions: ProcessedTransaction[]
): Promise<number> {
  if (transactions.length === 0) return 0;
  const db = await getDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const now = Date.now();

    const getAllReq = store.getAll();
    getAllReq.onsuccess = () => {
      const existingItems = (getAllReq.result as StoredTransaction[]) || [];
      const existingFps = new Set<string>();
      for (const item of existingItems) {
        if (item.fingerprint) {
          existingFps.add(item.fingerprint);
        }
      }

      const fileOccurrences = new Map<string, number>();
      let addedCount = 0;

      for (const item of transactions) {
        const baseFp = generateTransactionFingerprint(item.date, item.rawDescription, item.amount);
        const occ = fileOccurrences.get(baseFp) ?? 0;
        fileOccurrences.set(baseFp, occ + 1);
        const indexedFp = occ > 0 ? `${baseFp}#${occ}` : baseFp;

        if (!existingFps.has(indexedFp)) {
          const storedItem: StoredTransaction = {
            ...item,
            fingerprint: (item as StoredTransaction).fingerprint || indexedFp,
            sourceFile: (item as StoredTransaction).sourceFile || 'backup_restore',
            importedAt: (item as StoredTransaction).importedAt || now,
          };
          store.put(storedItem);
          existingFps.add(indexedFp);
          addedCount++;
        }
      }

      tx.oncomplete = () => resolve(addedCount);
    };

    getAllReq.onerror = () => reject(getAllReq.error);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Updates transactions (e.g. after re-classification with new model weights).
 */
export async function updateTransactionsInDB(
  transactions: ProcessedTransaction[]
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    for (const item of transactions) {
      store.put(item);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Updates a single transaction in the database.
 */
export async function updateSingleTransactionInDB(
  transaction: ProcessedTransaction
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(transaction);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Deletes a single transaction from the database by ID.
 */
export async function deleteTransactionFromDB(id: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(id);

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Deletes all transactions from the database and purges legacy localStorage to prevent resurrection.
 */
export async function clearAllTransactionsInDB(): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Purge any legacy localStorage items completely
  try {
    localStorage.removeItem('myspendlens_transactions');
    localStorage.removeItem('myspendlens_filename');
    localStorage.setItem('myspendlens_migrated', 'true');
  } catch {
    // Ignore restricted storage contexts
  }
}

/**
 * One-time migration from legacy localStorage to IndexedDB if present.
 */
export async function migrateFromLocalStorageIfNeeded(): Promise<void> {
  try {
    if (localStorage.getItem('myspendlens_migrated') === 'true') {
      return;
    }
    const legacyJson = localStorage.getItem('myspendlens_transactions');
    const legacyFileName = localStorage.getItem('myspendlens_filename') || undefined;
    if (legacyJson) {
      const existing = await getAllTransactionsFromDB();
      if (existing.length === 0) {
        const legacyItems = JSON.parse(legacyJson);
        if (Array.isArray(legacyItems) && legacyItems.length > 0) {
          await addTransactionsToDB(legacyItems, legacyFileName);
          console.info(`Migrated ${legacyItems.length} transactions from localStorage to IndexedDB.`);
        }
      }
      localStorage.removeItem('myspendlens_transactions');
      localStorage.removeItem('myspendlens_filename');
    }
    localStorage.setItem('myspendlens_migrated', 'true');
  } catch (err) {
    console.warn('Migration from localStorage check skipped:', err);
  }
}

/**
 * Factory reset: wipes all transactions, resets categories to defaults,
 * deletes any custom Tier 1 model, clears all app settings and legacy localStorage.
 */
export async function factoryResetAppInDB(): Promise<void> {
  const db = await getDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([STORE_NAME, CATEGORIES_STORE, APP_SETTINGS_STORE], 'readwrite');

    // 1. Clear all transactions
    const txStore = tx.objectStore(STORE_NAME);
    txStore.clear();

    // 2. Reset categories to fresh default definitions
    const catStore = tx.objectStore(CATEGORIES_STORE);
    catStore.clear();
    for (const def of DEFAULT_CATEGORY_DEFINITIONS) {
      catStore.put(def);
    }

    // 3. Clear custom model & custom app settings
    const settingsStore = tx.objectStore(APP_SETTINGS_STORE);
    settingsStore.clear();

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  // Purge any localStorage items
  try {
    localStorage.removeItem('myspendlens_transactions');
    localStorage.removeItem('myspendlens_filename');
    localStorage.setItem('myspendlens_migrated', 'true');
  } catch {
    // Ignore restricted storage contexts
  }
}

// -------------------------------------------------------------
// Categories Store Operations
// -------------------------------------------------------------

/**
 * Retrieves all categories from IndexedDB. If empty, seeds with default categories.
 */
export async function getAllCategoriesFromDB(): Promise<CategoryDefinition[]> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATEGORIES_STORE, 'readwrite');
    const store = tx.objectStore(CATEGORIES_STORE);
    const req = store.getAll();

    req.onsuccess = () => {
      let items = (req.result as CategoryDefinition[]) || [];
      if (items.length === 0) {
        // Seed default categories
        for (const def of DEFAULT_CATEGORY_DEFINITIONS) {
          store.put(def);
        }
        items = [...DEFAULT_CATEGORY_DEFINITIONS];
      }
      // Sort by creation time
      items.sort((a, b) => a.createdAt - b.createdAt);
      resolve(items);
    };

    req.onerror = () => reject(req.error || new Error('Failed to load categories'));
  });
}

/**
 * Saves or updates a category definition in IndexedDB.
 */
export async function saveCategoryToDB(category: CategoryDefinition): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATEGORIES_STORE, 'readwrite');
    const store = tx.objectStore(CATEGORIES_STORE);
    store.put(category);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Deletes a category definition from IndexedDB.
 */
export async function deleteCategoryFromDB(id: string): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATEGORIES_STORE, 'readwrite');
    const store = tx.objectStore(CATEGORIES_STORE);
    store.delete(id);

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Renames a category:
 * 1. Updates the category record in the categories store.
 * 2. Scans all transactions and replaces category = newName where category === oldName.
 */
export async function renameCategoryInDB(
  oldName: string,
  updatedCategory: CategoryDefinition
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([CATEGORIES_STORE, STORE_NAME], 'readwrite');
    const catStore = tx.objectStore(CATEGORIES_STORE);
    const txStore = tx.objectStore(STORE_NAME);

    // 1. Put updated category definition
    catStore.put(updatedCategory);

    // 2. Cursor over transactions to rename occurrences
    const req = txStore.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const item = cursor.value as StoredTransaction;
        if (item.category === oldName) {
          item.category = updatedCategory.name;
          cursor.update(item);
        }
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Reassigns all transactions from oldCategory to newCategory, and optionally deletes the old category.
 */
export async function reassignCategoryInDB(
  oldCategory: string,
  newCategory: string,
  categoryIdToDelete?: string
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const stores = categoryIdToDelete ? [CATEGORIES_STORE, STORE_NAME] : [STORE_NAME];
    const tx = db.transaction(stores, 'readwrite');
    const txStore = tx.objectStore(STORE_NAME);

    if (categoryIdToDelete) {
      const catStore = tx.objectStore(CATEGORIES_STORE);
      catStore.delete(categoryIdToDelete);
    }

    const req = txStore.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        const item = cursor.value as StoredTransaction;
        if (item.category === oldCategory) {
          item.category = newCategory;
          item.sourceTier = 'Manual';
          cursor.update(item);
        }
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Replaces all transactions in DB with an imported dataset.
 */
export async function replaceAllTransactionsInDB(
  transactions: ProcessedTransaction[]
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    const now = Date.now();
    for (const item of transactions) {
      const storedItem: StoredTransaction = {
        ...item,
        fingerprint:
          (item as StoredTransaction).fingerprint ||
          generateTransactionFingerprint(item.date, item.rawDescription, item.amount),
        sourceFile: (item as StoredTransaction).sourceFile || 'imported_backup',
        importedAt: (item as StoredTransaction).importedAt || now,
      };
      store.put(storedItem);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Replaces all categories in DB with an imported dataset.
 */
export async function replaceAllCategoriesInDB(
  categories: CategoryDefinition[]
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CATEGORIES_STORE, 'readwrite');
    const store = tx.objectStore(CATEGORIES_STORE);
    store.clear();
    for (const cat of categories) {
      store.put(cat);
    }

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Saves app settings (e.g. useTier1, tier1Threshold) in IndexedDB.
 */
export async function saveAppSettingsToDB(settings: AppStoredSettings): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APP_SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(APP_SETTINGS_STORE);
    store.put({ key: 'app_config', ...settings, updatedAt: Date.now() });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Retrieves stored app settings from IndexedDB.
 */
export async function getAppSettingsFromDB(): Promise<AppStoredSettings | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APP_SETTINGS_STORE, 'readonly');
    const store = tx.objectStore(APP_SETTINGS_STORE);
    const req = store.get('app_config');

    req.onsuccess = () => {
      resolve(req.result || null);
    };
    req.onerror = () => reject(req.error || new Error('Failed to load app settings'));
  });
}

/**
 * Saves a customized or learned Tier 1 model artifact into IndexedDB.
 */
export async function saveCustomTier1ModelToDB(
  artifact: Tier1ModelArtifact
): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APP_SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(APP_SETTINGS_STORE);
    store.put({ key: 'tier1_custom_model', artifact, updatedAt: Date.now() });

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Retrieves the stored custom Tier 1 model artifact from IndexedDB if present.
 */
export async function getCustomTier1ModelFromDB(): Promise<Tier1ModelArtifact | null> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APP_SETTINGS_STORE, 'readonly');
    const store = tx.objectStore(APP_SETTINGS_STORE);
    const req = store.get('tier1_custom_model');

    req.onsuccess = () => {
      if (req.result && req.result.artifact) {
        resolve(req.result.artifact as Tier1ModelArtifact);
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error || new Error('Failed to load custom Tier 1 model'));
  });
}

/**
 * Clears the custom Tier 1 model from IndexedDB, resetting to the global base model.
 */
export async function clearCustomTier1ModelFromDB(): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(APP_SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(APP_SETTINGS_STORE);
    store.delete('tier1_custom_model');

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
