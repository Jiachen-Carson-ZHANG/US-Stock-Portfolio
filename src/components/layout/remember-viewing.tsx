"use client";

import { useEffect } from "react";

/**
 * Tells the server which portfolio is open, once per change.
 *
 * Renders nothing. It exists because the page itself cannot set the cookie
 * that remembers the choice; see /api/me/viewing.
 */
export function RememberViewing({ slug }: { slug: string }) {
  useEffect(() => {
    void fetch(`/api/me/viewing?portfolio=${encodeURIComponent(slug)}`, {
      method: "POST",
      keepalive: true,
    }).catch(() => {
      // A preference that failed to save costs a click later, not a page.
    });
  }, [slug]);

  return null;
}
