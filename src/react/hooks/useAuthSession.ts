import { useEffect, useMemo, useState } from "react";
import { db } from "../../lib/reactDb";

const isBrowser = typeof window !== "undefined";

let initialSessionResolved = !isBrowser;
let initialSessionPromise: Promise<void> | null = null;
let guestBootstrapPromise: Promise<void> | null = null;

const ensureInitialSessionResolved = async () => {
  if (!isBrowser) return;
  if (initialSessionResolved) return;
  if (!initialSessionPromise) {
    initialSessionPromise = db
      .getAuth()
      .catch(() => null)
      .then(() => {
        initialSessionResolved = true;
      })
      .finally(() => {
        initialSessionPromise = null;
      });
  }
  await initialSessionPromise;
};

const ensureGuestSession = async () => {
  if (!isBrowser) return;
  if (guestBootstrapPromise) return guestBootstrapPromise;
  guestBootstrapPromise = (async () => {
    try {
      const existing = await db.getAuth().catch(() => null);
      if (existing) return;
      await db.auth.signInAsGuest();
    } catch (error) {
      console.warn("[auth] guest bootstrap failed", error);
    } finally {
      guestBootstrapPromise = null;
    }
  })();
  await guestBootstrapPromise;
};

export const useAuthSession = () => {
  const authState = db.useAuth();
  const { isLoading, user } = authState;
  const [initialResolved, setInitialResolved] = useState(initialSessionResolved);

  useEffect(() => {
    if (!isBrowser) return;
    if (initialResolved) return;
    let cancelled = false;
    ensureInitialSessionResolved()
      .catch(() => {
        // ignored; we'll rely on useAuth updates
      })
      .finally(() => {
        if (!cancelled) {
          setInitialResolved(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialResolved]);

  const authReady = useMemo(() => {
    if (!initialResolved) return false;
    if (user) return true;
    if (isLoading) return false;
    return true;
  }, [initialResolved, isLoading, user]);

  useEffect(() => {
    if (!isBrowser) return;
    if (!authReady) return;
    if (user) return;
    ensureGuestSession().catch(() => {
      // already logged
    });
  }, [authReady, user]);

  return useMemo(
    () => ({
      ...authState,
      authReady,
    }),
    [authState, authReady],
  );
};
