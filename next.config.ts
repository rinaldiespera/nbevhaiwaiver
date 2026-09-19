import type { NextConfig } from "next";

const forceServerlessOutput = process.env.SERVERLESS_DEPLOYMENT === "1" || process.env.SERVERLESS_DEPLOYMENT === "true";

const config: NextConfig = {
  ...(forceServerlessOutput
    ? {}
    : {
        output: "standalone" as const,
      }),
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default config;
