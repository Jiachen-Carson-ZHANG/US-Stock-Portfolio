/**
 * Which portfolio the navigation points at, given the address and the one it
 * pointed at before.
 *
 * The one in the address when there is one. Otherwise the last one that was:
 * the playground, the watchlist and the account page have no portfolio in
 * their address, and leaving one of those for Holdings has to land where the
 * reader came from. The server's idea of a default cannot answer this — the
 * layout works it out once, when the site first loads, and never again while
 * the reader moves between pages — so it is only the starting point.
 */
export function navSlug(
  pathname: string,
  visible: readonly { slug: string }[],
  last: string,
): string {
  const first = pathname.split("/")[1] ?? "";
  return visible.some((portfolio) => portfolio.slug === first) ? first : last;
}
