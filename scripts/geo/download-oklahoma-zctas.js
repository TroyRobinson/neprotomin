#!/usr/bin/env node
/**
 * Downloads and processes Oklahoma ZCTA GeoJSON data from the US Census Bureau.
 * 
 * This script:
 * 1. Downloads the national ZCTA shapefile from Census Bureau
 * 2. Extracts Oklahoma-specific ZCTAs using ogr2ogr
 * 3. Converts to GeoJSON format
 * 4. Places the result in a data/raw/ directory
 */

import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import https from "https";
import { createWriteStream } from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CENSUS_URL = "https://www2.census.gov/geo/tiger/TIGER2020/ZCTA520/tl_2020_us_zcta520.zip";
const DOWNLOAD_DIR = "data/raw";
const OUTPUT_FILE = "oklahoma-zcta.geojson";

const downloadFile = (url, outputPath) => {
  return new Promise((resolve, reject) => {
    console.log(`→ Downloading ${url}...`);
    const file = createWriteStream(outputPath);
    
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
        return;
      }
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log(`✓ Downloaded to ${outputPath}`);
        resolve();
      });
      
      file.on('error', (err) => {
        fs.unlink(outputPath).catch(() => {}); // Clean up on error
        reject(err);
      });
    }).on('error', reject);
  });
};

const runCommand = (command, args, options = {}) => {
  return new Promise((resolve, reject) => {
    console.log(`→ Running: ${command} ${args.join(' ')}`);
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}`));
      }
    });
  });
};

const main = async () => {
  try {
    // Create download directory
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
    
    const zctaZipPath = path.join(DOWNLOAD_DIR, "tl_2020_us_zcta520.zip");
    const extractedDir = path.join(DOWNLOAD_DIR, "extracted");
    const zctaShapefilePath = path.join(extractedDir, "tl_2020_us_zcta520.shp");
    const outputPath = path.join(DOWNLOAD_DIR, OUTPUT_FILE);
    
    // Download the ZCTA ZIP file
    await downloadFile(CENSUS_URL, zctaZipPath);
    
    // Extract the ZIP file
    console.log("→ Extracting ZIP file...");
    await runCommand("unzip", ["-o", zctaZipPath, "-d", extractedDir]);
    
    // Use bounding box to filter ZCTAs for Oklahoma region
    // Oklahoma bounding box: approximately -103.0 to -94.0 longitude, 33.5 to 37.0 latitude
    console.log("→ Filtering ZCTAs for Oklahoma region using bounding box...");
    await runCommand("ogr2ogr", [
      "-f", "GeoJSON",
      outputPath,
      zctaShapefilePath,
      "-spat", "-103.0", "33.5", "-94.0", "37.0"
    ]);
    
    // Clean up temporary files
    console.log("→ Cleaning up temporary files...");
    await fs.unlink(zctaZipPath);
    await fs.rm(extractedDir, { recursive: true, force: true });
    
    console.log(`✓ Successfully created ${outputPath}`);
    console.log(`\nYou can now run:`);
    console.log(`npm run geo:build:ok-zctas -- --input ${outputPath} --zip-field ZCTA5CE20 --county-field COUNTYFP --county-name-field NAME`);
    
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
};

main();
