/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep `next build` output away from the dev server's .next — running a
  // production build while `next dev` is up corrupts its runtime otherwise.
  distDir: process.env.NODE_ENV === "production" ? ".next-build" : ".next",
  reactStrictMode: true,
};

module.exports = nextConfig;
