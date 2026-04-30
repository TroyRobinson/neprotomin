const ORG_REVENUE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatOrgRevenueLine = (
  annualRevenue: number | null | undefined,
  annualRevenueTaxPeriod: number | null | undefined,
): string | null => {
  if (typeof annualRevenue !== "number" || !Number.isFinite(annualRevenue) || annualRevenue <= 0) return null;
  const amountLabel = ORG_REVENUE_FORMATTER.format(annualRevenue);
  const year =
    typeof annualRevenueTaxPeriod === "number"
      && Number.isFinite(annualRevenueTaxPeriod)
      && annualRevenueTaxPeriod >= 1900
      && annualRevenueTaxPeriod <= 2500
      ? annualRevenueTaxPeriod
      : null;
  return year ? `Revenue ${amountLabel} (${year})` : `Revenue ${amountLabel}`;
};

export const preventTrailingWordOrphan = (text: string): string => {
  const normalized = text.trim().replace(/\s+/g, " ");
  const words = normalized.split(" ");
  if (words.length < 2) return normalized;
  const lastWord = words[words.length - 1];
  const shouldBindLastWord =
    /^(inc|inc\.|llc|co|co\.|corp|corp\.|ltd|ltd\.|pllc|pc|lp|llp)$/i.test(lastWord)
    || lastWord.length <= 4;
  if (!shouldBindLastWord) return normalized;
  const penultimateWord = words[words.length - 2];
  words[words.length - 2] = `${penultimateWord}\u00A0${lastWord}`;
  words.pop();
  return words.join(" ");
};
