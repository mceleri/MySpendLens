#!/usr/bin/env python3
"""
MySpendLens: Global Base Model Data Pipeline (Phase 3 - Synthetic Data Generation)

Reads `clean_anchors_it_es.csv` in chunks, calls the Gemini API (`gemini-3.8-flash`
via the current `google-genai` SDK and `client.interactions.create`) to synthesize
realistic, noisy bank statement descriptions with country-specific banking prefixes
and aggressive character truncations/vowel removals for character n-gram TF-IDF training.
Outputs `myspendlens_synthetic_training_it_es.csv`.
"""

import json
import os
import time
from typing import List

import pandas as pd
from google import genai
from pydantic import BaseModel, Field

# Note: Using the current `google-genai` SDK and `gemini-3.8-flash` model
# (substituting deprecated `google-generativeai` SDK and legacy models).
MODEL_ID = "gemini-3.8-flash"

INPUT_CSV = "clean_anchors_it_es.csv"
OUTPUT_CSV = "myspendlens_synthetic_training_it_es.csv"
CHUNK_SIZE = 10
RATE_LIMIT_SLEEP_SECONDS = 2.0

# Phase 1 Researched Banking Prefixes by Country
BANK_PREFIXES = {
    "IT": [
        "PAG. BANCOMAT",
        "PAG. POS",
        "PAGAMENTO POS",
        "ADDEBITO PREAUTORIZZATO",
        "CARTA CREDITO",
        "PAGAMENTO CARTA",
        "SDD SEPA",
        "ADDEBITO SDD",
        "ADDEBITO DIRETTO SDD",
        "PAGAMENTO CONTABILIZZATO",
        "OP. POS CARTA",
        "UTILIZZO CARTA",
        "PAG. CONTACTLESS",
        "BANCOMAT PAY",
        "COMMISSIONI E SPESE",
    ],
    "ES": [
        "COMPRA TARJETA",
        "PAGO CON TARJETA",
        "PAGO TARJETA",
        "RECIBO",
        "CARGO RECIBO",
        "CARGO REBO",
        "RECIBO DOMICILIADO",
        "ADEUDO SEPA",
        "ADEUDO POR DOMICILIACION",
        "LIQUIDACION",
        "CARGO EN CUENTA",
        "COMPRA EN COMERCIO",
        "OPERACION TARJETA",
        "BIZUM COMPRA",
    ],
}

PROMPT_TEMPLATE = """You are a data synthesis expert generating realistic bank statement descriptions for an ML training dataset.

Target Country: {Country}
Category: {Category}
Clean Brand Names: {List_of_Clean_Names}
Common Bank Prefixes for this country: {List_of_Prefixes_from_Phase_1}

For each Clean Brand Name, generate 4 realistic, noisy bank statement lines. 
Crucial rules for the output:
1. Apply banking prefixes (e.g., "PAG. POS 12/04", "COMPRA TARJETA").
2. Include random alphanumeric transaction IDs, dates, or city names at the end.
3. IMPORTANT: Apply realistic string truncations or vowel removals to the brand name in at least 2 of the 4 variations (e.g., "ESSELUNGA" -> "ESSLNG", "MERCADONA" -> "MRCDN MADRID", "CARREFOUR" -> "CRRFOUR"). Our ML model trains on character n-grams, so these truncations are the most valuable data.
4. Make it uppercase.

Return the result strictly as a JSON array of objects with keys: "noisy_string" and "category"."""


class SyntheticTransaction(BaseModel):
    noisy_string: str = Field(
        description="Uppercase noisy bank statement description with banking prefix, brand (truncated or full), and trailing date/city/ID."
    )
    category: str = Field(
        description="Standardized MySpendLens target category."
    )


# JSON Schema enforcing a top-level JSON array of objects with "noisy_string" and "category"
RESPONSE_JSON_SCHEMA = {
    "type": "array",
    "items": SyntheticTransaction.model_json_schema(),
}


def generate_batch_with_gemini(
    client: genai.Client,
    country: str,
    category: str,
    clean_names: List[str],
    max_retries: int = 3,
) -> List[dict]:
    """Send a chunk of Clean Brand Names for a given (Country, Category) to Gemini."""
    prefixes = BANK_PREFIXES.get(country, BANK_PREFIXES["IT"])
    prompt = PROMPT_TEMPLATE.format(
        Country=country,
        Category=category,
        List_of_Clean_Names=", ".join(clean_names),
        List_of_Prefixes_from_Phase_1=", ".join(prefixes),
    )

    for attempt in range(1, max_retries + 1):
        try:
            interaction = client.interactions.create(
                model=MODEL_ID,
                input=prompt,
                system_instruction=(
                    "You are a data synthesis expert generating realistic bank statement "
                    "descriptions for an ML training dataset. Always respond with valid JSON."
                ),
                response_format={
                    "type": "text",
                    "mime_type": "application/json",
                    "schema": RESPONSE_JSON_SCHEMA,
                },
            )

            raw_text = (interaction.output_text or "").strip()
            # Strip markdown code fences if present
            if raw_text.startswith("```"):
                raw_text = raw_text.strip("`")
                if raw_text.lower().startswith("json"):
                    raw_text = raw_text[4:].strip()

            parsed = json.loads(raw_text)
            if not isinstance(parsed, list):
                raise ValueError(f"Expected JSON array, got {type(parsed).__name__}")

            valid_rows = []
            for item in parsed:
                if isinstance(item, dict) and "noisy_string" in item and "category" in item:
                    valid_rows.append(
                        {
                            "Noisy_Description": str(item["noisy_string"]).strip().upper(),
                            "Target_Category": str(item["category"]).strip(),
                        }
                    )
            return valid_rows

        except json.JSONDecodeError as e:
            print(
                f"[WARN] Malformed JSON on attempt {attempt}/{max_retries} "
                f"for ({country}, {category}): {e}"
            )
        except Exception as e:
            print(
                f"[WARN] API error on attempt {attempt}/{max_retries} "
                f"for ({country}, {category}): {e}"
            )

        time.sleep(RATE_LIMIT_SLEEP_SECONDS * attempt)

    print(f"[ERROR] Skipping chunk for ({country}, {category}) after {max_retries} failed attempts.")
    return []


def run_pipeline(input_csv: str = INPUT_CSV, output_csv: str = OUTPUT_CSV) -> pd.DataFrame:
    """Main pipeline orchestrating chunked synthesis from clean_anchors_it_es.csv."""
    if not os.path.exists(input_csv):
        raise FileNotFoundError(f"Clean anchor dataset not found: {input_csv}")

    df_clean = pd.read_csv(input_csv)
    required_cols = {"Country", "Clean_Name", "Category"}
    if not required_cols.issubset(df_clean.columns):
        raise ValueError(f"Input CSV must contain columns {required_cols}")

    # Normalize & deduplicate clean anchors
    df_clean["Clean_Name"] = (
        df_clean["Clean_Name"]
        .astype(str)
        .str.upper()
        .str.replace(r"[^A-Z0-9\s]", "", regex=True)
        .str.replace(r"\s+", " ", regex=True)
        .str.strip()
    )
    df_clean = df_clean.drop_duplicates(subset=["Country", "Clean_Name"]).reset_index(drop=True)

    client = genai.Client()
    accumulated_rows: List[dict] = []

    # Group by (Country, Category) and iterate in chunks
    for (country, category), group in df_clean.groupby(["Country", "Category"]):
        names = group["Clean_Name"].tolist()
        for start_idx in range(0, len(names), CHUNK_SIZE):
            chunk_names = names[start_idx : start_idx + CHUNK_SIZE]
            print(
                f"Processing Country={country} | Category={category} | "
                f"Batch={start_idx // CHUNK_SIZE + 1} ({len(chunk_names)} brands)..."
            )
            batch_rows = generate_batch_with_gemini(
                client=client,
                country=str(country),
                category=str(category),
                clean_names=chunk_names,
            )
            accumulated_rows.extend(batch_rows)
            # Respect Gemini API rate limits between chunks
            time.sleep(RATE_LIMIT_SLEEP_SECONDS)

    df_out = pd.DataFrame(accumulated_rows, columns=["Noisy_Description", "Target_Category"])
    df_out.to_csv(output_csv, index=False)
    print(f"Saved {len(df_out)} synthetic training rows to {output_csv}")
    return df_out


if __name__ == "__main__":
    run_pipeline()
