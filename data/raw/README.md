# Data Files

This directory contains large data files that are not tracked in Git due to size limitations. Below are instructions for obtaining and managing these files.

## Required Data Files

The following files are needed but not tracked in Git:

- `tl_2020_us_county.zip` (76.91 MB)
- `tl_2020_us_county.shp` (123.56 MB)
- `oklahoma-zcta-with-counties.geojson` (126.04 MB)
- `oklahoma-zcta-final.geojson` (126.05 MB)

## How to Obtain the Data

### Census TIGER/Line Files
1. Download county boundaries:
   ```bash
   npm run geo:download:ok-zctas
   ```
   This will download the required Census TIGER/Line files into this directory.

### Oklahoma ZCTA Files
1. Build ZCTA files:
   ```bash
   npm run geo:build:ok-zctas
   ```
   This will generate the required Oklahoma ZCTA files using the Census TIGER/Line data.

## Data Management

- These files are used by the ETL scripts to process geographic data
- The files are generated from authoritative sources (US Census Bureau)
- Keep a local copy of these files for development
- For production deployments, ensure these files are available in the deployment environment

## Regenerating Data

If you need to regenerate the data files:

1. Clear the directory:
   ```bash
   rm -rf data/raw/*
   ```
2. Re-download Census files:
   ```bash
   npm run geo:download:ok-zctas
   ```
3. Rebuild Oklahoma ZCTA files:
   ```bash
   npm run geo:build:ok-zctas
   ```

## Notes

- The `.gitignore` file is configured to exclude these large data files
- Alternative hosting solutions for production:
  1. S3 or similar cloud storage
  2. Build-time download scripts
  3. CI/CD pipeline artifacts