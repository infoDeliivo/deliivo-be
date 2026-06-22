import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root (parent directory) so we maintain a single env file.
// Only loads vars not already set in the environment (Docker env vars take precedence).
config({ path: resolve(__dirname, "../.env") });

const nextConfig: NextConfig = {
  // Prevent non-NEXT_PUBLIC_ env vars from leaking into the client bundle
  serverExternalPackages: ["dotenv"],
};

export default nextConfig;
