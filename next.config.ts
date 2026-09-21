import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Everything is same-origin by design: no external CDN, font or analytics host
// is permitted, which is also what keeps the app loadable in mainland China.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // Emits a self-contained server bundle, so a container does not need the
  // whole node_modules tree and the app stays portable across hosts.
  output: "standalone",
  serverExternalPackages: ["pg", "@node-rs/argon2"],
  poweredByHeader: false,
  experimental: {
    // Allow an explicitly configured public host when running behind a proxy.
    serverActions: {
      // Entries are matched against the *host* of the Origin header, so a value
      // carrying a scheme never matches and fails silently. Strip it, since a
      // hosting panel asking for a URL is the obvious thing to paste.
      allowedOrigins: [
        ...(process.env.PUBLIC_ORIGIN
          ? [process.env.PUBLIC_ORIGIN.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "")]
          : []),
      ],
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
