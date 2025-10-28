type EnvRecord = Record<string, unknown>;

const coerceBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.toLowerCase().trim();
    if (["true", "1", "yes", "y"].includes(lowered)) return true;
    if (["false", "0", "no", "n"].includes(lowered)) return false;
  }
  return undefined;
};

const getImportMetaEnv = (): EnvRecord => {
  try {
    const env = (import.meta as { env?: EnvRecord }).env;
    return env && typeof env === "object" ? env : {};
  } catch {
    return {};
  }
};

const getProcessEnv = (): EnvRecord => {
  const globalProcess = typeof globalThis === "object" ? (globalThis as Record<string, any>).process : undefined;
  if (!globalProcess || typeof globalProcess !== "object" || typeof globalProcess.env !== "object") {
    return {};
  }
  return globalProcess.env as EnvRecord;
};

export const getEnv = (): EnvRecord => {
  return { ...getProcessEnv(), ...getImportMetaEnv() };
};

export const getEnvString = (key: string): string | undefined => {
  const value = getEnv()[key];
  return typeof value === "string" ? value : undefined;
};

export const getEnvBoolean = (key: string): boolean | undefined => {
  const value = getEnv()[key];
  return coerceBoolean(value);
};

export const isDevEnv = (): boolean => {
  const rawDev = getEnvBoolean("DEV");
  if (rawDev !== undefined) return rawDev;

  const mode = getEnvString("MODE") ?? getEnvString("NODE_ENV");
  if (mode) return mode !== "production";

  return true;
};

export const isSyntheticSeedEnabled = (): boolean => {
  const explicitFlag = getEnvBoolean("VITE_ENABLE_SYNTHETIC_SEED");
  if (explicitFlag !== undefined) return explicitFlag;
  return isDevEnv();
};
