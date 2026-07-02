import { useSyncExternalStore } from "react";
import { getSession, subscribe, type Auth0Session } from "./auth0";

export function useAuthSession(): Auth0Session | null {
  return useSyncExternalStore(subscribe, getSession, getSession);
}
