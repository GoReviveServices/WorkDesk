/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // NOTE: unlike vercel.json / vite.config.ts before, we do NOT proxy
  // /api/* to gorevive.jbbs.in via rewrites. All legacy-backend calls now
  // go through our own Route Handlers in src/app/api/**, which read
  // GOREVIVE_BASE_URL from the environment (see .env.local.example) and
  // do the HTML-scraping/parsing server-side. Keeps the legacy session
  // cookie off the client entirely.
};

export default nextConfig;
