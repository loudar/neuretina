/** Levenshtein edit distance between two strings. */
export function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + cost,
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length]!;
}

/** 0…1 similarity (1 = identical), case-insensitive. */
export function textSimilarity(a: string, b: string): number {
  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();
  const longest = Math.max(left.length, right.length);
  if (longest === 0) return 1;
  return 1 - levenshteinDistance(left, right) / longest;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "in",
  "into", "is", "it", "its", "of", "on", "or", "over", "that", "the", "their",
  "to", "was", "were", "will", "with",
]);

/** Content words only: lowercase, camelCase split, punctuation dropped, stopwords removed. */
export function contentWords(text: string): Set<string> {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word && !STOPWORDS.has(word));
  return new Set(words);
}

/**
 * 0…1 similarity from shared content words: 1 means the shorter text's key
 * terms all appear in the longer one. Single-word overlaps are ignored (too
 * generic) unless one text is a single word.
 */
export function tokenSimilarity(a: string, b: string): number {
  const left = contentWords(a);
  const right = contentWords(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared++;
  if (shared === 0 || (shared === 1 && Math.min(left.size, right.size) > 1)) return 0;
  return shared / Math.min(left.size, right.size);
}

/** Whitespace-delimited word count, used for length checks. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Filesystem/URL-friendly slug; falls back to "untitled" when nothing is left. */
export function slugify(text: string, maxLength = 48): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "untitled";
}
