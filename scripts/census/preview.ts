#!/usr/bin/env node

import 'dotenv/config';

import {
  parseCensusArgs,
  fetchGroupMetadata,
  resolveVariables,
  fetchZipData,
  fetchCountyData,
  buildDataMaps,
  deriveStatName,
  summarizeDataMaps,
} from './censusUtils';

const formatSample = (entries: Array<[string, number]>, limit = 5) =>
  entries.slice(0, limit).map(([key, value]) => `${key}:${value}`).join(', ');

async function main() {
  const options = parseCensusArgs();
  console.log(`Census preview`);
  console.log(`  dataset : ${options.dataset}`);
  console.log(`  group   : ${options.group}`);
  console.log(`  year    : ${options.year}`);
  console.log(`  include MOE : ${options.includeMoe ? 'yes' : 'no'}`);

  const groupMeta = await fetchGroupMetadata(options);
  const { estimates, moeMap } = resolveVariables(options, groupMeta);
  if (!estimates.length) {
    console.log('No estimate variables resolved for this group.');
    return;
  }

  const moeVariables = Array.from(moeMap.values());
  const zipPayload = await fetchZipData(options, estimates, moeVariables);
  const countyPayload = await fetchCountyData(options, estimates, moeVariables);

  console.log(`Variables discovered: ${estimates.length}`);
  const display = estimates.slice(0, options.limit);

  for (const variable of display) {
    const variableMeta = groupMeta.variables.get(variable);
    if (!variableMeta) continue;
    const statName = deriveStatName(variable, variableMeta, groupMeta);
    const maps = buildDataMaps(
      variable,
      moeMap.get(variable) ?? null,
      zipPayload,
      countyPayload,
    );
    const summary = summarizeDataMaps(maps);
    console.log(`\n${variable} → "${statName}"`);
    console.log(`  type        : ${variableMeta.predicateType || 'unknown'} (${summary.zipCount} zips, ${summary.countyCount} counties)`);
    if (groupMeta.universe) console.log(`  universe    : ${groupMeta.universe}`);
    console.log(`  sample zips : ${formatSample(Array.from(maps.zip.entries()))}`);
    console.log(`  sample counties : ${formatSample(Array.from(maps.county.entries()))}`);
    if (options.includeMoe) {
      const moeKey = moeMap.get(variable);
      console.log(`  moe column  : ${moeKey || 'n/a'} (${maps.zipMoe.size} zip MOEs)`);
    }
  }

  if (display.length < estimates.length) {
    console.log(`\n(${estimates.length - display.length} additional variables omitted; use --limit to adjust)`);
  }

  console.log('\nNext step: run census:load to persist these stats into InstantDB.');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Census preview failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
