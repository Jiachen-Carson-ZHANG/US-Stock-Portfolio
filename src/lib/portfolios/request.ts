/**
 * Which portfolio an API request is about.
 *
 * A query parameter rather than a path segment, because these endpoints are
 * called from client components that already know the slug and would
 * otherwise each need their own route. Absent, the caller means their own.
 *
 * Returning the raw string is safe: it is only ever used to look up a row,
 * and access is re-checked against the result.
 */
export function portfolioSlugFrom(request: Request): string | undefined {
  const slug = new URL(request.url).searchParams.get("portfolio");
  return slug && slug.length > 0 ? slug : undefined;
}
