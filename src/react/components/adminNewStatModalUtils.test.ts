import { describe, expect, it } from "vitest";
import {
  DEFAULT_CENSUS_DATASET,
  filterStatsBySearch,
  formatPredicateTypeLabel,
  getConceptDisplay,
  getPendingSelections,
  getPredicateTypeSummary,
  getRelationshipConfigError,
  getYearRange,
  inferDatasetForGroup,
  inferUniverseFromConcept,
  looksLikeGroupId,
  type CensusVariablePreview,
  type VariableSelection,
} from "./adminNewStatModalUtils";

const variable = (overrides: Partial<CensusVariablePreview>): CensusVariablePreview => ({
  name: "B01001_001E",
  label: "Estimate!!Total",
  inferredType: "count",
  statName: "Total population",
  zipCount: 1,
  countyCount: 1,
  ...overrides,
});

const selection = (overrides: Partial<VariableSelection>): VariableSelection => ({
  selected: true,
  yearEnd: 2023,
  yearStart: null,
  relationship: "none",
  statAttribute: "",
  lockedImported: false,
  importedStatId: null,
  importedStatLabel: null,
  importedStatName: null,
  ...overrides,
});

describe("adminNewStatModalUtils", () => {
  it("normalizes Census predicate type labels", () => {
    expect(formatPredicateTypeLabel("int")).toBe("Whole number");
    expect(formatPredicateTypeLabel("double")).toBe("Decimal number");
    expect(formatPredicateTypeLabel("bool")).toBe("Yes/No");
    expect(formatPredicateTypeLabel("custom")).toBe("Custom");
    expect(formatPredicateTypeLabel(" ")).toBeNull();
  });

  it("infers universe text and group ids", () => {
    expect(inferUniverseFromConcept("Food stamps for households")).toBe("households");
    expect(inferUniverseFromConcept("Income among the population 25 years and over")).toBe(
      "population 25 years and over",
    );
    expect(inferUniverseFromConcept("Total population")).toBeNull();
    expect(looksLikeGroupId("B22003")).toBe(true);
    expect(looksLikeGroupId("DP02")).toBe(true);
    expect(looksLikeGroupId("food insecurity")).toBe(false);
  });

  it("infers the default Census dataset from group prefix", () => {
    expect(inferDatasetForGroup("DP02", DEFAULT_CENSUS_DATASET)).toEqual({
      dataset: "acs/acs5/profile",
      changed: true,
    });
    expect(inferDatasetForGroup("S1701", DEFAULT_CENSUS_DATASET)).toEqual({
      dataset: "acs/acs5/subject",
      changed: true,
    });
    expect(inferDatasetForGroup("DP02", "acs/acs5/subject")).toEqual({
      dataset: "acs/acs5/subject",
      changed: false,
    });
  });

  it("filters stats by label, name, or NE id", () => {
    const stats = [
      { id: "1", name: "Population", label: "Total people", category: "demographics", neId: "census:B01001" },
      { id: "2", name: "Income", label: "Median income", category: "economy", neId: "census:B19013" },
    ];

    expect(filterStatsBySearch(stats, "income")).toEqual([stats[1]]);
    expect(filterStatsBySearch(stats, "B01001")).toEqual([stats[0]]);
    expect(filterStatsBySearch(stats, "", 1)).toEqual([stats[0]]);
  });

  it("calculates import year ranges", () => {
    expect(getYearRange({ yearStart: 2021, yearEnd: 2023 }, 2020)).toEqual({ year: 2023, years: 3 });
    expect(getYearRange({ yearStart: null, yearEnd: 2023 }, 2020)).toEqual({ year: 2023, years: 1 });
    expect(getYearRange({ yearStart: 2021, yearEnd: null }, 2020)).toEqual({ year: 2021, years: 1 });
    expect(getYearRange({ yearStart: null, yearEnd: null }, 2020)).toEqual({ year: 2020, years: 1 });
  });

  it("summarizes predicate types and concepts", () => {
    expect(getPredicateTypeSummary([variable({ predicateType: "int" })])).toBe("Whole number");
    expect(
      getPredicateTypeSummary([
        variable({ predicateType: "int" }),
        variable({ name: "B01001_002E", predicateType: "float" }),
      ]),
    ).toBe("Mixed (Whole number, Decimal number)");

    expect(getConceptDisplay([], "Fallback concept")).toEqual({
      shared: "Fallback concept",
      showPerVariable: false,
    });
    expect(
      getConceptDisplay([
        variable({ concept: "Age by sex" }),
        variable({ name: "B01001_002E", concept: "Age by sex" }),
      ]),
    ).toEqual({ shared: "Age by sex", showPerVariable: false });
    expect(
      getConceptDisplay([
        variable({ concept: "Age by sex" }),
        variable({ name: "B01001_002E", concept: "Income" }),
      ]),
    ).toEqual({ shared: null, showPerVariable: true });
  });

  it("returns only unlocked pending selections", () => {
    expect(
      getPendingSelections(
        [variable({ name: "a" }), variable({ name: "b" }), variable({ name: "c" })],
        {
          a: selection({ yearStart: 2021, yearEnd: 2023 }),
          b: selection({ selected: false }),
          c: selection({ lockedImported: true }),
        },
        2020,
      ),
    ).toEqual([{ variable: "a", year: 2023, years: 3 }]);
  });

  it("validates parent and child relationship configuration", () => {
    expect(
      getRelationshipConfigError({
        selection: { a: selection({ relationship: "parent" }), b: selection({ relationship: "parent" }) },
        hasManualParent: false,
        pendingSelectionCount: 2,
      }),
    ).toBe("Only one Parent is allowed per import.");

    expect(
      getRelationshipConfigError({
        selection: { a: selection({ relationship: "none" }) },
        hasManualParent: true,
        pendingSelectionCount: 1,
      }),
    ).toBe("Parent selected but no Child stats selected. Mark at least one variable as Child.");

    expect(
      getRelationshipConfigError({
        selection: { a: selection({ relationship: "child" }) },
        hasManualParent: false,
        pendingSelectionCount: 1,
      }),
    ).toBe("Select exactly one Parent when using Child relationships.");

    expect(
      getRelationshipConfigError({
        selection: { a: selection({ relationship: "parent" }), b: selection({ relationship: "child" }) },
        hasManualParent: false,
        pendingSelectionCount: 2,
      }),
    ).toBeNull();
  });
});
