import "dotenv/config";
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

const restrictedStatuses = "['approved', 'declined', 'removed']";

const rules = {
  $default: {
    allow: {
      $default: "false",
    },
  },
  attrs: {
    allow: {
      create: "isAdmin",
    },
    bind: ["isAdmin", adminCondition],
  },
  organizations: {
    allow: {
      view: "isAdmin || data.moderationStatus == 'approved' || data.moderationStatus == null",
      create: "allowPublicOrgCreate",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: [
      "isAdmin",
      adminCondition,
      "setsRestrictedStatus",
      `newData.moderationStatus in ${restrictedStatuses}`,
      "allowPublicOrgCreate",
      "(!setsRestrictedStatus) || isAdmin",
    ],
  },
  comments: {
    allow: {
      view: "isAdmin",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", adminCondition],
  },
  uiState: {
    allow: {
      view: "isAdmin || (auth.id != null && data.owner == auth.id)",
      create: "isAdmin || (auth.id != null && newData.owner == auth.id)",
      update: "isAdmin || (auth.id != null && data.owner == auth.id)",
      delete: "isAdmin || (auth.id != null && data.owner == auth.id)",
    },
    bind: ["isAdmin", adminCondition],
  },
  areas: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", adminCondition],
  },
  stats: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", adminCondition],
  },
  statData: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", adminCondition],
  },
  $files: {
    allow: {
      view: "true",
      create: "isAdmin",
      update: "isAdmin",
      delete: "isAdmin",
    },
    bind: ["isAdmin", adminCondition],
  },
} satisfies InstantRules;

export default rules;
