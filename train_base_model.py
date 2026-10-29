#!/usr/bin/env python3
"""
MySpendLens: Step 1 Build Pipeline — Global Base Model (Tier 1 Bootstrap)

Transforms `myspendlens_synthetic_training_it_es.csv` into a browser-ready static
JSON model artifact (`myspendlens_tier1_base_model.json`).

Key architectural constraints:
1. TF-IDF Vectorization: `analyzer='char'`, `ngram_range=(3, 5)`, `max_features=7000`
   to capture morphological brand roots and truncated strings while preventing
   dimensionality explosion in the browser's main thread / Web Worker.
2. Classifier Training: Lightweight linear model (`LogisticRegression` / `MultinomialNB`)
   mapping the 7,000 character n-grams to the 6 standard MySpendLens categories.
3. Static Web Export: Exports extracted vocabulary, IDF vector, weight matrix (`coef_`),
   and bias vector (`intercept_`) strictly as a compact JSON asset (NEVER `.pkl`),
   ready for sub-millisecond in-browser inference and incremental local adaptation
   via IndexedDB / OPFS.
"""

import csv
import json
import math
import os
import time
from collections import Counter, defaultdict

INPUT_CSV = "myspendlens_synthetic_training_it_es.csv"
OUTPUT_JSON = os.path.join("public", "myspendlens_tier1_base_model.json")

import re

MAX_FEATURES = 7000
NGRAM_MIN = 3
NGRAM_MAX = 5
MAX_DF_RATIO = 0.04
FLOAT_PRECISION = 5

try:
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.metrics import accuracy_score, classification_report
    from sklearn.model_selection import train_test_split

    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False


BANK_NOISE_REGEX = re.compile(
    r"\b("
    r"PAGAMENTO CONTABILIZZATO|ADDEBITO PREAUTORIZZATO|ADDEBITO DIRETTO SDD|"
    r"ADEUDO POR DOMICILIACION|RECIBO DOMICILIADO|COMPRA EN COMERCIO|"
    r"OPERACION TARJETA|PAGO CON TARJETA|COMPRA TARJETA|PAGAMENTO CARTA|"
    r"PAGAMENTO POS|PAG BANCOMAT|PAG CONTACTLESS|OP POS CARTA|UTILIZZO CARTA|"
    r"CARTA CREDITO|ADDEBITO SDD|CARGO RECIBO|CARGO REBO|ADEUDO SEPA|"
    r"BIZUM COMPRA|PAGO TARJETA|SDD SEPA|PAG POS|RECIBO|"
    r"BOLLETTA|FATTURA|MANDATO SEPA|MANDATO|SUMINISTRO|ADDEBITO PERIODICO|SERVIZI|"
    r"SRL|SPA|SAU|SL|SA|"
    r"MILANO|ROMA|TORINO|BOLOGNA|FIRENZE|NAPOLI|GENOVA|VERONA|PADOVA|BARI|"
    r"MADRID|BARCELONA|VALENCIA|SEVILLA|BILBAO|ZARAGOZA|MALAGA|ALICANTE|MURCIA|VALLADOLID|"
    r"VIA|VIALE|CORSO|PIAZZA|CALLE|PASEO|AVENIDA|"
    r"ITALIA|ITALY|ESPANA"
    r")\b"
)


def preprocess_description(text: str) -> str:
    """
    Normalizes bank statement text before char n-gram extraction:
    - Uppercase and punctuation removal
    - Removes random numeric digits and transaction IDs (AUT/ID/TX/REF codes)
    - Strips standard banking prefixes, legal suffixes, and city boilerplate so the
      7,000 char n-gram budget is 100% dedicated to merchant & category roots
    - Boosts leading merchant token(s) over trailing street address noise
    """
    upper = text.upper()
    # Match only transaction identifiers followed by digits/separators (preserves Autogrill, Autostrade, etc.)
    no_tx_codes = re.sub(r"\b(?:AUT|ID|TX|REF|MND)\b[\s:.\-]*\d[\w-]*", " ", upper, flags=re.IGNORECASE)
    alpha_only = re.sub(r"[^A-Z\s]+", " ", no_tx_codes)
    cleaned = BANK_NOISE_REGEX.sub(" ", alpha_only)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 3:
        cleaned = re.sub(r"\s+", " ", alpha_only).strip()
    tokens = cleaned.split()
    if len(tokens) >= 2:
        # Emphasize leading merchant brand tokens over trailing street names
        lead = " ".join(tokens[:2])
        return f" {lead} {cleaned} "
    return f" {cleaned} "


def load_dataset(csv_path: str) -> tuple[list[str], list[str]]:
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Training dataset not found: {csv_path}")

    texts: list[str] = []
    labels: list[str] = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            desc = (row.get("Noisy_Description") or "").strip().upper()
            cat = (row.get("Target_Category") or "").strip()
            if desc and cat:
                texts.append(desc)
                labels.append(cat)
    return texts, labels


def train_with_sklearn(texts: list[str], labels: list[str]) -> dict:
    """Primary pipeline using scikit-learn TfidfVectorizer + LogisticRegression."""
    print(
        f"[sklearn] Configuring TfidfVectorizer(analyzer='char', ngram_range=({NGRAM_MIN}, {NGRAM_MAX}), "
        f"max_features={MAX_FEATURES}, max_df={MAX_DF_RATIO})..."
    )
    vectorizer = TfidfVectorizer(
        analyzer="char",
        ngram_range=(NGRAM_MIN, NGRAM_MAX),
        max_features=MAX_FEATURES,
        max_df=MAX_DF_RATIO,
        preprocessor=preprocess_description,
        lowercase=False,
        sublinear_tf=True,
        norm="l2",
    )

    X = vectorizer.fit_transform(texts)
    classes = sorted(list(set(labels)))
    y = np.array([classes.index(c) for c in labels])

    # Hold out every 4th variation (25% of dataset, testing unseen truncated/noisy variations per POI)
    train_mask = np.array([i % 4 != 2 for i in range(len(texts))])
    X_train, y_train = X[train_mask], y[train_mask]
    X_val, y_val = X[~train_mask], y[~train_mask]

    print("[sklearn] Training LogisticRegression classifier on sparse TF-IDF matrix...")
    clf = LogisticRegression(
        C=5.0,
        max_iter=500,
        random_state=42,
    )
    clf.fit(X_train, y_train)

    val_preds = clf.predict(X_val)
    val_acc = float(accuracy_score(y_val, val_preds))
    print(f"[sklearn] Validation Accuracy (25% unseen variations holdout): {val_acc * 100:.2f}%")
    print(classification_report(y_val, val_preds, target_names=classes))

    # Re-fit on 100% of synthetic bootstrap data for final production base model
    clf.fit(X, y)
    train_acc = float(accuracy_score(y, clf.predict(X)))

    inv_vocab = [None] * len(vectorizer.vocabulary_)
    for ngram, idx in vectorizer.vocabulary_.items():
        inv_vocab[idx] = ngram

    idf_list = [round(float(v), FLOAT_PRECISION) for v in vectorizer.idf_]
    coef_matrix = [
        [round(float(w), FLOAT_PRECISION) for w in row]
        for row in clf.coef_
    ]
    intercept_list = [round(float(b), FLOAT_PRECISION) for b in clf.intercept_]

    return {
        "classes": classes,
        "vocabulary": vectorizer.vocabulary_,
        "tokens": inv_vocab,
        "idf": idf_list,
        "coef": coef_matrix,
        "intercept": intercept_list,
        "val_accuracy": round(val_acc, 4),
        "train_accuracy": round(train_acc, 4),
        "engine": "scikit-learn",
    }


def extract_char_ngrams(text: str, n_min: int = NGRAM_MIN, n_max: int = NGRAM_MAX) -> Counter:
    """Compatible pure-Python character n-gram extraction matching scikit-learn's `analyzer='char'` semantics."""
    clean = preprocess_description(text)
    counts: Counter = Counter()
    length = len(clean)
    for n in range(n_min, n_max + 1):
        for i in range(length - n + 1):
            counts[clean[i : i + n]] += 1
    return counts


def train_exact_compatible(texts: list[str], labels: list[str]) -> dict:
    """
    Pure-Python fallback implementation of TfidfVectorizer
    (smooth_idf=True, sublinear_tf=True, norm='l2', max_features=7000, max_df=0.04) +
    Multinomial Logistic Regression when scikit-learn C-extensions are not installed.
    """
    print(
        f"[Tier1-Builder] Extracting char n-grams ({NGRAM_MIN}-{NGRAM_MAX}) "
        f"with max_features={MAX_FEATURES}, max_df={MAX_DF_RATIO} across {len(texts)} transactions..."
    )
    doc_ngram_counts: list[Counter] = []
    global_term_freq: Counter = Counter()
    doc_freq: Counter = Counter()

    for text in texts:
        c = extract_char_ngrams(text)
        doc_ngram_counts.append(c)
        for ng, cnt in c.items():
            global_term_freq[ng] += cnt
            doc_freq[ng] += 1

    n_docs = len(texts)
    max_df_count = int(MAX_DF_RATIO * n_docs)
    total_unique_ngrams = len(global_term_freq)

    # Filter out ubiquitous banking noise above max_df (e.g. "PAG", "TARJ", "MILAN")
    eligible_ngrams = {
        ng: tf for ng, tf in global_term_freq.items() if doc_freq[ng] <= max_df_count
    }
    print(
        f"[Tier1-Builder] Total raw 3-5 char n-grams: {total_unique_ngrams:,} "
        f"-> {len(eligible_ngrams):,} after max_df={MAX_DF_RATIO} noise filter "
        f"-> capping to top {MAX_FEATURES:,} features."
    )

    # Ensure every 4-row POI anchor contributes its top 3-4 char roots (full + truncated)
    # so short single-word brands (e.g. ESSLNG, MRCDN, ZRA, OVS) are never starved by long multi-word POIs
    selected_set: set[str] = set()
    for start_i in range(0, n_docs, 4):
        poi_counts: Counter = Counter()
        for doc_i in range(start_i, min(start_i + 4, n_docs)):
            for ng, cnt in doc_ngram_counts[doc_i].items():
                if ng in eligible_ngrams and " " not in ng and len(ng) <= 4:
                    poi_counts[ng] += cnt
        for ng, _ in sorted(poi_counts.items(), key=lambda kv: (-kv[1], len(kv[0]), kv[0]))[:5]:
            if len(selected_set) < MAX_FEATURES:
                selected_set.add(ng)

    # Fill the remaining budget up to MAX_FEATURES=7000 by global term frequency
    for ng, _ in sorted(
        eligible_ngrams.items(), key=lambda kv: (-kv[1], len(kv[0]), kv[0])
    ):
        if len(selected_set) >= MAX_FEATURES:
            break
        selected_set.add(ng)

    tokens = sorted(selected_set)
    vocabulary = {ng: idx for idx, ng in enumerate(tokens)}
    num_features = len(tokens)

    # scikit-learn smooth IDF formula: idf(t) = log((1 + n) / (1 + df(t))) + 1
    idf = [
        math.log((1.0 + n_docs) / (1.0 + doc_freq[ng])) + 1.0
        for ng in tokens
    ]

    # Build L2-normalized sparse TF-IDF vectors (sublinear_tf=True -> tf = 1 + log(count))
    sparse_docs: list[dict[int, float]] = []
    for c in doc_ngram_counts:
        vec: dict[int, float] = {}
        norm_sq = 0.0
        for ng, cnt in c.items():
            idx = vocabulary.get(ng)
            if idx is not None:
                tf = 1.0 + math.log(cnt)
                val = tf * idf[idx]
                vec[idx] = val
                norm_sq += val * val
        if norm_sq > 0.0:
            inv_norm = 1.0 / math.sqrt(norm_sq)
            for idx in vec:
                vec[idx] *= inv_norm
        sparse_docs.append(vec)

    classes = sorted(list(set(labels)))
    num_classes = len(classes)
    y = [classes.index(c) for c in labels]

    # Hold out every 4th variation (index % 4 == 2, i.e. 1 truncated variation per POI) for validation
    train_indices = [i for i in range(n_docs) if i % 4 != 2]
    val_indices = [i for i in range(n_docs) if i % 4 == 2]

    by_class: dict[int, list[int]] = defaultdict(list)
    for i, cls_idx in enumerate(y):
        by_class[cls_idx].append(i)

    def fit_multinomial_logreg(sample_indices: list[int], epochs: int = 30, lr0: float = 2.0, l2_reg: float = 5e-5):
        W = [[0.0] * num_features for _ in range(num_classes)]
        b = [0.0] * num_classes
        ordered = []
        max_len = max(len(v) for v in by_class.values())
        sample_set = set(sample_indices)
        for pos in range(max_len):
            for c_i in range(num_classes):
                if pos < len(by_class[c_i]):
                    doc_i = by_class[c_i][pos]
                    if doc_i in sample_set:
                        ordered.append(doc_i)

        for epoch in range(epochs):
            lr = lr0 / (1.0 + 0.1 * epoch)
            for doc_i in ordered:
                x_vec = sparse_docs[doc_i]
                target = y[doc_i]

                logits = list(b)
                for f_idx, f_val in x_vec.items():
                    for c_i in range(num_classes):
                        logits[c_i] += W[c_i][f_idx] * f_val

                max_logit = max(logits)
                exps = [math.exp(l - max_logit) for l in logits]
                sum_exps = sum(exps)
                probs = [e / sum_exps for e in exps]

                for c_i in range(num_classes):
                    grad = probs[c_i] - (1.0 if c_i == target else 0.0)
                    b[c_i] -= lr * 0.05 * grad
                    w_row = W[c_i]
                    for f_idx, f_val in x_vec.items():
                        w_row[f_idx] = w_row[f_idx] * (1.0 - lr * l2_reg) - lr * grad * f_val
        return W, b

    def evaluate(W, b, indices: list[int]) -> float:
        correct = 0
        for doc_i in indices:
            x_vec = sparse_docs[doc_i]
            logits = list(b)
            for f_idx, f_val in x_vec.items():
                for c_i in range(num_classes):
                    logits[c_i] += W[c_i][f_idx] * f_val
            pred = max(range(num_classes), key=lambda c_i: logits[c_i])
            if pred == y[doc_i]:
                correct += 1
        return correct / len(indices) if indices else 0.0

    print("[Tier1-Builder] Training Multinomial LogisticRegression on 75% split (testing unseen truncated variations)...")
    W_val, b_val = fit_multinomial_logreg(train_indices)
    val_acc = evaluate(W_val, b_val, val_indices)
    print(f"[Tier1-Builder] Unseen Truncated Variation Validation Accuracy: {val_acc * 100:.2f}%")

    print("[Tier1-Builder] Fitting final Global Base Model on 100% of synthetic dataset...")
    W_full, b_full = fit_multinomial_logreg(list(range(n_docs)))
    train_acc = evaluate(W_full, b_full, list(range(n_docs)))
    print(f"[Tier1-Builder] Full Dataset Fit Accuracy: {train_acc * 100:.2f}%")

    return {
        "classes": classes,
        "vocabulary": vocabulary,
        "tokens": tokens,
        "idf": [round(v, FLOAT_PRECISION) for v in idf],
        "coef": [[round(w, FLOAT_PRECISION) for w in row] for row in W_full],
        "intercept": [round(v, FLOAT_PRECISION) for v in b_full],
        "val_accuracy": round(val_acc, 4),
        "train_accuracy": round(train_acc, 4),
        "engine": "sklearn-compatible-logreg",
    }


def export_static_json(model_data: dict, num_samples: int, output_path: str) -> None:
    """
    Serializes the trained TF-IDF vocabulary, IDF vector, and classifier weight matrix
    into a compact static JSON asset for in-browser Tier 1 inference and IndexedDB/OPFS
    incremental learning. Never uses Python `.pkl` (pickle).
    """
    artifact = {
        "format": "myspendlens-tier1-base-model",
        "version": "1.0.0",
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "analyzer": "char",
            "ngram_range": [NGRAM_MIN, NGRAM_MAX],
            "max_features": len(model_data["tokens"]),
            "lowercase": False,
            "sublinear_tf": True,
            "norm": "l2",
            "classifier": "LogisticRegression",
            "countries": ["IT", "ES"],
        },
        "metrics": {
            "num_training_samples": num_samples,
            "num_features": len(model_data["tokens"]),
            "num_classes": len(model_data["classes"]),
            "validation_accuracy": model_data["val_accuracy"],
            "training_accuracy": model_data["train_accuracy"],
        },
        "classes": model_data["classes"],
        "vocabulary": model_data["vocabulary"],
        "idf": model_data["idf"],
        "weights": {
            "coef": model_data["coef"],
            "intercept": model_data["intercept"],
        },
        "incremental_learning": {
            "storage_backends": ["IndexedDB", "OPFS"],
            "update_rule": "online_multinomial_sgd",
            "default_learning_rate": 0.15,
            "user_feedback_count": 0,
        },
    }

    # Write compact JSON (no extra whitespace) to minimize browser download/parse time
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(artifact, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(output_path) / 1024.0
    print(f"[Export] Saved static JSON model to {output_path} ({size_kb:.1f} KB)")


def verify_submillisecond_inference(output_path: str) -> None:
    """Simulates in-browser Tier 1 inference using only the exported JSON artifact."""
    with open(output_path, "r", encoding="utf-8") as f:
        artifact = json.load(f)

    vocab: dict[str, int] = artifact["vocabulary"]
    idf: list[float] = artifact["idf"]
    classes: list[str] = artifact["classes"]
    coef: list[list[float]] = artifact["weights"]["coef"]
    intercept: list[float] = artifact["weights"]["intercept"]
    n_min, n_max = artifact["config"]["ngram_range"]

    test_samples = [
        "PAG. POS 19/10 ESSLNG MILANO VIA RIPAMONTI AUT 90123",
        "COMPRA TARJETA 04/11 MRCDN MADRID CASTELLANA 28046",
        "PAG. BANCOMAT 22/10 L PDNRIA ROMA TERMINI",
        "PAGO CON TARJETA 11/10 E S RPSL BARCELONA DIAGONAL",
        "PAG. POS 08/10 FRMC LLOYDS MILANO CORSO BUENOS AIRES",
        "COMPRA TARJETA 15/10 ZRA INDITEX MADRID SERRANO",
        "SDD SEPA 28/10 ENL ENRGIA SPA BOLLETTA LUCE MILANO",
        "RECIBO DOMICILIADO 01/11 IBRDRL CLIENTES SA MADRID",
    ]

    print("\n--- Tier 1 Browser Inference Benchmark (from Static JSON) ---")
    t0 = time.perf_counter()
    for sample in test_samples:
        s = preprocess_description(sample)
        counts: Counter = Counter()
        L = len(s)
        for n in range(n_min, n_max + 1):
            for i in range(L - n + 1):
                ng = s[i : i + n]
                if ng in vocab:
                    counts[vocab[ng]] += 1

        vec: dict[int, float] = {}
        norm_sq = 0.0
        for idx, cnt in counts.items():
            val = (1.0 + math.log(cnt)) * idf[idx]
            vec[idx] = val
            norm_sq += val * val
        if norm_sq > 0:
            inv = 1.0 / math.sqrt(norm_sq)
            for idx in vec:
                vec[idx] *= inv

        logits = list(intercept)
        for idx, val in vec.items():
            for c_i in range(len(classes)):
                logits[c_i] += coef[c_i][idx] * val

        max_l = max(logits)
        exps = [math.exp(l - max_l) for l in logits]
        sum_e = sum(exps)
        probs = [e / sum_e for e in exps]
        best_idx = max(range(len(classes)), key=lambda i: probs[i])
        print(f"  {sample:<56} -> {classes[best_idx]:<16} (conf: {probs[best_idx]*100:5.1f}%)")

    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    print(f"Total time for {len(test_samples)} predictions: {elapsed_ms:.2f} ms ({elapsed_ms/len(test_samples):.3f} ms/tx)")


def main() -> None:
    texts, labels = load_dataset(INPUT_CSV)
    if HAS_SKLEARN:
        model_data = train_with_sklearn(texts, labels)
    else:
        model_data = train_exact_compatible(texts, labels)

    export_static_json(model_data, len(texts), OUTPUT_JSON)
    verify_submillisecond_inference(OUTPUT_JSON)


if __name__ == "__main__":
    main()
