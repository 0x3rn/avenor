import type { MetadataRoute } from "next";

export const PRIVATE_DISALLOWED_PATHS = [
  "/api/",
  "/dashboard",
  "/projects",
  "/connections",
  "/costs",
  "/backend",
  "/reliability",
  "/reports",
  "/alerts",
  "/billing",
  "/usage",
  "/exports",
  "/settings",
  "/onboarding",
  "/login",
  "/signup",
] as const;

export default function robots(): MetadataRoute.Robots {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://app.avenor.dev").replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/pricing", "/security", "/help", "/contact", "/privacy", "/terms"],
        disallow: [...PRIVATE_DISALLOWED_PATHS],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
