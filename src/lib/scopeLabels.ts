const normalizeWords = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");

export const normalizeScopeLabel = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return normalizeWords(trimmed);
};

const stripOklahomaSuffix = (value: string): string =>
  value.replace(/,\s*Oklahoma$/i, "").trim();

const stripCountySuffix = (value: string): string =>
  value.replace(/\s+County$/i, "").trim();

export const formatCountyScopeLabel = (value: string | null | undefined): string | null => {
  const normalized = normalizeScopeLabel(value);
  if (!normalized) return null;
  const withoutCounty = stripCountySuffix(stripOklahomaSuffix(normalized));
  const base = normalizeScopeLabel(withoutCounty);
  if (!base) return null;
  return `${base} County`;
};

export const buildScopeLabelAliases = (value: string | null | undefined): string[] => {
  const aliases = new Set<string>();
  const normalized = normalizeScopeLabel(value);
  if (!normalized) return [];
  aliases.add(normalized);

  const formattedCounty = formatCountyScopeLabel(value);
  if (formattedCounty) aliases.add(formattedCounty);

  const withoutSuffixes = stripCountySuffix(stripOklahomaSuffix(normalized));
  const base = normalizeScopeLabel(withoutSuffixes);
  if (base) aliases.add(base);

  return Array.from(aliases);
};
