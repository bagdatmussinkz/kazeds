/** @type {import('next').NextConfig} */
const nextConfig = {
  // Web App is served at https://sign.aitu.uz/app/* through nginx.
  basePath: "/app",
  // Asset prefix ensures /_next/* loads under /app/_next/* in production.
  assetPrefix: process.env.NODE_ENV === "production" ? "/app" : undefined,
  // Keep `next build` output away from the dev server's .next — running a
  // production build while `next dev` is up corrupts its runtime otherwise.
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  reactStrictMode: true,
};

module.exports = nextConfig;
