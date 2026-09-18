/** Browser mutations must originate from this app. Non-browser clients omit Origin. */
export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  try {
    const incoming = new URL(origin);
    const target = new URL(request.url);
    const allowed = new Set([target.origin]);
    const host = request.headers.get("host");
    if (host) allowed.add(`${target.protocol}//${host}`);
    // Deployment proxies can rewrite Host. Only trust explicitly configured
    // public origins, never arbitrary forwarded headers or wildcard tenants.
    for (const configured of [process.env.APP_URL, process.env.PUBLIC_ORIGIN]) {
      if (!configured) continue;
      try {
        const url = new URL(
          configured.includes("://") ? configured : `https://${configured}`,
        );
        if (["https:", "http:"].includes(url.protocol)) allowed.add(url.origin);
      } catch {
        /* A malformed optional configuration grants no access. */
      }
    }
    if (
      ["https:", "http:"].includes(incoming.protocol) &&
      allowed.has(incoming.origin)
    )
      return null;
  } catch {
    /* Invalid Origin is rejected. */
  }
  return Response.json(
    { error: "Cross-origin mutation rejected" },
    { status: 403 },
  );
}
