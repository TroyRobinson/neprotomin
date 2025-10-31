import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { id } from "@instantdb/react";
import { db } from "../../lib/reactDb";
import type { Category, OrganizationStatus } from "../../types/organization";

interface AddOrganizationScreenProps {
  onCancel: () => void;
  onCreated: (organization: { id: string; latitude: number; longitude: number; name: string }) => void;
}

type FormState = {
  name: string;
  ownerEmail: string;
  category: Category;
  status: OrganizationStatus;
  latitude: string;
  longitude: string;
  website: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  source: string;
  googleCategory: string;
};

const categoryOptions: Array<{ value: Category; label: string; description: string }> = [
  { value: "health", label: "Health", description: "Clinics, hospitals, wellness organizations" },
  { value: "education", label: "Education", description: "Schools, tutoring, training centers" },
  { value: "justice", label: "Justice", description: "Legal aid, advocacy, re-entry support" },
  { value: "economy", label: "Economy", description: "Financial assistance, workforce services" },
  { value: "food", label: "Food", description: "Food pantries, meal services, groceries" },
];

const statusOptions: Array<{ value: OrganizationStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "moved", label: "Moved" },
  { value: "closed", label: "Closed" },
];

const emptyFormState = (ownerEmail: string): FormState => ({
  name: "",
  ownerEmail,
  category: "health",
  status: "active",
  latitude: "", // Auto-populated via geocoding
  longitude: "", // Auto-populated via geocoding
  website: "",
  phone: "",
  address: "",
  city: "",
  state: "OK",
  postalCode: "",
  source: "",
  googleCategory: "",
});

const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// Parse a full address string into components
// Handles formats like:
// - "123 Main St, Tulsa, OK 74103"
// - "123 Main St, Tulsa, OK, 74103"
// - "123 Main St Tulsa OK 74103"
function parseFullAddress(input: string): {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
} | null {
  const trimmed = input.trim();

  // Only parse if it looks like a full address (contains comma or has multiple parts)
  const hasCommas = trimmed.includes(",");
  const parts = trimmed.split(/[\s,]+/).filter(Boolean);

  // Need at least 4 parts (street, city, state, zip) to consider parsing
  if (!hasCommas && parts.length < 4) {
    return null;
  }

  try {
    // Split by commas first if present
    if (hasCommas) {
      const segments = trimmed.split(",").map((s) => s.trim()).filter(Boolean);

      // Common format: "Street Address, City, State ZIP"
      // or: "Street Address, City, State, ZIP"
      if (segments.length >= 3) {
        const streetAddress = segments[0];
        const city = segments[1];

        // Last segment should contain state and/or ZIP
        const lastSegment = segments[segments.length - 1];
        const lastParts = lastSegment.split(/\s+/).filter(Boolean);

        // Try to identify state and ZIP from last segment(s)
        let state = "";
        let zip = "";

        // If we have 3 segments: "Street, City, State ZIP"
        if (segments.length === 3) {
          // Last part could be "OK 74103" or "OK"
          if (lastParts.length >= 2) {
            state = lastParts[0];
            zip = lastParts[lastParts.length - 1];
          } else if (lastParts.length === 1) {
            // Could be just state or just ZIP
            if (/^\d{5}(-\d{4})?$/.test(lastParts[0])) {
              zip = lastParts[0];
            } else {
              state = lastParts[0];
            }
          }
        }
        // If we have 4 segments: "Street, City, State, ZIP"
        else if (segments.length === 4) {
          state = segments[2];
          zip = segments[3];
        }

        return {
          address: streetAddress,
          city,
          state: state.toUpperCase(),
          zip,
        };
      }
    }

    // Fallback: try to parse without commas
    // Assume last part is ZIP, second to last is state
    const zipMatch = trimmed.match(/\b(\d{5}(?:-\d{4})?)\b/);
    if (zipMatch) {
      const zip = zipMatch[1];
      const beforeZip = trimmed.substring(0, zipMatch.index).trim();

      // Find state (2-letter code before ZIP)
      const stateMatch = beforeZip.match(/\b([A-Z]{2})\b$/);
      if (stateMatch) {
        const state = stateMatch[1];
        const beforeState = beforeZip.substring(0, stateMatch.index).trim();

        // Split remaining into street and city
        const remaining = beforeState.split(/\s+/);
        if (remaining.length >= 2) {
          // Assume last word before state is city, rest is street
          const cityIndex = Math.max(0, remaining.length - 1);
          const address = remaining.slice(0, cityIndex).join(" ");
          const city = remaining.slice(cityIndex).join(" ");

          return {
            address,
            city,
            state,
            zip,
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.error("Error parsing address:", error);
    return null;
  }
}

const parseCoordinate = (
  label: "Latitude" | "Longitude",
  rawValue: string,
  min: number,
  max: number,
): { value: number; error?: string } => {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return { value: Number.NaN, error: `${label} is required so we can place the map pin.` };
  }
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed)) {
    return { value: Number.NaN, error: `${label} must be a numeric value.` };
  }
  if (parsed < min || parsed > max) {
    return {
      value: Number.NaN,
      error: `${label} must be between ${min} and ${max}.`,
    };
  }
  return { value: parsed };
};

// Geocode an address using OpenStreetMap's Nominatim API (CORS-friendly)
async function geocodeAddress(
  address: string,
  city: string,
  state: string,
  zip: string,
): Promise<{ latitude: number; longitude: number } | { error: string }> {
  try {
    // Construct a full address string for Nominatim
    const fullAddress = `${address}, ${city}, ${state} ${zip}, USA`;

    const params = new URLSearchParams({
      q: fullAddress,
      format: "json",
      addressdetails: "1",
      limit: "1",
      countrycodes: "us", // Restrict to United States
    });

    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    console.log("Geocoding request:", { address, city, state, zip });
    console.log("Full address string:", fullAddress);

    const response = await fetch(url, {
      headers: {
        // Nominatim requires a User-Agent header per their usage policy
        "User-Agent": "NEProtoMinimal Community Map",
      },
    });
    console.log("Response status:", response.status, response.statusText);

    if (!response.ok) {
      console.error("API error:", response.status, response.statusText);
      return {
        error: `Unable to connect to the geocoding service (${response.status}). Please try again later.`,
      };
    }

    const data = await response.json();
    console.log("Response data:", data);

    // Check if we got any results
    if (!Array.isArray(data) || data.length === 0) {
      console.warn("No matches found for address");
      return {
        error:
          "We couldn't find coordinates for this address. Please check the address and try again, or verify the street address, city, state, and ZIP code are all correct.",
      };
    }

    // Use the first result
    const result = data[0];
    const latitude = parseFloat(result.lat);
    const longitude = parseFloat(result.lon);

    console.log("Found coordinates:", { latitude, longitude });
    console.log("Matched address:", result.display_name);

    return { latitude, longitude };
  } catch (error) {
    console.error("Geocoding error (full details):", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    return {
      error:
        `Geocoding failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export const AddOrganizationScreen = ({ onCancel, onCreated }: AddOrganizationScreenProps) => {
  const { user } = db.useAuth();
  const ownerEmailFromAuth = user && !user.isGuest ? (user.email ?? "") : "";
  const [formValues, setFormValues] = useState<FormState>(() => emptyFormState(ownerEmailFromAuth));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [geocodedCoordinates, setGeocodedCoordinates] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  // Keep the owner email synced with the authenticated user, but allow manual edits afterward
  useEffect(() => {
    setFormValues((prev) => {
      if (prev.ownerEmail) return prev;
      if (!ownerEmailFromAuth) return prev;
      return { ...prev, ownerEmail: ownerEmailFromAuth };
    });
  }, [ownerEmailFromAuth]);

  const handleFieldChange = (field: keyof FormState) => (value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  const categoryDescriptions = useMemo(() => {
    const map = new Map<Category, string>();
    for (const option of categoryOptions) {
      map.set(option.value, option.description);
    }
    return map;
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const rawName =
      (formData.get("name") ??
        formValues.name ??
        "") as string;
    const rawOwnerEmail =
      (formData.get("ownerEmail") ??
        formValues.ownerEmail ??
        "") as string;
    const rawAddress =
      (formData.get("address") ??
        formValues.address ??
        "") as string;
    const rawCity =
      (formData.get("city") ??
        formValues.city ??
        "") as string;
    const rawState =
      (formData.get("state") ??
        formValues.state ??
        "") as string;
    const rawPostalCode =
      (formData.get("postalCode") ??
        formValues.postalCode ??
        "") as string;

    const nextName = rawName.trim();
    const ownerEmailInput = rawOwnerEmail.trim();
    const addressInput = rawAddress.trim();
    const cityInput = rawCity.trim();
    const stateInput = rawState.trim();
    const postalCodeInput = rawPostalCode.trim();

    if (!nextName) {
      setFormError("Organization name is required.");
      return;
    }
    if (!ownerEmailInput) {
      setFormError("Owner email is required so you can revise details later.");
      return;
    }
    if (!addressInput) {
      setFormError("Street address is required to determine the location.");
      return;
    }
    if (!cityInput) {
      setFormError("City is required to determine the location.");
      return;
    }
    if (!stateInput) {
      setFormError("State is required to determine the location.");
      return;
    }
    if (!postalCodeInput) {
      setFormError("ZIP code is required to determine the location.");
      return;
    }

    // Geocode the address
    setIsSubmitting(true);
    const geocodeResult = await geocodeAddress(
      addressInput,
      cityInput,
      stateInput,
      postalCodeInput,
    );

    if ("error" in geocodeResult) {
      setFormError(geocodeResult.error);
      setIsSubmitting(false);
      return;
    }

    const { latitude: latitudeValue, longitude: longitudeValue } = geocodeResult;
    setGeocodedCoordinates(geocodeResult);

    const organizationId = id();

    const canonicalOwnerEmail = ownerEmailInput.toLowerCase();

    const payload: Record<string, unknown> = {
      name: nextName,
      ownerEmail: canonicalOwnerEmail,
      category: formValues.category,
      status: formValues.status,
      latitude: latitudeValue,
      longitude: longitudeValue,
    };

    const websiteValue = toNullableString(
      (formData.get("website") ?? formValues.website ?? "") as string,
    );
    if (websiteValue) payload.website = websiteValue;

    const phoneValue = toNullableString(
      (formData.get("phone") ?? formValues.phone ?? "") as string,
    );
    if (phoneValue) payload.phone = phoneValue;

    const addressValue = toNullableString(
      (formData.get("address") ?? formValues.address ?? "") as string,
    );
    if (addressValue) payload.address = addressValue;

    const cityValue = toNullableString(
      (formData.get("city") ?? formValues.city ?? "") as string,
    );
    if (cityValue) payload.city = cityValue;

    const stateValue = toNullableString(
      (formData.get("state") ?? formValues.state ?? "") as string,
    );
    if (stateValue) payload.state = stateValue;

    const postalValue = toNullableString(
      (formData.get("postalCode") ?? formValues.postalCode ?? "") as string,
    );
    if (postalValue) payload.postalCode = postalValue;

    const sourceValue = toNullableString(
      (formData.get("source") ?? formValues.source ?? "") as string,
    );
    if (sourceValue) payload.source = sourceValue;

    const googleCategoryValue = toNullableString(
      (formData.get("googleCategory") ?? formValues.googleCategory ?? "") as string,
    );
    if (googleCategoryValue) payload.googleCategory = googleCategoryValue;

    try {
      await db.transact(db.tx.organizations[organizationId].update(payload));
      setIsSubmitting(false);
      onCreated({
        id: organizationId,
        latitude: latitudeValue,
        longitude: longitudeValue,
        name: nextName,
      });
    } catch (error) {
      console.error("Failed to create organization", error);
      setFormError(
        error instanceof Error
          ? error.message
          : "We could not save the organization. Please try again.",
      );
      setIsSubmitting(false);
    }
  };

  const currentCategoryDescription = categoryDescriptions.get(formValues.category);

  // The layout is split into three cards so the form stays legible on desktop and stacks cleanly on mobile.
  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-slate-50 pb-safe dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 pb-16 pt-10 sm:px-8 lg:px-12">
        <div className="space-y-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex w-max items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
          >
            ← Back to map
          </button>
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Add an organization</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
              Share the details of a community organization so neighbors can discover it on the map.
              Required fields are marked, and you can always return later to update information.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid flex-1 grid-cols-1 gap-8 pb-20">
          <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <header className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
                01 — Essentials
              </p>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Organization overview</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Tell us who you are adding and how we can contact the person who can edit it later.
              </p>
            </header>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Organization name <span className="text-brand-500">*</span>
                </span>
                <input
                  name="name"
                  type="text"
                  required
                  value={formValues.name}
                  onChange={(event) => handleFieldChange("name")(event.target.value)}
                  autoComplete="organization"
                  placeholder="Community Resource Center"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Contact email <span className="text-brand-500">*</span>
                </span>
                <div className="space-y-2">
                  <input
                    name="ownerEmail"
                    type="email"
                    required
                    value={formValues.ownerEmail}
                    onChange={(event) => handleFieldChange("ownerEmail")(event.target.value)}
                    autoComplete="email"
                    placeholder="you@example.org"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Required so you can edit your org details in the future.
                  </p>
                </div>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Category</span>
                <select
                  name="category"
                  value={formValues.category}
                  onChange={(event) =>
                    handleFieldChange("category")(event.target.value as Category)
                  }
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                >
                  {categoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {currentCategoryDescription && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {currentCategoryDescription}
                  </p>
                )}
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Status</span>
                <select
                  name="status"
                  value={formValues.status}
                  onChange={(event) =>
                    handleFieldChange("status")(event.target.value as OrganizationStatus)
                  }
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <header className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
                02 — Location & contact
              </p>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Where can we find it?</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Enter the address and we'll automatically determine the map pin location. Contact details help neighbors get in touch.
              </p>
            </header>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <label className="flex flex-col gap-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Street address <span className="text-brand-500">*</span>
                </span>
                <input
                  name="address"
                  type="text"
                  required
                  value={formValues.address}
                  onChange={(event) => {
                    const value = event.target.value;
                    // Try to parse as a full address
                    const parsed = parseFullAddress(value);
                    if (parsed) {
                      // Auto-fill all fields if we successfully parsed a full address
                      console.log("Auto-filling address fields:", parsed);
                      setFormValues((prev) => ({
                        ...prev,
                        address: parsed.address || value,
                        city: parsed.city || prev.city,
                        state: parsed.state || prev.state,
                        postalCode: parsed.zip || prev.postalCode,
                      }));
                    } else {
                      // Just update the address field normally
                      handleFieldChange("address")(value);
                    }
                  }}
                  autoComplete="street-address"
                  placeholder="123 Community Ave. (or paste full address)"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  City <span className="text-brand-500">*</span>
                </span>
                <input
                  name="city"
                  type="text"
                  required
                  value={formValues.city}
                  onChange={(event) => handleFieldChange("city")(event.target.value)}
                  autoComplete="address-level2"
                  placeholder="Tulsa"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  State <span className="text-brand-500">*</span>
                </span>
                <input
                  name="state"
                  type="text"
                  required
                  value={formValues.state}
                  onChange={(event) => handleFieldChange("state")(event.target.value)}
                  autoComplete="address-level1"
                  placeholder="OK"
                  className="uppercase rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  ZIP / Postal code <span className="text-brand-500">*</span>
                </span>
                <input
                  name="postalCode"
                  type="text"
                  required
                  value={formValues.postalCode}
                  onChange={(event) => handleFieldChange("postalCode")(event.target.value)}
                  autoComplete="postal-code"
                  placeholder="74103"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              {geocodedCoordinates && (
                <div className="md:col-span-2 rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    ✓ Location found
                  </p>
                  <p className="mt-1 text-xs text-green-700 dark:text-green-300">
                    Coordinates: {geocodedCoordinates.latitude.toFixed(6)}, {geocodedCoordinates.longitude.toFixed(6)}
                  </p>
                </div>
              )}
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Phone</span>
                <input
                  name="phone"
                  type="tel"
                  value={formValues.phone}
                  onChange={(event) => handleFieldChange("phone")(event.target.value)}
                  autoComplete="tel"
                  placeholder="(918) 555-1234"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
            </div>
          </section>

          <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <header className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
                03 — Optional extras
              </p>
              <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Help us tell the full story</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Websites, sources, and service categories help residents know what to expect before they visit.
              </p>
            </header>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Website</span>
                <input
                  name="website"
                  type="url"
                  value={formValues.website}
                  onChange={(event) => handleFieldChange("website")(event.target.value)}
                  autoComplete="url"
                  placeholder="https://example.org"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Submitted by / Source</span>
                <input
                  name="source"
                  type="text"
                  value={formValues.source}
                  onChange={(event) => handleFieldChange("source")(event.target.value)}
                  placeholder="Community submission"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Google category (optional)</span>
                <input
                  name="googleCategory"
                  type="text"
                  value={formValues.googleCategory}
                  onChange={(event) => handleFieldChange("googleCategory")(event.target.value)}
                  placeholder="Community center"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Helpful if the organization appears on Google Maps and you know its official category.
                </p>
              </label>
            </div>
          </section>

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
            {formError ? (
              <p className="text-sm font-medium text-rose-600 dark:text-rose-300">{formError}</p>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                We’ll review submissions quickly—thanks for helping keep the map accurate.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center justify-center rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 px-6 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-brand-500 dark:hover:bg-brand-400 dark:focus:ring-brand-300 dark:focus:ring-offset-slate-900"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Saving…" : "Publish on map"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddOrganizationScreen;
