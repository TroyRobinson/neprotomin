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

type CensusOptions = ReturnType<typeof parseCensusArgs>;

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

const mapRatio = (numerator: Map<string, number>, denominator: Map<string, number>): Map<string, number> => {
  const out = new Map<string, number>();
  for (const [key, num] of numerator.entries()) {
    const den = denominator.get(key);
    if (typeof num === 'number' && typeof den === 'number' && Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      out.set(key, num / den);
    }
  }
  return out;
};

const ratioDataMaps = (numerator: DataMaps, denominator: DataMaps): DataMaps => ({
  zip: mapRatio(numerator.zip, denominator.zip),
  zipMoe: new Map(),
  county: mapRatio(numerator.county, denominator.county),
  countyMoe: new Map(),
  countyZipBuckets: new Map(),
  countyZipMoe: undefined,
});

const sumMaps = (maps: DataMaps[]): DataMaps => {
  const sumNumberMaps = (entries: Map<string, number>[]): Map<string, number> => {
    const out = new Map<string, number>();
    for (const m of entries) {
      for (const [key, value] of m.entries()) {
        const next = (out.get(key) ?? 0) + value;
        if (Number.isFinite(next)) out.set(key, next);
      }
    }
    return out;
  };

  return {
    zip: sumNumberMaps(maps.map((m) => m.zip)),
    zipMoe: new Map(),
    county: sumNumberMaps(maps.map((m) => m.county)),
    countyMoe: new Map(),
    countyZipBuckets: new Map(),
    countyZipMoe: undefined,
  };
};

const subtractMaps = (a: DataMaps, b: DataMaps): DataMaps => {
  const subtractNumberMaps = (left: Map<string, number>, right: Map<string, number>): Map<string, number> => {
    const out = new Map<string, number>();
    const keys = new Set<string>([...left.keys(), ...right.keys()]);
    for (const key of keys) {
      const diff = (left.get(key) ?? 0) - (right.get(key) ?? 0);
      if (Number.isFinite(diff)) out.set(key, diff);
    }
    return out;
  };
  return {
    zip: subtractNumberMaps(a.zip, b.zip),
    zipMoe: new Map(),
    county: subtractNumberMaps(a.county, b.county),
    countyMoe: new Map(),
    countyZipBuckets: new Map(),
    countyZipMoe: undefined,
  };
};

const fetchDataMapsForVariables = async (
  options: CensusOptions,
  groupId: string,
  variables: string[],
): Promise<{ meta: Map<string, CensusVariableMeta>; dataMaps: Map<string, DataMaps>; groupMeta: any }> => {
  const groupMeta = await fetchGroupMetadata({ ...options, group: groupId });
  const meta = new Map<string, CensusVariableMeta>();
  for (const variable of variables) {
    const variableMeta = groupMeta.variables.get(variable);
    if (variableMeta) meta.set(variable, variableMeta);
  }
  const zipPayload = await fetchZipData({ ...options, group: groupId }, variables, []);
  const countyPayload = await fetchCountyData({ ...options, group: groupId }, variables, []);
  const dataMaps = new Map<string, DataMaps>();
  for (const variable of variables) {
    const maps = buildDataMaps(variable, null, zipPayload, countyPayload);
    dataMaps.set(variable, maps);
  }
  return { meta, dataMaps, groupMeta };
};

const loadBreakdowns = async ({
  options,
  populationStatId,
  db,
}: {
  options: CensusOptions;
  populationStatId: string;
  db: ReturnType<typeof createInstantClient>;
}) => {
  console.log('  Loading demographic breakdowns (ethnicity, income, education)…');

  // Ethnicity (B03002)
  const ethnicityVariables = ['B03002_001E', 'B03002_003E', 'B03002_004E', 'B03002_006E', 'B03002_012E'];
  const { dataMaps: ethnicityMaps, meta: ethnicityMeta } = await fetchDataMapsForVariables(options, 'B03002', ethnicityVariables);
  const ethnicityTotal = ethnicityMaps.get('B03002_001E');
  if (ethnicityTotal) {
    const white = ethnicityMaps.get('B03002_003E')!;
    const black = ethnicityMaps.get('B03002_004E')!;
    const asian = ethnicityMaps.get('B03002_006E')!;
    const hispanic = ethnicityMaps.get('B03002_012E')!;
    const knownSum = sumMaps([white, black, asian, hispanic]);
    const other = subtractMaps(ethnicityTotal, knownSum);
    const ethnicitySegments: Array<{ key: string; maps: DataMaps; source: string }> = [
      { key: 'white', maps: white, source: 'B03002_003E' },
      { key: 'black', maps: black, source: 'B03002_004E' },
      { key: 'asian', maps: asian, source: 'B03002_006E' },
      { key: 'hispanic', maps: hispanic, source: 'B03002_012E' },
      { key: 'other', maps: other, source: 'B03002_other' },
    ];
    for (const segment of ethnicitySegments) {
      const ratioMaps = ratioDataMaps(segment.maps, ethnicityTotal);
      const payloads = buildStatDataPayloads(
        populationStatId,
        `ethnicity:${segment.key}`,
        'percent',
        ratioMaps,
        {
          censusVariable: segment.source,
          censusSurvey: options.survey,
          censusUniverse: ethnicityMeta.get('B03002_001E')?.concept,
          censusTableUrl: CENSUS_TABLE_DOC_URL(options.year, options.dataset, 'B03002'),
          year: options.year,
        },
        { name: `ethnicity:${segment.key}` },
      );
      await applyStatDataPayloads(db, payloads);
    }
  } else {
    console.warn('    Skipping ethnicity breakdowns (missing totals).');
  }

  // Income buckets (B19001)
  const incomeVariables = [
    'B19001_001E',
    // <$35k
    'B19001_002E',
    'B19001_003E',
    'B19001_004E',
    'B19001_005E',
    'B19001_006E',
    // $35k-$99,999
    'B19001_007E',
    'B19001_008E',
    'B19001_009E',
    'B19001_010E',
    'B19001_011E',
    'B19001_012E',
    'B19001_013E',
    // >= $100k
    'B19001_014E',
    'B19001_015E',
    'B19001_016E',
    'B19001_017E',
  ];
  const { dataMaps: incomeMaps, meta: incomeMeta } = await fetchDataMapsForVariables(options, 'B19001', incomeVariables);
  const incomeTotal = incomeMaps.get('B19001_001E');
  if (incomeTotal) {
    const low = sumMaps([
      incomeMaps.get('B19001_002E')!,
      incomeMaps.get('B19001_003E')!,
      incomeMaps.get('B19001_004E')!,
      incomeMaps.get('B19001_005E')!,
      incomeMaps.get('B19001_006E')!,
    ]);
    const middle = sumMaps([
      incomeMaps.get('B19001_007E')!,
      incomeMaps.get('B19001_008E')!,
      incomeMaps.get('B19001_009E')!,
      incomeMaps.get('B19001_010E')!,
      incomeMaps.get('B19001_011E')!,
      incomeMaps.get('B19001_012E')!,
      incomeMaps.get('B19001_013E')!,
    ]);
    const high = sumMaps([
      incomeMaps.get('B19001_014E')!,
      incomeMaps.get('B19001_015E')!,
      incomeMaps.get('B19001_016E')!,
      incomeMaps.get('B19001_017E')!,
    ]);
    const incomeSegments: Array<{ key: string; maps: DataMaps; source: string }> = [
      { key: 'low', maps: low, source: 'B19001_low' },
      { key: 'middle', maps: middle, source: 'B19001_middle' },
      { key: 'high', maps: high, source: 'B19001_high' },
    ];
    for (const segment of incomeSegments) {
      const ratioMaps = ratioDataMaps(segment.maps, incomeTotal);
      const payloads = buildStatDataPayloads(
        populationStatId,
        `income:${segment.key}`,
        'percent',
        ratioMaps,
        {
          censusVariable: segment.source,
          censusSurvey: options.survey,
          censusUniverse: incomeMeta.get('B19001_001E')?.concept,
          censusTableUrl: CENSUS_TABLE_DOC_URL(options.year, options.dataset, 'B19001'),
          year: options.year,
        },
        { name: `income:${segment.key}` },
      );
      await applyStatDataPayloads(db, payloads);
    }
  } else {
    console.warn('    Skipping income breakdowns (missing totals).');
  }

  // Education (B15003)
  const educationVariables = [
    'B15003_001E',
    // HS or less
    'B15003_002E',
    'B15003_003E',
    'B15003_004E',
    'B15003_005E',
    'B15003_006E',
    'B15003_007E',
    'B15003_008E',
    'B15003_009E',
    'B15003_010E',
    'B15003_011E',
    'B15003_012E',
    'B15003_013E',
    'B15003_014E',
    'B15003_015E',
    'B15003_016E',
    // Some college
    'B15003_017E',
    'B15003_018E',
    'B15003_019E',
    'B15003_020E',
    // Bachelor+
    'B15003_021E',
    'B15003_022E',
    'B15003_023E',
    'B15003_024E',
    'B15003_025E',
  ];
  const { dataMaps: educationMaps, meta: educationMeta } = await fetchDataMapsForVariables(options, 'B15003', educationVariables);
  const educationTotal = educationMaps.get('B15003_001E');
  if (educationTotal) {
    const hsOrLess = sumMaps([
      educationMaps.get('B15003_002E')!,
      educationMaps.get('B15003_003E')!,
      educationMaps.get('B15003_004E')!,
      educationMaps.get('B15003_005E')!,
      educationMaps.get('B15003_006E')!,
      educationMaps.get('B15003_007E')!,
      educationMaps.get('B15003_008E')!,
      educationMaps.get('B15003_009E')!,
      educationMaps.get('B15003_010E')!,
      educationMaps.get('B15003_011E')!,
      educationMaps.get('B15003_012E')!,
      educationMaps.get('B15003_013E')!,
      educationMaps.get('B15003_014E')!,
      educationMaps.get('B15003_015E')!,
      educationMaps.get('B15003_016E')!,
    ]);
    const someCollege = sumMaps([
      educationMaps.get('B15003_017E')!,
      educationMaps.get('B15003_018E')!,
      educationMaps.get('B15003_019E')!,
      educationMaps.get('B15003_020E')!,
    ]);
    const bachelorPlus = sumMaps([
      educationMaps.get('B15003_021E')!,
      educationMaps.get('B15003_022E')!,
      educationMaps.get('B15003_023E')!,
      educationMaps.get('B15003_024E')!,
      educationMaps.get('B15003_025E')!,
    ]);

    const educationSegments: Array<{ key: string; maps: DataMaps; source: string }> = [
      { key: 'hs_or_less', maps: hsOrLess, source: 'B15003_hs_or_less' },
      { key: 'some_college', maps: someCollege, source: 'B15003_some_college' },
      { key: 'bachelor_plus', maps: bachelorPlus, source: 'B15003_bachelor_plus' },
    ];

    for (const segment of educationSegments) {
      const ratioMaps = ratioDataMaps(segment.maps, educationTotal);
      const payloads = buildStatDataPayloads(
        populationStatId,
        `education:${segment.key}`,
        'percent',
        ratioMaps,
        {
          censusVariable: segment.source,
          censusSurvey: options.survey,
          censusUniverse: educationMeta.get('B15003_001E')?.concept,
          censusTableUrl: CENSUS_TABLE_DOC_URL(options.year, options.dataset, 'B15003'),
          year: options.year,
        },
        { name: `education:${segment.key}` },
      );
      await applyStatDataPayloads(db, payloads);
    }
  } else {
    console.warn('    Skipping education breakdowns (missing totals).');
  }
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

    // Demographic breakdowns (ethnicity, income, education) stored under Population stat
    const populationEntry = processedThisYear.get('B01003_001E');
    if (!baseOptions.dryRun && db && populationEntry?.statId) {
      await loadBreakdowns({
        options,
        populationStatId: populationEntry.statId,
        db,
      });
    } else if (baseOptions.debug) {
      console.warn('  Skipping demographic breakdowns – population stat not available or dry-run mode.');
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
