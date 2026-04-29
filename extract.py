import argparse
import pandas as pd
import re
from collections import Counter
import json
import sys
import os

# ── LLM Backend — uncomment ONE block ────────────────────────────────────────

# --- Ollama (local) ---
import ollama
MODEL = "codellama:13b"

# --- Anthropic / Claude ---
# import anthropic, os
# from dotenv import load_dotenv
# load_dotenv()
# api_key = os.getenv('pref_llm_key')

# if not api_key:
#     raise ValueError("CRITICAL: 'pref-llm-key' not found. Check your .env file!")

# client = anthropic.Anthropic(api_key=api_key)
# MODEL = "claude-haiku-4-5-20251001"

# ─────────────────────────────────────────────────────────────────────────────
DATA_PATH       = "all_data_files/experiments/data.csv"
OUTPUT_PATH     = "aspects_by_domain3.csv"
MAX_RETRIES     = 3
DEFAULT_COLUMN  = "sentence"

PROMPT_TEMPLATE = (
    "You are extracting comparison aspects from a sentence about products or brands.\n"
    "An aspect is a specific, concrete feature or attribute that could be compared between two products. \n"
    "Rules:\n"
    "1. Only return genuine product features or attributes — NOT brand names, NOT sentiment words "
    "(love, hate, great, bad, good, worst), NOT vague words (things, factors, options).\n"
    "2. The aspect must be something you could rate or measure on a product.\n"
    "3. List one aspect per line in lowercase. Use 2-3 words max per aspect.\n"
    "4. If no specific feature is mentioned, write 'none' and nothing else.\n\n"
    "Sentence: {sentence}"
)

# ── Validation ────────────────────────────────────────────────────────────────
STOPWORDS = {
    "and", "or", "but", "the", "a", "an", "in", "on", "at", "to", "for",
    "of", "with", "is", "are", "was", "were", "it", "its", "this", "that",
    "than", "more", "much", "very", "just", "get", "got", "can", "will",
    "would", "also", "not", "no", "yes", "so", "if", "as", "by", "be",
    "have", "has", "had", "do", "does", "did", "their", "same", "better",
    "worse", "good", "bad", "two", "one", "my", "your", "we", "they",
    "new", "old", "big", "little", "used", "make", "made", "get", "way",
    "even", "still", "well", "really", "actually", "usually", "often",
    "always", "never", "least", "most", "some", "all", "both", "each"
}

KNOWN_BRANDS = {
    "toyota", "ford", "honda", "bmw", "nissan", "chevrolet", "chevy",
    "mercedes", "mercedes-benz", "audi", "lexus", "hyundai", "kia",
    "apple", "google", "microsoft", "samsung", "sony", "dell", "hp",
    "nvidia", "amd", "intel", "amazon", "facebook", "meta", "twitter",
    "canon", "nikon", "leica", "sigma", "lenovo", "asus", "gigabyte",
    "playstation", "xbox", "nintendo", "pepsi", "coca-cola", "adidas",
    "nike", "cisco", "minolta", "toshiba", "motorola", "nokia", "lg",
    "buick", "dodge", "ram", "jeep", "lincoln", "cadillac", "gmc",
    "subaru", "mazda", "mitsubishi", "volvo", "volkswagen", "vw"
}


SENTIMENT_WORDS = {
    "love", "hate", "like", "dislike", "great", "good", "bad", "worst", "best",
    "amazing", "terrible", "awesome", "awful", "nice", "poor", "excellent",
    "horrible", "fantastic", "disappointing", "impressive", "boring"
}

GARBAGE_PHRASES = {
    "none", "not mentioned", "no specific", "specific features", "no features",
    "not applicable", "n/a", "nothing", "nothing mentioned"
}

def is_valid_aspect(aspect: str, object_a: str, object_b: str) -> bool:
    a = aspect.lower().strip()

    if not a or len(a) < 3:
        return False
    if re.fullmatch(r'[\d\s]+', a):
        return False
    if a in STOPWORDS:
        return False
    if a in KNOWN_BRANDS:
        return False
    if a in SENTIMENT_WORDS:
        return False
    # Reject anything that looks like a "none" response or garbage
    if any(g in a for g in GARBAGE_PHRASES):
        return False

    for subj in [object_a.lower(), object_b.lower()]:
        if subj and (subj in a or a in subj):
            return False

    if len(a.split()) > 4:
        return False

    return True


def query_ollama(sentence):
    prompt = PROMPT_TEMPLATE.format(sentence=sentence)

    # --- Ollama ---
    response = ollama.chat(model=MODEL, messages=[{"role": "user", "content": prompt}])
    return response["message"]["content"]

    # --- Anthropic / Claude ---
    # response = client.messages.create(
    #     model=MODEL,
    #     max_tokens=256,
    #     messages=[{"role": "user", "content": prompt}]
    # )
    # return response.content[0].text


def parse_aspects(response_text, object_a, object_b):
    aspects = []
    for line in response_text.strip().splitlines():
        cleaned = line.strip().lstrip("•*-0123456789.) ").strip().lower()
        cleaned = re.sub(r"[^a-z0-9 /'-]", "", cleaned).strip()
        if cleaned and cleaned != "none" and len(cleaned) > 1:
            if is_valid_aspect(cleaned, object_a, object_b):
                aspects.append(cleaned)
    return aspects


def extract_with_retry(sentence, object_a, object_b):
    """
    Query LLM up to MAX_RETRIES times.
    Retries if no valid aspects are found after filtering.
    Returns best result across attempts.
    """
    best = []
    for attempt in range(MAX_RETRIES):
        try:
            response = query_ollama(sentence)
            aspects  = parse_aspects(response, object_a, object_b)
            if aspects:
                return aspects          # good result, stop retrying
            if attempt < MAX_RETRIES - 1:
                pass                    # silent retry
        except Exception as e:
            print(f"    Retry {attempt+1} error: {e}", file=sys.stderr)
    return best                         # empty if all retries failed


def get_domain_aspects(df, domain, text_column=DEFAULT_COLUMN, limit=None):
    aspect_counter = Counter()
    rows = list(df.itertuples())
    if limit:
        rows = rows[:limit]

    print(f"\n{'='*60}")
    print(f"Domain: {domain} ({len(rows)} sentences)")
    print(f"{'='*60}")

    retry_count = 0

    for i, row in enumerate(rows, 1):
        sentence = getattr(row, text_column.replace(" ", "_"), None)
        if sentence is None:
            # pandas converts spaces to underscores in itertuples; try Index lookup
            sentence = df.iloc[row.Index][text_column] if text_column in df.columns else None
        object_a = str(row.object_a) if hasattr(row, 'object_a') else ""
        object_b = str(row.object_b) if hasattr(row, 'object_b') else ""

        if sentence is None or (isinstance(sentence, float) and pd.isna(sentence)):
            continue

        if i % 100 == 0 or i == 1:
            print(f"  Processing {i}/{len(rows)}... (retries so far: {retry_count})")

        aspects = extract_with_retry(str(sentence), object_a, object_b)

        if not aspects:
            retry_count += 1

        aspect_counter.update(aspects)

    sorted_aspects = aspect_counter.most_common()
    print_domain_aspects(domain, sorted_aspects)
    print(f"  Total sentences that yielded no valid aspect: {retry_count}")

    return [{"domain": domain, "aspect": aspect, "count": count}
            for aspect, count in sorted_aspects]


def print_domain_aspects(domain, sorted_aspects):
    print(f"\nTop aspects for '{domain}':")
    for aspect, count in sorted_aspects[:20]:
        print(f"  {count:>5}  {aspect}")
    print(f"  ... ({len(sorted_aspects)} unique aspects total)")


def parse_args():
    parser = argparse.ArgumentParser(description="Extract aspects from a CSV using an LLM.")
    parser.add_argument(
        "-i", "--input",
        default=DATA_PATH,
        help="Path to input CSV file (default: %(default)s)",
    )
    parser.add_argument(
        "-c", "--column",
        default=DEFAULT_COLUMN,
        help="Column name in the CSV containing the text to extract aspects from (default: %(default)s)",
    )
    parser.add_argument(
        "-d", "--domain",
        default=None,
        help=(
            "Domain label to use in output. "
            "If the CSV has a 'domain' column and this flag is omitted, the first domain is used. "
            "When provided, the entire (optionally limited) CSV is treated as this domain."
        ),
    )
    parser.add_argument(
        "-n", "--limit",
        type=int,
        default=None,
        help="Maximum number of rows to process (default: all rows)",
    )
    parser.add_argument(
        "-o", "--output",
        default=OUTPUT_PATH,
        help="Path to output CSV file (default: %(default)s)",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    df = pd.read_csv(args.input)

    # Validate column
    if args.column not in df.columns:
        raise ValueError(
            f"Column '{args.column}' not found in {args.input}. "
            f"Available columns: {list(df.columns)}"
        )

    if args.domain:
        # User supplied a domain: treat the whole (limited) CSV as one domain
        domain = args.domain
        subset = df
    elif "domain" in df.columns:
        # Fall back to first domain in the domain column (original behaviour)
        domain = df["domain"].unique()[0]
        subset = df[df["domain"] == domain]
    else:
        raise ValueError(
            "No --domain flag provided and no 'domain' column found in the CSV."
        )

    results = get_domain_aspects(subset, domain, text_column=args.column, limit=args.limit)

    results_df = pd.DataFrame(results)
    results_df.to_csv(args.output, index=False)
    print(f"\nResults saved to {args.output}")


if __name__ == "__main__":
    # Check if we are being called with a single sentence argument
    if len(sys.argv) > 1:
        sentence = sys.argv[1]
        # In a real app, you might pass object_a/b too, 
        # but for now we'll use empty strings
        aspects = extract_with_retry(sentence, "", "")
        print(json.dumps(aspects))
    else:
        # Fallback to your original CSV batch logic
        main()