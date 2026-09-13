import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@araxia/verify"],
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
