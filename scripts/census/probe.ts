#!/usr/bin/env node

import 'dotenv/config';

import {
  parseCensusArgs,
  fetchGroupMetadata,
  resolveVariables,
  fetchZipData,
  fetchCountyData,
} from './censusUtils';

async function main() {
  const options = parseCensusArgs();
  console.log('Census probe');
  console.log(`  dataset : ${options.dataset}`);
  console.log(`  group   : ${options.group}`);
  console.log(`  year    : ${options.year}`);

  const groupMeta = await fetchGroupMetadata(options);
  const { estimates, moeMap } = resolveVariables(options, groupMeta);
  console.log(`  variables found: ${estimates.length} (MOE available for ${moeMap.size})`);

  const moeVariables = Array.from(moeMap.values());
  const zipPayload = await fetchZipData(options, estimates.slice(0, 1), moeVariables.slice(0, 1));
  console.log(`  zip payload rows: ${zipPayload.records.length}`);

  const countyPayload = await fetchCountyData(options, estimates.slice(0, 1), moeVariables.slice(0, 1));
  console.log(`  county payload rows: ${countyPayload.records.length}`);

  console.log('Probe complete – Census API reachable.');
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Census probe failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
