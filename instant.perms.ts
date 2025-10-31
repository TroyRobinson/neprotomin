import type { InstantRules } from "@instantdb/react";

const splitEntries = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const ADMIN_EMAILS = new Set<string>([
  ...splitEntries(process.env.ADMIN_EMAIL),
  ...splitEntries(process.env.VITE_ADMIN_EMAIL),
]);

const ADMIN_DOMAINS = new Set<string>(
  [
    ...splitEntries(process.env.ADMIN_DOMAIN),
    ...splitEntries(process.env.VITE_ADMIN_DOMAIN),
  ].map((domain) => (domain.startsWith("@") ? domain.slice(1) : domain)),
);

const quote = (value: string): string => `'${value.replace(/'/g, "\\'")}'`;

const adminChecks: string[] = [];
if (ADMIN_EMAILS.size > 0) {
  adminChecks.push(`auth.email in [${Array.from(ADMIN_EMAILS).map(quote).join(", ")}]`);
}
if (ADMIN_DOMAINS.size > 0) {
  const domainChecks = Array.from(ADMIN_DOMAINS).map(
    (domain) => `auth.email.endsWith(${quote(`@${domain}`)})`,
  );
  adminChecks.push(`(${domainChecks.join(" || ")})`);
}

const adminCondition =
  adminChecks.length > 0 ? `auth.email != null && (${adminChecks.join(" || ")})` : "false";

const restrictedStatuses = "['approved', 'declined']";

const rules = {
  organizations: {
    allow: {
      view: "true",
      create: "auth.id != null && (!createsRestrictedStatus || isAdmin)",
      update: "auth.id != null && (!changesRestrictedStatus || isAdmin)",
      delete: "isAdmin",
    },
    bind: [
      "isAdmin",
      adminCondition,
      "createsRestrictedStatus",
      `data.moderationStatus in ${restrictedStatuses}`,
      "changesRestrictedStatus",
      `newData.moderationStatus in ${restrictedStatuses} && newData.moderationStatus != data.moderationStatus`,
    ],
  },
} satisfies InstantRules;

export default rules;
