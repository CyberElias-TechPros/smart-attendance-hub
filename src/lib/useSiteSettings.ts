import { useQuery } from "@tanstack/react-query";
import { getSiteSettings } from "./api.functions";
import type { Testimonial } from "./db.server";

export interface SiteSettingsData {
  id: string;
  institutionName: string;
  atRiskThreshold: number;
  marqueeItems: string[];
  testimonials: Testimonial[];
  demoAccountsEnabled: boolean;
  demoPassword: string;
  demoEmailDomain: string;
  showFakeStats: boolean;
  primaryColor?: string | null;
  contactEmail?: string | null;
}

export const DEFAULT_SITE_SETTINGS: SiteSettingsData = {
  id: "site",
  institutionName: "SLAMS",
  atRiskThreshold: 70,
  marqueeItems: ["Real-time QR check-in", "Fraud-resistant codes", "Zero paper sheets"],
  testimonials: [],
  demoAccountsEnabled: true,
  demoPassword: "password123",
  demoEmailDomain: "slams.edu",
  showFakeStats: true,
  primaryColor: null,
  contactEmail: null,
};

export const siteSettingsQO = {
  queryKey: ["siteSettings"] as const,
  queryFn: () => getSiteSettings(),
};

export function useSiteSettings() {
  return useQuery({ ...siteSettingsQO, staleTime: 60_000 });
}

export function useAtRiskThreshold(): number {
  const { data } = useSiteSettings();
  return data?.atRiskThreshold ?? DEFAULT_SITE_SETTINGS.atRiskThreshold;
}
