import type { NextConfig } from "next";
import { existsSync } from "fs";
import { config } from "dotenv";
import { resolve } from "path";

// Load the root .env only for local development when the file actually exists.
// Vercel should rely on project environment variables instead.
const rootEnvPath = resolve(__dirname, "../.env");
if (existsSync(rootEnvPath)) {
  config({ path: rootEnvPath });
}

const nextConfig: NextConfig = {
  // Prevent non-NEXT_PUBLIC_ env vars from leaking into the client bundle
  serverExternalPackages: ["dotenv"],
};

export default nextConfig;
