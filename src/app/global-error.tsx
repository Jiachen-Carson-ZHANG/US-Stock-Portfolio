"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/stale-code";

/**
 * The last resort: a failure in the root layout itself, where the normal
 * error screen cannot render because there is no layout left to render it
 * into. It has to ship its own <html> and its own styles for that reason.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    reportClientError("global-boundary", error, error.digest);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fff",
          color: "#111",
          padding: "2rem",
        }}
      >
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            The site could not start
          </h1>
          <p style={{ fontSize: "0.875rem", lineHeight: 1.6, color: "#555" }}>
            Something failed before any page could be built, which almost always
            means this deployment is missing a setting it needs. The reference
            below will appear in the server log.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "1.5rem",
              minHeight: "2.75rem",
              padding: "0 1.25rem",
              borderRadius: "0.75rem",
              border: "none",
              background: "#111",
              color: "#fff",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          {error.digest && (
            <p style={{ marginTop: "1.5rem", fontSize: "0.75rem", color: "#777" }}>
              Reference {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
