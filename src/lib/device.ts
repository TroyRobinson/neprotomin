type NavigatorWithMemory = Navigator & {
  deviceMemory?: number;
  userAgentData?: { mobile?: boolean };
};

export const isLowMemoryDevice = (): boolean => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const nav = navigator as NavigatorWithMemory;
  const memory = typeof nav.deviceMemory === "number" ? nav.deviceMemory : null;
  const cores =
    typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null;
  const uaMobile =
    typeof nav.userAgentData?.mobile === "boolean"
      ? nav.userAgentData.mobile
      : /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (memory !== null && memory > 0 && memory <= 4) return true;
  if (cores !== null && cores > 0 && cores <= 4) return true;
  if (uaMobile) return true;

  return false;
};
