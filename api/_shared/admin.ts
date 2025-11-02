const splitEntries = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
};

const resolveAdminEmails = (): Set<string> => {
  const entries = [
    ...splitEntries(process.env.VITE_ADMIN_EMAIL),
    ...splitEntries(process.env.ADMIN_EMAIL),
  ];
  return new Set(entries);
};

const resolveAdminDomains = (): Set<string> => {
  const entries = [
    ...splitEntries(process.env.VITE_ADMIN_DOMAIN),
    ...splitEntries(process.env.ADMIN_DOMAIN),
  ].map((domain) => (domain.startsWith("@") ? domain.slice(1) : domain));
  return new Set(entries);
};

const ADMIN_EMAILS = resolveAdminEmails();
const ADMIN_DOMAINS = resolveAdminDomains();

export const isAdminEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (ADMIN_EMAILS.has(normalized)) return true;

  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1) return false;
  const domain = normalized.slice(atIndex + 1);
  if (!domain) return false;
  if (ADMIN_DOMAINS.has(domain)) return true;

  return false;
};
