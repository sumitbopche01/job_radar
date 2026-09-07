import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "node:path";

// Load the repo-root .env so DATABASE_URL is available to server components/actions.
config({ path: resolve(process.cwd(), "../../.env") });

const nextConfig: NextConfig = {
  transpilePackages: ["@job-radar/core"],
  serverExternalPackages: ["postgres"],
  webpack: (config) => {
    // core uses NodeNext-style ".js" import specifiers pointing at ".ts" sources
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
