export const normalizeForSearch = (input: string): string =>
  input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const lenA = a.length;
  const lenB = b.length;
  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  const prev = new Array<number>(lenB + 1);
  const curr = new Array<number>(lenB + 1);

  for (let j = 0; j <= lenB; j += 1) {
    prev[j] = j;
  }

  for (let i = 1; i <= lenA; i += 1) {
    curr[0] = i;
    const charA = a.charCodeAt(i - 1);

    for (let j = 1; j <= lenB; j += 1) {
      const cost = charA === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost, // substitution
      );
    }

    for (let j = 0; j <= lenB; j += 1) {
      prev[j] = curr[j];
    }
  }

  return prev[lenB];
};

const computeNormalizedSimilarity = (left: string, right: string): number => {
  if (!left || !right) return 0;
  if (left === right) return 1;

  if (left.includes(right)) {
    const bonus = Math.min(right.length / left.length, 0.2);
    return Math.min(1, 0.8 + bonus);
  }
  if (right.includes(left)) {
    const bonus = Math.min(left.length / right.length, 0.2);
    return Math.min(1, 0.8 + bonus);
  }

  const distance = levenshteinDistance(left, right);
  const maxLen = Math.max(left.length, right.length);
  const baseScore = maxLen === 0 ? 0 : 1 - distance / maxLen;

  const tokensA = new Set(left.split(" ").filter(Boolean));
  const tokensB = new Set(right.split(" ").filter(Boolean));
  let overlap = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) overlap += 1;
  }
  const tokenBonus =
    tokensA.size === 0 || tokensB.size === 0
      ? 0
      : Math.min(overlap / Math.min(tokensA.size, tokensB.size), 1) * 0.2;

  const prefixBonus = left.startsWith(right) || right.startsWith(left) ? 0.1 : 0;

  return Math.max(0, Math.min(1, baseScore + tokenBonus + prefixBonus));
};

export const computeStringSimilarity = (a: string, b: string): number =>
  computeNormalizedSimilarity(normalizeForSearch(a), normalizeForSearch(b));

export const computeSimilarityFromNormalized = (normalizedA: string, normalizedB: string): number =>
  computeNormalizedSimilarity(normalizedA, normalizedB);
