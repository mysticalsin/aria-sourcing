/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Demo MVP: do not fail production builds on lint. `npm run lint` still works.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
