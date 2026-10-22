/**
 * MySpendLens — IndexedDB Local Database
 *
 * Stores all historical transactions across multiple file uploads.
 * Provides deduplication based on transaction fingerprint: (date + causale/description + amount).
 */

import { ProcessedTransaction } from '../types';

export interface StoredTransaction extends ProcessedTransaction {
  fingerprint: string;
  sourceFile?: string;
  importedAt: number;
}

const DB_NAME = 'myspendlens_db';
const DB_VERSION = 1;
const STORE_NAME = 'transactions';

/**
 * Generates a deterministic normalized fingerprint for deduplication.
 * Usiamo data, causale e amount per identificare un movimento.
 */
export function generateTransactionFingerprint(
  date?: string,
  rawDescription?: string,
  amount?: string
): string {
  // 1. Normalize date (e.g. "14/10/2026" or "2026-10-14")
  const normDate = (date || '')
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

  return `${normDate}|${normDesc}|${formattedAmt}`;
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
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
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
      // Ensure each item has a fingerprint
      for (const item of items) {
        if (!item.fingerprint) {
          item.fingerprint = generateTransactionFingerprint(
            item.date,
            item.rawDescription,
            item.amount
          );
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
 * Used for fast $O(1)$ duplicate checking during merge.
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

    for (const item of transactions) {
      const storedItem: StoredTransaction = {
        ...item,
        fingerprint: generateTransactionFingerprint(item.date, item.rawDescription, item.amount),
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
 * Deletes all transactions from the database.
 */
export async function clearAllTransactionsInDB(): Promise<void> {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();

    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * One-time migration from legacy localStorage to IndexedDB if present.
 */
export async function migrateFromLocalStorageIfNeeded(): Promise<void> {
  try {
    const existing = await getAllTransactionsFromDB();
    if (existing.length === 0) {
      const legacyJson = localStorage.getItem('myspendlens_transactions');
      const legacyFileName = localStorage.getItem('myspendlens_filename') || undefined;
      if (legacyJson) {
        const legacyItems = JSON.parse(legacyJson);
        if (Array.isArray(legacyItems) && legacyItems.length > 0) {
          await addTransactionsToDB(legacyItems, legacyFileName);
          console.info(`Migrated ${legacyItems.length} transactions from localStorage to IndexedDB.`);
        }
      }
    }
  } catch (err) {
    console.warn('Migration from localStorage check skipped:', err);
  }
}
