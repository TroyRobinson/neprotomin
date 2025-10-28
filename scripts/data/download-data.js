#!/usr/bin/env node
/**
 * Data download helper script
 * Downloads required data files from Census Bureau
 */
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data/raw');

const CENSUS_TIGER_BASE = 'https://www2.census.gov/geo/tiger/TIGER2020';
const REQUIRED_FILES = [
  {
    url: `${CENSUS_TIGER_BASE}/COUNTY/tl_2020_us_county.zip`,
    filename: 'tl_2020_us_county.zip',
    description: 'US County Boundaries (ZIP)',
  },
];

async function downloadFile(url, destPath) {
  console.log(`Downloading ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(buffer));
  console.log(`Downloaded to ${destPath}`);
}

async function main() {
  // Ensure data directory exists
  await fs.mkdir(DATA_DIR, { recursive: true });

  // Download each required file
  for (const file of REQUIRED_FILES) {
    const destPath = path.join(DATA_DIR, file.filename);
    try {
      await downloadFile(file.url, destPath);
    } catch (err) {
      console.error(`Error downloading ${file.filename}:`, err.message);
      process.exit(1);
    }
  }

  console.log('\nAll files downloaded successfully!');
  console.log('\nNext steps:');
  console.log('1. Extract the ZIP files');
  console.log('2. Run npm run geo:build:ok-zctas to generate Oklahoma ZCTA files');
}

main().catch(console.error);