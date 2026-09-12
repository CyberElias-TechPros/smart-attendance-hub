import { useQuery } from "@tanstack/react-query";

import { publicSettingsQO, siteSettingsQO } from "./queries";
import type { Testimonial } from "./types";

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
  primaryColor: string | null;
  contactEmail: string | null;
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

/**
 * Public branding for unauthenticated pages (landing + login).
 * Falls back to defaults if the API is unreachable.
 */
export function usePublicSettings() {
  return useQuery(publicSettingsQO);
}

/** Full settings for authenticated pages (admin branding page, thresholds). */
export function useSiteSettings() {
  return useQuery(siteSettingsQO);
}

export function useAtRiskThreshold(): number {
  const { data } = useSiteSettings();
  return data?.atRiskThreshold ?? DEFAULT_SITE_SETTINGS.atRiskThreshold;
}
