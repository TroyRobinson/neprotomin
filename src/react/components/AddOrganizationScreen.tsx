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
  latitude: "",
  longitude: "",
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

export const AddOrganizationScreen = ({ onCancel, onCreated }: AddOrganizationScreenProps) => {
  const { user } = db.useAuth();
  const ownerEmailFromAuth = user && !user.isGuest ? (user.email ?? "") : "";
  const [formValues, setFormValues] = useState<FormState>(() => emptyFormState(ownerEmailFromAuth));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

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
    const rawLatitude =
      (formData.get("latitude") ??
        formValues.latitude ??
        "") as string;
    const rawLongitude =
      (formData.get("longitude") ??
        formValues.longitude ??
        "") as string;

    const nextName = rawName.trim();
    const ownerEmailInput = rawOwnerEmail.trim();

    const { value: latitudeValue, error: latitudeError } = parseCoordinate(
      "Latitude",
      rawLatitude,
      -90,
      90,
    );
    if (latitudeError) {
      setFormError(latitudeError);
      return;
    }

    const { value: longitudeValue, error: longitudeError } = parseCoordinate(
      "Longitude",
      rawLongitude,
      -180,
      180,
    );
    if (longitudeError) {
      setFormError(longitudeError);
      return;
    }

    if (!nextName) {
      setFormError("Organization name is required.");
      return;
    }
    if (!ownerEmailInput) {
      setFormError("Owner email is required so you can revise details later.");
      return;
    }

    setIsSubmitting(true);
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
                Latitude and longitude determine the map pin. Contact details help neighbors get in touch.
              </p>
            </header>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Latitude <span className="text-brand-500">*</span>
                </span>
                <input
                  name="latitude"
                  type="number"
                  required
                  inputMode="decimal"
                  step="any"
                  value={formValues.latitude}
                  onChange={(event) => handleFieldChange("latitude")(event.target.value)}
                  placeholder="36.1539"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  Longitude <span className="text-brand-500">*</span>
                </span>
                <input
                  name="longitude"
                  type="number"
                  required
                  inputMode="decimal"
                  step="any"
                  value={formValues.longitude}
                  onChange={(event) => handleFieldChange("longitude")(event.target.value)}
                  placeholder="-95.9928"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2 md:col-span-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">Street address</span>
                <input
                  name="address"
                  type="text"
                  value={formValues.address}
                  onChange={(event) => handleFieldChange("address")(event.target.value)}
                  autoComplete="street-address"
                  placeholder="123 Community Ave."
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">City</span>
                <input
                  name="city"
                  type="text"
                  value={formValues.city}
                  onChange={(event) => handleFieldChange("city")(event.target.value)}
                  autoComplete="address-level2"
                  placeholder="Tulsa"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">State</span>
                <input
                  name="state"
                  type="text"
                  value={formValues.state}
                  onChange={(event) => handleFieldChange("state")(event.target.value)}
                  autoComplete="address-level1"
                  placeholder="OK"
                  className="uppercase rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium text-slate-800 dark:text-slate-100">ZIP / Postal code</span>
                <input
                  name="postalCode"
                  type="text"
                  value={formValues.postalCode}
                  onChange={(event) => handleFieldChange("postalCode")(event.target.value)}
                  autoComplete="postal-code"
                  placeholder="74103"
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-500/40"
                />
              </label>
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
