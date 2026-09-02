// Client-side authentication state.
//
// The session itself is an HttpOnly cookie the browser cannot read; this context
// only mirrors *who the server says we are* so the UI can render the right
// navigation and redirect unauthenticated visitors. Every actual permission
// decision is made again server-side — this is presentation only.

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { RouterProvider, type AnyRouter } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useMemo } from "react";

import type { PublicUser, Role } from "../../shared/schemas";
import { api } from "./api";
import { FullPageLoader } from "@/components/Loaders";

export interface AuthState {
  user: PublicUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  hasRole: (...roles: Role[]) => boolean;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<PublicUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const meQueryOptions = {
  queryKey: ["auth", "me"] as const,
  queryFn: async () => (await api.me()).user,
  staleTime: 60_000,
  retry: false,
};

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}

function useAuthState(queryClient: QueryClient): AuthState {
  const { data, isLoading } = useQuery(meQueryOptions);
  const user = data ?? null;

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
  }, [queryClient]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { user: signedIn } = await api.login({ email, password });
      queryClient.setQueryData(meQueryOptions.queryKey, signedIn);
      return signedIn;
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Clear every cached query: leftover data from the previous account must
      // never be visible to whoever signs in next on this device.
      queryClient.setQueryData(meQueryOptions.queryKey, null);
      queryClient.clear();
    }
  }, [queryClient]);

  return useMemo(
    () => ({
      user,
      isLoading,
      isAuthenticated: !!user,
      hasRole: (...roles: Role[]) => !!user && roles.includes(user.role),
      refresh,
      signIn,
      signOut,
    }),
    [user, isLoading, refresh, signIn, signOut],
  );
}

/**
 * Resolves the session before the router renders, so route guards can make a
 * synchronous decision and authenticated users never see a flash of the login
 * page on a hard refresh.
 */
export function AuthProvider({ router }: { router: AnyRouter }) {
  const queryClient = useQueryClient();
  const auth = useAuthState(queryClient);

  if (auth.isLoading) return <FullPageLoader label="Preparing your workspace" />;

  return (
    <AuthContext.Provider value={auth}>
      <RouterProvider router={router} context={{ queryClient, auth }} />
    </AuthContext.Provider>
  );
}

export function homePathForRole(role: Role): string {
  if (role === "admin") return "/admin";
  if (role === "lecturer") return "/lecturer";
  return "/student";
}
