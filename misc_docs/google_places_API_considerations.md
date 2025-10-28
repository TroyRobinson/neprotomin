# Google Places Coordination


## Overview
- The base map renders through MapLibre (`map.js`) while food assistance points are sourced from Google’s Places API (`places-data.js`), then injected as a GeoJSON source.
- `PlacesDataFetcher` reads the Google keys and search configuration from `CONFIG` (`config.js`) to fan out `places:searchText` POST requests for each city and food-related keyword.
- Results return through a field-masked payload, are normalized, deduplicated by `place_id`, and cached as GeoJSON in `localStorage` for seven days to limit API spending and avoid throttling.
- Once fetched, the markers layer is registered as the `food-locations` source and drawn as teal circles in MapLibre alongside the SNAP choropleth data that comes from the Census API.

## Current Workflow
1. `fetchFoodLocations()` loops over 25 configured Oklahoma cities by 10 search phrases (250 calls max) with an 800 ms delay to stay under rate limits.
2. Each request uses `locationBias.circle` (25 km radius) so the Places API prioritizes results close to the target city.
3. `processPlace()` normalizes fields from the Places payload (name, address, hours, rating, types) and tags them with the originating search term for tracing relevance.
4. `removeDuplicates()` collapses multiple hits that share a `place_id`, preventing duplicate markers from different search phrases.
5. The resulting FeatureCollection is cached (`places_food_data`) with a version string that reflects the number of cities and search types, so config tweaks automatically invalidate stale data.
6. `map.js` reads the GeoJSON into the `food-locations` source and draws the `food-markers` layer; marker popups show the Google-derived attributes.

## Successes
- Versioned caching in `places-data.js` keeps the dataset fresh whenever the search configuration changes, yet avoids redundant API spend across sessions.
- Field masks on the Places call request only the attributes needed for the popups, keeping payloads lean and reducing billing weight.
- Deduplication via `place_id` prevents marker clutter when the same location appears under multiple phrases.
- Marker interactivity integrates smoothly with MapLibre popups, so the Google Places detail feels native on the non-Google basemap.

## Things Tried That Didn’t Work
- Rapid-fire Places calls without a delay triggered rate limiting, so an explicit ~0.8 s back-off was added between requests.
- Relying on earlier cached payloads without a version string left stale data after adjusting city or keyword lists, leading to the current cache-versioning scheme.

## Learnings
- Text-based search combined with `locationBias` is effective for surfacing pantry-style services even when official Google Place types are inconsistent or missing.
- Constraining each query to 20 results keeps the data volume manageable; broader limits tended to return less relevant venues (e.g., general grocery stores).
- A local GeoJSON cache matches the Places API output to the same structure MapLibre expects, simplifying the marker ingestion pipeline.

## Insights
- Many smaller towns still return empty arrays because Google lacks tagged listings there; console logging in `searchPlaces()` surfaces those gaps for future data seeding.
- Categorization is currently derived from the triggering search phrase rather than authoritatively from Google types, so category accuracy depends on phrase quality.
- Phone and hours data often come back null; users should expect partially populated popups until more complete records are crowdsourced or enriched via other APIs.

## Outstanding Improvements
- The declared `GOOGLE_MAPS_API_KEY` and `GOOGLE_GEOCODING_API_KEY` are not yet wired into the app; future work could use them for map tiles, place details, or address normalization.
- 250 sequential requests take several minutes under the current throttle; batching city lookups or using the Places Nearby Search endpoint could speed up first load while respecting quotas.
- Rural coverage remains thin—augmenting Google data with local datasets (food banks, community orgs) would fill known blind spots.
- Marker visibility toggles exist, but there is no filter to surface only certain categories or search phrases; layering an on-map filter UI would improve usability.


# CONFIG EXAMPLE

const CONFIG = {
    // Google API Keys
    GOOGLE_MAPS_API_KEY: '...',
    GOOGLE_GEOCODING_API_KEY: '...',
    GOOGLE_PLACES_API_KEY: '...',

    // Census API (no key required for basic usage)
    CENSUS_API_BASE: 'https://api.census.gov/data',

    // Oklahoma-specific settings
    STATE_FIPS: '40', // Oklahoma
    MAP_CENTER: [-97.5, 35.5],
    MAP_ZOOM: 6.5,

    // Major Oklahoma cities for Places API searches
    SEARCH_CITIES: [
        { name: 'Oklahoma City', lat: 35.4676, lng: -97.5164 },
        { name: 'Tulsa', lat: 36.1540, lng: -95.9928 },
        { name: 'Norman', lat: 35.2226, lng: -97.4395 },
        { name: 'Lawton', lat: 34.6036, lng: -98.3959 },
        { name: 'Broken Arrow', lat: 36.0526, lng: -95.7969 },
        { name: 'Edmond', lat: 35.6528, lng: -97.4781 },
        { name: 'Stillwater', lat: 36.1156, lng: -97.0584 },
        { name: 'Midwest City', lat: 35.4495, lng: -97.3967 },
        { name: 'Enid', lat: 36.3956, lng: -97.8784 },
        { name: 'Moore', lat: 35.3395, lng: -97.4867 },
        { name: 'Bartlesville', lat: 36.7473, lng: -95.9808 },
        { name: 'Owasso', lat: 36.2695, lng: -95.8547 },
        { name: 'Muskogee', lat: 35.7479, lng: -95.3697 },
        { name: 'Shawnee', lat: 35.3273, lng: -96.9253 },
        { name: 'Bixby', lat: 35.9420, lng: -95.8833 },
        { name: 'Ardmore', lat: 34.1743, lng: -97.1436 },
        { name: 'Ponca City', lat: 36.7070, lng: -97.0856 },
        { name: 'Duncan', lat: 34.5023, lng: -97.9578 },
        { name: 'Yukon', lat: 35.5067, lng: -97.7625 },
        { name: 'Del City', lat: 35.4420, lng: -97.4408 },
        { name: 'Sapulpa', lat: 35.9987, lng: -96.1142 },
        { name: 'Jenks', lat: 35.9984, lng: -95.9686 },
        { name: 'Sand Springs', lat: 36.1398, lng: -96.1089 },
        { name: 'Bethany', lat: 35.5170, lng: -97.6322 },
        { name: 'Mustang', lat: 35.3842, lng: -97.7245 }
    ],

    // Food assistance search terms - expanded for better coverage
    FOOD_SEARCH_TYPES: [
        'food bank',
        'food pantry',
        'soup kitchen',
        'community food bank',
        'food assistance',
        'food ministry',
        'hunger relief',
        'food distribution center',
        'community pantry',
        'emergency food'
    ],

    // Map styling
    CHOROPLETH_COLORS: [
        [0, '#e8eaf6'],    // Lightest indigo
        [5, '#c5cae9'],
        [10, '#9fa8da'],
        [15, '#7986cb'],
        [20, '#5c6bc0'],
        [30, '#3f51b5'],
        [40, '#303f9f']    // Darkest indigo
    ],

    MARKER_COLOR: '#00BCD4' // Teal
};
