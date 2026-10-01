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

/** Whitespace-delimited word count, used for length checks. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
