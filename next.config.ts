import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  // La raíz lleva al dashboard; si no hay sesión, el proxy redirige a /login.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
  partialPrefetching: true,
  reactCompiler: true,
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
