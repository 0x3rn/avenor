import type { MetadataRoute } from "next";

export const PUBLIC_SITEMAP_PATHS = [
  "/",
  "/pricing",
  "/security",
  "/help",
  "/contact",
  "/privacy",
  "/terms",
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://app.avenor.dev").replace(/\/$/, "");
  const lastModified = new Date("2026-11-21T00:00:00.000Z");

  return PUBLIC_SITEMAP_PATHS.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified,
    changeFrequency: route === "/" || route === "/pricing" ? "weekly" : "monthly",
    priority: route === "/" ? 1.0 : route === "/pricing" || route === "/security" ? 0.8 : 0.6,
  }));
}
