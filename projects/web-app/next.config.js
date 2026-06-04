/** @type {import('next').NextConfig} */
const nextConfig = {
  // Web App is served at https://sign.aitu.uz/app/* through nginx.
  basePath: "/app",
  // Asset prefix ensures /_next/* loads under /app/_next/* in production.
  assetPrefix: process.env.NODE_ENV === "production" ? "/app" : undefined,
  reactStrictMode: true,
};

module.exports = nextConfig;
