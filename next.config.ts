import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["pg"],
  transpilePackages: [
    "@avenor/types",
    "@avenor/config",
    "@avenor/ui",
    "@avenor/database",
    "@avenor/auth",
  ],
  async redirects() {
    return [
      {
        source: "/register",
        destination: "/signup",
        permanent: true,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
