#!/usr/bin/env node

import type { CensusVariableMeta, DataMaps } from './censusUtils';
import {
  parseCensusArgs,
  fetchGroupMetadata,
  resolveVariables,
  fetchZipData,
  fetchCountyData,
  buildDataMaps,
  buildPercentageDataMaps,
  sumDataMaps,
  buildStatDataPayloads,
  deriveStatName,
  createInstantClient,
  ensureStatRecord,
  applyStatDataPayloads,
  inferStatType,
  summarizeDataMaps,
  CENSUS_TABLE_DOC_URL,
} from './censusUtils';

const buildYearRange = (start: number, count: number): number[] => {
  const years: number[] = [];
  for (let i = 0; i < count; i += 1) {
    years.push(start - i);
  }
  return years;
};

const DERIVED_ONLY_VARIABLES = new Set(['B12001_001E', 'B12001_004E', 'B12001_010E']);

const CATEGORY_OVERRIDES: Record<string, string> = {
  B01003_001E: 'demographics',
  B01002_001E: 'demographics',
  B12001_MARRIED_PERCENT: 'demographics',
};

async function main() {
  const baseOptions = parseCensusArgs();
  const years = buildYearRange(baseOptions.year, Math.max(1, baseOptions.years));
  console.log('Census loader');
  console.log(`  dataset : ${baseOptions.dataset}`);
  console.log(`  group   : ${baseOptions.group}`);
  console.log(`  years   : ${years.join(', ')}`);
  console.log(`  include MOE : ${baseOptions.includeMoe ? 'yes' : 'no'}`);
  console.log(baseOptions.dryRun ? '  mode    : DRY RUN (no writes)' : '  mode    : WRITE');

  const db = baseOptions.dryRun ? null : createInstantClient();

  for (const year of years) {
    const options = { ...baseOptions, year };
    console.log(`\n=== Year ${year} ===`);

    const groupMeta = await fetchGroupMetadata(options);
    const { estimates, moeMap } = resolveVariables(options, groupMeta);
    const processedThisYear = new Map<string, {
      statId?: string;
      statName: string;
      statType: string;
      dataMaps: DataMaps;
      censusVariable: string;
    }>();

    if (!estimates.length) {
      console.log('No estimate variables resolved for this group/year.');
      continue;
    }

    const moeVariables = Array.from(moeMap.values());
    const zipPayload = await fetchZipData(options, estimates, moeVariables);
    const countyPayload = await fetchCountyData(options, estimates, moeVariables);

    for (const variable of estimates) {
      const variableMeta = groupMeta.variables.get(variable);
      if (!variableMeta) continue;
      const statName = deriveStatName(variable, variableMeta, groupMeta);
      const statType = inferStatType(variableMeta);
      const dataMaps = buildDataMaps(
        variable,
        moeMap.get(variable) ?? null,
        zipPayload,
        countyPayload,
      );
      const summary = summarizeDataMaps(dataMaps);
      const isDerivedOnly = DERIVED_ONLY_VARIABLES.has(variable);
      console.log(
        `• ${variable} → ${statName} [${summary.zipCount} zips, ${summary.countyCount} counties]${isDerivedOnly ? ' (derived only)' : ''}`,
      );

      processedThisYear.set(variable, {
        statName,
        statType,
        dataMaps,
        censusVariable: variable,
      });

      if (baseOptions.dryRun) {
        continue;
      }

      if (!db) throw new Error('InstantDB client not initialized');
      if (isDerivedOnly) {
        continue;
      }

      const categoryOverride = CATEGORY_OVERRIDES[variable];
      const { statId, statType: ensuredType } = await ensureStatRecord(
        db,
        statName,
        variableMeta,
        groupMeta,
        categoryOverride,
      );
      const payloads = buildStatDataPayloads(statId, statName, ensuredType, dataMaps, {
        censusVariable: variable,
        censusSurvey: options.survey,
        censusUniverse: groupMeta.universe,
        censusTableUrl: CENSUS_TABLE_DOC_URL(year, options.dataset, options.group),
        year,
      });

      if (baseOptions.debug) {
        const zipPayloadCount = payloads.filter((p) => p.boundaryType === 'ZIP').length;
        const countyPayloadCount = payloads.filter((p) => p.boundaryType === 'COUNTY').length;
        const uniqueZipParents = new Set(payloads.filter((p) => p.boundaryType === 'ZIP').map((p) => p.parentArea));
        console.log(
          `  payloads -> ZIP: ${zipPayloadCount} (parents: ${uniqueZipParents.size}${
            uniqueZipParents.size <= 10 ? ` sample=${JSON.stringify(Array.from(uniqueZipParents).slice(0, 10))}` : ""
          }), COUNTY: ${countyPayloadCount}`,
        );
      }
      await applyStatDataPayloads(db, payloads);

      processedThisYear.set(variable, {
        statId,
        statName,
        statType: ensuredType,
        dataMaps,
        censusVariable: variable,
      });
    }

    const numerator = processedThisYear.get('B22003_002E');
    const denominator = processedThisYear.get('B22003_001E');
    if (!baseOptions.dryRun && db && numerator && denominator) {
      const percentName = `${numerator.statName} (Percent)`;
      const percentVariable = `${numerator.censusVariable}_PCT`;
      const percentMeta = {
        name: percentVariable,
        label: percentName,
        concept: 'Percentage of households receiving SNAP',
        predicateType: 'float',
      } as CensusVariableMeta;
      const { statId: percentStatId } = await ensureStatRecord(db, percentName, percentMeta, groupMeta, CATEGORY_OVERRIDES[percentVariable]);
      const percentMaps = buildPercentageDataMaps(numerator.dataMaps, denominator.dataMaps);
      const percentPayloads = buildStatDataPayloads(percentStatId, percentName, 'percent', percentMaps, {
        censusVariable: percentVariable,
        censusSurvey: options.survey,
        censusUniverse: groupMeta.universe,
        censusTableUrl: CENSUS_TABLE_DOC_URL(year, options.dataset, options.group),
        year,
      });
      if (baseOptions.debug) {
        const uniqueZipParents = new Set(percentPayloads.filter((p) => p.boundaryType === 'ZIP').map((p) => p.parentArea));
        console.log(
          `  derived percent -> ZIP: ${percentPayloads.filter((p) => p.boundaryType === 'ZIP').length} (parents: ${uniqueZipParents.size}), COUNTY: ${percentPayloads.filter((p) => p.boundaryType === 'COUNTY').length}`,
        );
      }
      await applyStatDataPayloads(db, percentPayloads);
    } else if (baseOptions.debug) {
      console.warn('  Skipping percent stat – missing numerator/denominator or dry-run mode.');
    }

    const marriedMale = processedThisYear.get('B12001_004E');
    const marriedFemale = processedThisYear.get('B12001_010E');
    const adultPopulation = processedThisYear.get('B12001_001E');
    if (!baseOptions.dryRun && db && marriedMale && marriedFemale && adultPopulation) {
      const marriedTotalMaps = sumDataMaps(marriedMale.dataMaps, marriedFemale.dataMaps);
      const percentName = 'Married Percent';
      const percentVariable = 'B12001_MARRIED_PERCENT';
      const percentMeta = {
        name: percentVariable,
        label: percentName,
        concept: 'Percentage of adults currently married',
        predicateType: 'float',
      } as CensusVariableMeta;
      const { statId: marriedPercentId } = await ensureStatRecord(
        db,
        percentName,
        percentMeta,
        groupMeta,
        CATEGORY_OVERRIDES[percentVariable],
      );
      const marriedPercentMaps = buildPercentageDataMaps(marriedTotalMaps, adultPopulation.dataMaps);
      const marriedPercentPayloads = buildStatDataPayloads(marriedPercentId, percentName, 'percent', marriedPercentMaps, {
        censusVariable: percentVariable,
        censusSurvey: options.survey,
        censusUniverse: groupMeta.universe,
        censusTableUrl: CENSUS_TABLE_DOC_URL(year, options.dataset, options.group),
        year,
      });
      if (baseOptions.debug) {
        const uniqueZipParents = new Set(
          marriedPercentPayloads.filter((p) => p.boundaryType === 'ZIP').map((p) => p.parentArea),
        );
        console.log(
          `  derived married percent -> ZIP: ${marriedPercentPayloads.filter((p) => p.boundaryType === 'ZIP').length} (parents: ${uniqueZipParents.size}), COUNTY: ${marriedPercentPayloads.filter((p) => p.boundaryType === 'COUNTY').length}`,
        );
      }
      await applyStatDataPayloads(db, marriedPercentPayloads);
    } else if (baseOptions.debug) {
      console.warn('  Skipping married percent – missing numerator/denominator or dry-run mode.');
    }
  }

  console.log('\nCensus load complete.');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Census load failed:', error);
    if (error && typeof error === 'object' && 'body' in error) {
      try {
        console.error('Census load error body:', JSON.stringify((error as any).body, null, 2));
      } catch {}
    }
    process.exit(1);
  });
