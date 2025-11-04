import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { id } from "@instantdb/react";
import { XMarkIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { db } from "../../lib/reactDb";
import { isAdminEmail } from "../../lib/admin";
import type { Category, OrganizationStatus, OrganizationModerationStatus } from "../../types/organization";

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 translate-x-[0.2px] -translate-y-[0.2px] text-slate-400 dark:text-slate-500">
    <path
      fillRule="evenodd"
      d="M9 3.5a5.5 5.5 0 013.894 9.394l3.703 3.703a.75.75 0 11-1.06 1.06l-3.703-3.703A5.5 5.5 0 119 3.5zm0 1.5a4 4 0 100 8 4 4 0 000-8z"
      clipRule="evenodd"
    />
  </svg>
);

interface AddOrganizationScreenProps {
  onCancel: () => void;
  onCreated: (organization: { id: string; latitude: number; longitude: number; name: string }) => void;
  onFindNearbyOrg?: () => void;
}

type DayHours = {
  enabled: boolean;
  openTime: string;
  closeTime: string;
};

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
  // Hours: Sunday=0, Monday=1, ... Saturday=6
  hours: Record<number, DayHours>;
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
  category: "food",
  status: "active",
  latitude: "", // Auto-populated via geocoding
  longitude: "", // Auto-populated via geocoding
  website: "",
  phone: "",
  address: "",
  city: "",
  state: "OK",
  postalCode: "",
  source: "Community",
  googleCategory: "",
  hours: {
    0: { enabled: false, openTime: "09:00", closeTime: "17:00" }, // Sunday
    1: { enabled: false, openTime: "09:00", closeTime: "17:00" }, // Monday
    2: { enabled: false, openTime: "09:00", closeTime: "17:00" }, // Tuesday
    3: { enabled: false, openTime: "09:00", closeTime: "17:00" }, // Wednesday
    4: { enabled: false, openTime: "09:00", closeTime: "17:00" }, // Thursday
    5: { enabled: false, openTime: "09:00", closeTime: "17:00" }, // Friday
    6: { enabled: false, openTime: "09:00", closeTime: "17:00" }, // Saturday
  },
});

const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// Normalize website URL by prepending https:// if no protocol is present
function normalizeWebsiteUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  
  // Check if URL already has a protocol
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  
  // Prepend https:// if no protocol
  return `https://${trimmed}`;
}

// Convert 24-hour time (HH:MM) to 12-hour format (H:MM AM/PM)
function formatTime12Hour(time24: string): string {
  const [hoursStr, minutesStr] = time24.split(":");
  const hours = parseInt(hoursStr, 10);
  const minutes = minutesStr;

  if (hours === 0) {
    return `12:${minutes} AM`;
  } else if (hours < 12) {
    return `${hours}:${minutes} AM`;
  } else if (hours === 12) {
    return `12:${minutes} PM`;
  } else {
    return `${hours - 12}:${minutes} PM`;
  }
}

// Notify moderators via serverless endpoint when a pending submission arrives.
const notifyQueueModerators = async (payload: {
  organizationId: string;
  organizationName: string;
  ownerEmail: string | null;
  submitterEmail: string | null;
  submittedAt: number;
}) => {
  try {
    const response = await fetch("/api/queue-notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const message = await response.text();
      console.error("Queue notification failed", response.status, message);
    }
  } catch (error) {
    console.error("Queue notification error", error);
  }
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

// Geocode using multiple free services with fallback support
async function geocodeAddress(
  address: string,
  city: string,
  state: string,
  zip: string,
): Promise<{ latitude: number; longitude: number } | { error: string }> {
  const fullAddress = `${address}, ${city}, ${state} ${zip}, USA`;
  console.log("Geocoding request:", { address, city, state, zip, fullAddress });

  // List of free geocoding services to try (in order)
  const services = [
    {
      name: "geocode.maps.co",
      getUrl: (addr: string) => {
        const params = new URLSearchParams({ q: addr });
        return `https://geocode.maps.co/search?${params.toString()}`;
      },
      parseResponse: (data: any) => {
        if (!Array.isArray(data) || data.length === 0) return null;
        return {
          latitude: parseFloat(data[0].lat),
          longitude: parseFloat(data[0].lon),
        };
      },
    },
    {
      name: "photon.komoot.io",
      getUrl: (addr: string) => {
        const params = new URLSearchParams({ q: addr, limit: "1" });
        return `https://photon.komoot.io/api/?${params.toString()}`;
      },
      parseResponse: (data: any) => {
        if (!data.features || data.features.length === 0) return null;
        const coords = data.features[0].geometry.coordinates;
        return {
          latitude: coords[1], // GeoJSON uses [lon, lat]
          longitude: coords[0],
        };
      },
    },
  ];

  // Try each service in order
  const errors: string[] = [];
  for (const service of services) {
    try {
      console.log(`Trying geocoding service: ${service.name}`);
      const url = service.getUrl(fullAddress);
      const response = await fetch(url);

      if (!response.ok) {
        console.warn(`${service.name} returned status ${response.status}`);
        errors.push(`${service.name}: HTTP ${response.status}`);
        continue; // Try next service
      }

      const data = await response.json();
      const result = service.parseResponse(data);

      if (result) {
        console.log(`✓ ${service.name} found coordinates:`, result);
        return result;
      } else {
        console.warn(`${service.name} returned no results`);
        errors.push(`${service.name}: No results found`);
      }
    } catch (error) {
      console.error(`${service.name} error:`, error);
      errors.push(`${service.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // All services failed
  console.error("All geocoding services failed:", errors);
  return {
    error:
      "We couldn't find coordinates for this address. Please check the address and try again, or verify the street address, city, state, and ZIP code are all correct.",
  };
}

export const AddOrganizationScreen = ({ onCancel, onCreated, onFindNearbyOrg }: AddOrganizationScreenProps) => {
  const { user } = db.useAuth();
  const ownerEmailFromAuth = user && !user.isGuest ? (user.email ?? "") : "";
  const [formValues, setFormValues] = useState<FormState>(() => emptyFormState(ownerEmailFromAuth));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);
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

  // Enhanced input handler that works with both onChange and onInput
  // This ensures paste events are captured properly
  const handleInputChange = (field: keyof FormState) => (
    event: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>
  ) => {
    const value = event.currentTarget.value;
    handleFieldChange(field)(value);
  };

  // Special handler for address field that includes smart parsing
  const handleAddressChange = (
    event: React.ChangeEvent<HTMLInputElement> | React.FormEvent<HTMLInputElement>
  ) => {
    const value = event.currentTarget.value;
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
  };

  // Handler for updating hours for a specific day
  const handleHoursChange = (day: number, field: keyof DayHours, value: string | boolean) => {
    setFormValues((prev) => ({
      ...prev,
      hours: {
        ...prev.hours,
        [day]: {
          ...prev.hours[day],
          [field]: value,
        },
      },
    }));
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
    const submittedAt = Date.now();

    const canonicalOwnerEmail = ownerEmailInput.toLowerCase();
    const submitterEmailRaw = user && !user.isGuest ? user.email ?? null : null;
    const submitterEmail = submitterEmailRaw ? submitterEmailRaw.toLowerCase() : null;
    const submitterIsAdmin = submitterEmail ? isAdminEmail(submitterEmail) : false;
    const ownerIsAdmin = isAdminEmail(canonicalOwnerEmail);
    const moderationStatus: OrganizationModerationStatus =
      submitterIsAdmin || ownerIsAdmin ? "approved" : "pending";
    const shouldNotifyModerators = moderationStatus === "pending";

    const payload: Record<string, unknown> = {
      name: nextName,
      ownerEmail: canonicalOwnerEmail,
      category: formValues.category,
      status: formValues.status,
      latitude: latitudeValue,
      longitude: longitudeValue,
      moderationStatus,
      submittedAt,
      queueSortKey: submittedAt,
    };
    if (moderationStatus === "approved") {
      payload.moderationChangedAt = submittedAt;
    }

    const rawWebsiteValue = (formData.get("website") ?? formValues.website ?? "") as string;
    const normalizedWebsite = normalizeWebsiteUrl(rawWebsiteValue);
    const websiteValue = toNullableString(normalizedWebsite);
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

    // Convert hours to schema format
    const enabledDays = Object.entries(formValues.hours).filter(([_, hours]) => hours.enabled);
    if (enabledDays.length > 0) {
      const periods = enabledDays.map(([dayStr, hours]) => ({
        day: parseInt(dayStr, 10),
        openTime: hours.openTime,
        closeTime: hours.closeTime,
      }));

      // Generate human-readable weekday text with 12-hour format
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      const weekdayText = enabledDays.map(([dayStr, hours]) => {
        const dayNum = parseInt(dayStr, 10);
        const dayName = dayNames[dayNum];
        const openTime12 = formatTime12Hour(hours.openTime);
        const closeTime12 = formatTime12Hour(hours.closeTime);
        return `${dayName}: ${openTime12} – ${closeTime12}`;
      });

      payload.hours = {
        periods,
        weekdayText,
        isUnverified: moderationStatus !== "approved", // Admins auto-verify their submissions
      };
    }

    try {
      await db.transact(db.tx.organizations[organizationId].update(payload));
      if (shouldNotifyModerators) {
        void notifyQueueModerators({
          organizationId,
          organizationName: nextName,
          ownerEmail: canonicalOwnerEmail,
          submitterEmail,
          submittedAt,
        });
      }
      setIsSubmitting(false);
      setSubmissionSuccess(true);
      setFormError(null);
      // Delay calling onCreated to allow user to see success message
      setTimeout(() => {
        onCreated({
          id: organizationId,
          latitude: latitudeValue,
          longitude: longitudeValue,
          name: nextName,
        });
      }, 2000);
    } catch (error) {
      console.error("Failed to create organization", error);
      setFormError(
        error instanceof Error
          ? error.message
          : "We could not save the organization. Please try again.",
      );
      setIsSubmitting(false);
      setSubmissionSuccess(false);
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
            ← To Map
          </button>
          <div>
            <h1 className="text-3xl font-semibold font-display text-slate-900 dark:text-white">Add a Location</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
              Share the details of a community organization or business so neighbors can discover it on the map.
              If you don't have an organization yet just want to share food, then use the button below...
            </p>
            <button
              type="button"
              onClick={() => {
                onCancel();
                onFindNearbyOrg?.();
              }}
              className="mt-3 inline-flex w-max items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
            >
              <SearchIcon />
              Find a Nearby Organization to Give Food To
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid flex-1 grid-cols-1 gap-8 pb-20">
          <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <header className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
                01 — Essentials
              </p>
              <h2 className="text-xl font-semibold font-display text-slate-900 dark:text-white">Organization overview</h2>
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
                  onChange={handleInputChange("name")}
                  onInput={handleInputChange("name")}
                  autoComplete="organization"
                  placeholder="Community Resource Center"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
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
                    onChange={handleInputChange("ownerEmail")}
                    onInput={handleInputChange("ownerEmail")}
                    autoComplete="email"
                    placeholder="you@example.org"
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                  />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Required so you can edit your org details in the future.
                  </p>
                </div>
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Category</span>
                <div className="relative">
                  <select
                    name="category"
                    value={formValues.category}
                    onChange={(event) =>
                      handleFieldChange("category")(event.target.value as Category)
                    }
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                  >
                    {categoryOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                </div>
                {currentCategoryDescription && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {currentCategoryDescription}
                  </p>
                )}
              </label>

              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Status</span>
                <div className="relative">
                  <select
                    name="status"
                    value={formValues.status}
                    onChange={(event) =>
                      handleFieldChange("status")(event.target.value as OrganizationStatus)
                    }
                    className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3 py-2 pr-10 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                  >
                    {statusOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDownIcon className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
                </div>
              </label>
            </div>
          </section>

          <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <header className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
                02 — Location & contact
              </p>
              <h2 className="text-xl font-semibold font-display text-slate-900 dark:text-white">Where can we find it?</h2>
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
                  onChange={handleAddressChange}
                  onInput={handleAddressChange}
                  autoComplete="street-address"
                  placeholder="123 Community Ave. (or paste full address)"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
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
                  onChange={handleInputChange("city")}
                  onInput={handleInputChange("city")}
                  autoComplete="address-level2"
                  placeholder="Tulsa"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
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
                  onChange={handleInputChange("state")}
                  onInput={handleInputChange("state")}
                  autoComplete="address-level1"
                  placeholder="OK"
                  className="uppercase rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
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
                  onChange={handleInputChange("postalCode")}
                  onInput={handleInputChange("postalCode")}
                  autoComplete="postal-code"
                  placeholder="74103"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
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
                  onChange={handleInputChange("phone")}
                  onInput={handleInputChange("phone")}
                  autoComplete="tel"
                  placeholder="(918) 555-1234"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>

              {/* Hours subsection */}
              <div className="md:col-span-2 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Hours of Operation (Optional)</h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">Check days & set times</span>
                </div>
                <div className="space-y-2">
                  {[
                    { day: 1, label: "Monday" },
                    { day: 2, label: "Tuesday" },
                    { day: 3, label: "Wednesday" },
                    { day: 4, label: "Thursday" },
                    { day: 5, label: "Friday" },
                    { day: 6, label: "Saturday" },
                    { day: 0, label: "Sunday" },
                  ].map(({ day, label }) => (
                    <div key={day} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                      <label className="flex items-center gap-2 min-w-[100px]">
                        <input
                          type="checkbox"
                          checked={formValues.hours[day].enabled}
                          onChange={(e) => handleHoursChange(day, "enabled", e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
                        />
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
                      </label>
                      {formValues.hours[day].enabled && (
                        <div className="flex flex-wrap items-center gap-2 flex-1 pl-6 sm:pl-0">
                          <input
                            type="time"
                            value={formValues.hours[day].openTime}
                            onChange={(e) => handleHoursChange(day, "openTime", e.target.value)}
                            className="min-w-[120px] flex-1 sm:flex-none rounded border border-slate-300 px-2 py-1 text-base text-slate-900 focus:border-brand-400 focus:ring-1 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                          />
                          <span className="text-xs text-slate-500 dark:text-slate-400 flex-shrink-0">to</span>
                          <input
                            type="time"
                            value={formValues.hours[day].closeTime}
                            onChange={(e) => handleHoursChange(day, "closeTime", e.target.value)}
                            className="min-w-[120px] flex-1 sm:flex-none rounded border border-slate-300 px-2 py-1 text-base text-slate-900 focus:border-brand-400 focus:ring-1 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <header className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">
                03 — Optional extras
              </p>
              <h2 className="text-xl font-semibold font-display text-slate-900 dark:text-white">Help us tell the full story</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Websites, sources, and service categories help residents know what to expect before they visit.
              </p>
            </header>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Website</span>
                <input
                  name="website"
                  type="text"
                  value={formValues.website}
                  onChange={handleInputChange("website")}
                  onInput={handleInputChange("website")}
                  onBlur={(e) => {
                    const normalized = normalizeWebsiteUrl(e.target.value);
                    handleFieldChange("website")(normalized);
                  }}
                  autoComplete="url"
                  placeholder="example.org (we'll add https:// for you)"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Organization Sub-type</span>
                <input
                  name="googleCategory"
                  type="text"
                  value={formValues.googleCategory}
                  onChange={handleInputChange("googleCategory")}
                  onInput={handleInputChange("googleCategory")}
                  placeholder="Food Bank"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
            </div>
          </section>

          <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-slate-200 bg-white/80 p-3 shadow-lg backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
            {formError ? (
              <p className="text-sm font-medium text-rose-600 dark:text-rose-300">{formError}</p>
            ) : submissionSuccess ? (
              <p className="text-sm font-medium text-green-600 dark:text-green-300">
                Thank you for your map submission! We'll review and add your location as soon as we're able.
              </p>
            ) : (
              <div className="flex-1" />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white sm:px-4"
                disabled={isSubmitting}
                aria-label="Cancel"
              >
                <XMarkIcon className="h-4 w-4 sm:hidden" />
                <span className="hidden sm:inline">Cancel</span>
              </button>
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-brand-600 px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-brand-500 dark:hover:bg-brand-400 dark:focus:ring-brand-300 dark:focus:ring-offset-slate-900"
                disabled={isSubmitting || submissionSuccess}
              >
                {isSubmitting ? "Saving…" : "Submit for Map Approval"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddOrganizationScreen;
