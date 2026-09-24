import { isOpenAccess } from "./src/lib/auth/mode";
import type { NextConfig } from "next";

isOpenAccess(); // Validate authentication before starting or building the app.

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
  // Which deployment this build is, so an old browser tab can notice it is
  // talking to a newer one.
  //
  // Without it, a phone that kept the site open across a deploy went on
  // running the old code against the new server: navigations fetched pages it
  // could no longer read, and asked for script files that no longer existed.
  // The page froze on its loading skeleton, and every button — including
  // "try again", which only retries with the same stale code — did nothing
  // until the page was refreshed by hand.
  //
  // With it, Next compares the id on every navigation and, on a mismatch,
  // reloads the page instead of attempting a client-side navigation it cannot
  // complete. One reload, and the tab is running current code again.
  deploymentId:
    process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
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
