import { useMemo } from "react";
import type { Organization } from "../../types/organization";
import type { Stat } from "../../types/stat";
import { CITY_SEARCH_TARGETS } from "../lib/citySearchTargets";
import { computeSimilarityFromNormalized, normalizeForSearch } from "../lib/fuzzyMatch";
import { looksLikeAddress } from "../lib/geocoding";

export interface SidebarSearchResult {
  type: "org" | "stat" | "city" | "address";
  id: string;
  label: string;
  sublabel?: string;
  score: number;
}

interface UseSidebarSearchArgs {
  query: string;
  organizations: Organization[];
  statsById: Map<string, Stat>;
  maxResults?: number;
}

const MIN_QUERY_LENGTH = 2;
const MIN_SCORE = 0.3;
const MAX_ORG_RESULTS = 3;
const MAX_STAT_RESULTS = 2;
const MAX_CITY_RESULTS = 2;
const ZIP_OR_PARTIAL_ZIP_PATTERN = /^\d{3,5}$/;

type IndexedCandidate<T> = {
  item: T;
  normalizedValues: string[];
};

const getBestScore = (normalizedQuery: string, normalizedValues: string[]): number => {
  let bestScore = 0;
  for (const value of normalizedValues) {
    const score = computeSimilarityFromNormalized(normalizedQuery, value);
    if (score > bestScore) {
      bestScore = score;
    }
  }
  return bestScore;
};

export const useSidebarSearch = ({
  query,
  organizations,
  statsById,
  maxResults = 5,
}: UseSidebarSearchArgs): SidebarSearchResult[] => {
  const normalizedOrganizations = useMemo<IndexedCandidate<Organization>[]>(() => {
    return organizations.map((organization) => ({
      item: organization,
      normalizedValues: [normalizeForSearch(organization.name)],
    }));
  }, [organizations]);

  const normalizedStats = useMemo<IndexedCandidate<Stat>[]>(() => {
    return Array.from(statsById.values()).map((stat) => ({
      item: stat,
      normalizedValues: [normalizeForSearch(stat.label || stat.name)],
    }));
  }, [statsById]);

  const normalizedCities = useMemo<IndexedCandidate<(typeof CITY_SEARCH_TARGETS)[number]>[]>(() => {
    return CITY_SEARCH_TARGETS.map((city) => {
      // Score each city against both the canonical name and known aliases.
      const allNames = new Set<string>([city.name, ...city.aliases]);
      return {
        item: city,
        normalizedValues: Array.from(allNames).map((name) => normalizeForSearch(name)),
      };
    });
  }, []);

  return useMemo(() => {
    const trimmedQuery = query.trim();
    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      return [];
    }

    if (looksLikeAddress(trimmedQuery) || ZIP_OR_PARTIAL_ZIP_PATTERN.test(trimmedQuery)) {
      return [
        {
          type: "address",
          id: trimmedQuery,
          label: trimmedQuery,
          sublabel: "Go to location",
          score: 1,
        },
      ];
    }

    const normalizedQuery = normalizeForSearch(trimmedQuery);
    if (!normalizedQuery) {
      return [];
    }

    const organizationResults: SidebarSearchResult[] = [];
    for (const entry of normalizedOrganizations) {
      const score = getBestScore(normalizedQuery, entry.normalizedValues);
      if (score <= MIN_SCORE) continue;
      organizationResults.push({
        type: "org",
        id: entry.item.id,
        label: entry.item.name,
        sublabel: `Organization - ${entry.item.category}`,
        score,
      });
    }
    organizationResults.sort((left, right) => right.score - left.score);
    const topOrganizationResults = organizationResults.slice(0, MAX_ORG_RESULTS);

    const statResults: SidebarSearchResult[] = [];
    for (const entry of normalizedStats) {
      const score = getBestScore(normalizedQuery, entry.normalizedValues);
      if (score <= MIN_SCORE) continue;
      statResults.push({
        type: "stat",
        id: entry.item.id,
        label: entry.item.label || entry.item.name,
        sublabel: `Statistic - ${entry.item.category}`,
        score,
      });
    }
    statResults.sort((left, right) => right.score - left.score);
    const topStatResults = statResults.slice(0, MAX_STAT_RESULTS);

    const cityResults: SidebarSearchResult[] = [];
    for (const entry of normalizedCities) {
      const score = getBestScore(normalizedQuery, entry.normalizedValues);
      if (score <= MIN_SCORE) continue;
      cityResults.push({
        type: "city",
        id: entry.item.name,
        label: entry.item.name,
        sublabel: "City",
        score,
      });
    }
    cityResults.sort((left, right) => right.score - left.score);
    const topCityResults = cityResults.slice(0, MAX_CITY_RESULTS);

    return [...topOrganizationResults, ...topStatResults, ...topCityResults]
      .sort((left, right) => {
        if (right.score !== left.score) {
          return right.score - left.score;
        }
        return left.label.localeCompare(right.label);
      })
      .slice(0, maxResults);
  }, [maxResults, normalizedCities, normalizedOrganizations, normalizedStats, query]);
};
