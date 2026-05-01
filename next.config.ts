import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Notice board metadata can include larger document URLs during upload fallback.
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
