import type { NextConfig } from "next";

const apiUrl = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const config: NextConfig = {
  agentRules: false,
  async rewrites() {
    return [{ source: "/backend/:path*", destination: `${apiUrl}/:path*` }];
  },
};

export default config;
