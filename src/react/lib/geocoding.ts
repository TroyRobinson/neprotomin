export interface AddressComponents {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  provider: string;
}

export interface GeocodeError {
  error: string;
  providersTried: string[];
}

const normalizeSpace = (value: string): string => value.trim().replace(/\s+/g, " ");

const ADDRESS_SUFFIX_PATTERN =
  /\b(ave|avenue|st|street|rd|road|dr|drive|ln|lane|blvd|boulevard|pkwy|parkway|cir|circle|ct|court|pl|place|way|trl|trail|hwy|highway|route)\b/i;

export const looksLikeAddress = (input: string): boolean => {
  const value = normalizeSpace(input);
  if (!value) return false;
  if (/\d/.test(value)) return true;
  return ADDRESS_SUFFIX_PATTERN.test(value);
};

export const parseFullAddress = (input: string): AddressComponents | null => {
  const trimmed = input.trim();

  const hasCommas = trimmed.includes(",");
  const parts = trimmed.split(/[\s,]+/).filter(Boolean);

  if (!hasCommas && parts.length < 4) {
    return null;
  }

  try {
    if (hasCommas) {
      const segments = trimmed.split(",").map((segment) => segment.trim()).filter(Boolean);
      if (segments.length >= 3) {
        const streetAddress = segments[0];
        const city = segments[1];

        const lastSegment = segments[segments.length - 1];
        const lastParts = lastSegment.split(/\s+/).filter(Boolean);

        let state = "";
        let zip = "";

        if (segments.length === 3) {
          if (lastParts.length >= 2) {
            state = lastParts[0];
            zip = lastParts[lastParts.length - 1];
          } else if (lastParts.length === 1) {
            if (/^\d{5}(?:-\d{4})?$/.test(lastParts[0])) {
              zip = lastParts[0];
            } else {
              state = lastParts[0];
            }
          }
        } else if (segments.length === 4) {
          state = segments[2];
          zip = segments[3];
        }

        return {
          address: streetAddress,
          city,
          state: state ? state.toUpperCase() : undefined,
          zip: zip || undefined,
        };
      }
    }

    const zipMatch = trimmed.match(/\b(\d{5}(?:-\d{4})?)\b/);
    if (zipMatch) {
      const zip = zipMatch[1];
      const beforeZip = trimmed.substring(0, zipMatch.index).trim();
      const stateMatch = beforeZip.match(/\b([A-Z]{2})\b$/i);
      if (stateMatch) {
        const state = stateMatch[1];
        const beforeState = beforeZip.substring(0, stateMatch.index).trim();
        const remaining = beforeState.split(/\s+/);
        if (remaining.length >= 2) {
          const cityIndex = Math.max(0, remaining.length - 1);
          const address = remaining.slice(0, cityIndex).join(" ");
          const city = remaining.slice(cityIndex).join(" ");
          return {
            address,
            city,
            state: state.toUpperCase(),
            zip,
          };
        }
      }
    }
  } catch (error) {
    console.error("Error parsing address:", error);
  }

  return null;
};

const formatAddress = (components: AddressComponents): string | null => {
  const pieces: string[] = [];
  if (components.address) pieces.push(normalizeSpace(components.address));
  if (components.city) pieces.push(normalizeSpace(components.city));
  if (components.state || components.zip) {
    const stateZip = [components.state, components.zip].filter(Boolean).join(" ");
    if (stateZip) pieces.push(stateZip);
  }
  if (pieces.length === 0) return null;
  if (!pieces[pieces.length - 1].toLowerCase().includes("usa")) {
    pieces.push("USA");
  }
  return pieces.join(", ");
};

type GeocoderService = {
  name: string;
  buildUrl: (query: string) => string;
  parse: (data: unknown) => { latitude: number; longitude: number } | null;
};

const GEOCODER_SERVICES: GeocoderService[] = [
  {
    name: "photon.komoot.io",
    buildUrl: (query: string) => {
      const params = new URLSearchParams({ q: query, limit: "1" });
      return `https://photon.komoot.io/api/?${params.toString()}`;
    },
    parse: (data: unknown) => {
      if (!data || typeof data !== "object" || data === null) return null;
      const features = (data as Record<string, unknown>).features;
      if (!Array.isArray(features) || features.length === 0) return null;
      const first = features[0] as Record<string, unknown>;
      const geometry = first.geometry as Record<string, unknown> | undefined;
      const coordinates = Array.isArray(geometry?.coordinates) ? geometry?.coordinates : null;
      if (!coordinates || coordinates.length < 2) return null;
      const [longitude, latitude] = coordinates;
      if (typeof latitude === "number" && typeof longitude === "number") {
        return { latitude, longitude };
      }
      return null;
    },
  },
  {
    name: "geocode.maps.co",
    buildUrl: (query: string) => {
      const params = new URLSearchParams({ q: query });
      return `https://geocode.maps.co/search?${params.toString()}`;
    },
    parse: (data: unknown) => {
      if (!Array.isArray(data) || data.length === 0) return null;
      const first = data[0] as Record<string, unknown>;
      const lat = typeof first.lat === "string" ? parseFloat(first.lat) : null;
      const lon = typeof first.lon === "string" ? parseFloat(first.lon) : null;
      if (typeof lat === "number" && !Number.isNaN(lat) && typeof lon === "number" && !Number.isNaN(lon)) {
        return { latitude: lat, longitude: lon };
      }
      return null;
    },
  },
];

export const geocodeAddress = async (
  input: AddressComponents | string,
): Promise<GeocodeResult | GeocodeError> => {
  const query =
    typeof input === "string"
      ? normalizeSpace(input)
      : formatAddress(input) ?? normalizeSpace(
          [input.address, input.city, input.state, input.zip].filter(Boolean).join(", "),
        );

  if (!query) {
    return {
      error: "Address is incomplete.",
      providersTried: [],
    };
  }

  const providersTried: string[] = [];

  for (const service of GEOCODER_SERVICES) {
    try {
      const response = await fetch(service.buildUrl(query));
      providersTried.push(service.name);
      if (!response.ok) {
        console.warn(`${service.name} returned status ${response.status}`);
        continue;
      }
      const data = await response.json();
      const parsed = service.parse(data);
      if (parsed) {
        return {
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          provider: service.name,
        };
      }
    } catch (error) {
      console.warn(`${service.name} geocode failed`, error);
      providersTried.push(`${service.name} (error)`);
    }
  }

  return {
    error: "No coordinates found for that address.",
    providersTried,
  };
};
