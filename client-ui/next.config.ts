import type { NextConfig } from "next";

const apiUrl = process.env.API_URL || "http://control-plane:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      // Proxy static assets served by the control plane (install.sh,
      // gpu-network-setup.exe, agent binaries). Keeping them same-origin
      // lets `<a download>` work and avoids exposing the :8000 port to
      // the user in the download URL.
      {
        source: "/public/:path*",
        destination: `${apiUrl}/public/:path*`,
      },
    ];
  },
};

export default nextConfig;
