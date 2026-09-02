import { useQuery } from "@tanstack/react-query";

import type { SiteSettings } from "../../shared/schemas";
import { api } from "./api";

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  id: "site",
  institutionName: "SLAMS",
  atRiskThreshold: 70,
  marqueeItems: [],
  testimonials: [],
  demoAccountsEnabled: false,
  demoEmailDomain: "slams.edu",
  showFakeStats: false,
  primaryColor: null,
  contactEmail: null,
};

export const publicSettingsQueryOptions = {
  queryKey: ["settings", "public"] as const,
  queryFn: () => api.publicSettings(),
  // Branding rarely changes and is cached at the edge; avoid refetching it on
  // every route transition.
  staleTime: 5 * 60_000,
};

export function usePublicSettings() {
  return useQuery(publicSettingsQueryOptions);
}

export function useAtRiskThreshold(): number {
  const { data } = usePublicSettings();
  return data?.atRiskThreshold ?? DEFAULT_SITE_SETTINGS.atRiskThreshold;
}
