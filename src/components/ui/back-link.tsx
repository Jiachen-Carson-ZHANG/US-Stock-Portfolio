import Link from "next/link";
import { ChevronLeft } from "lucide-react";

/**
 * The way back.
 *
 * A screen reached from the dashboard and reachable no other way needs one,
 * or the only exit is the browser's own button — which on a phone, in a
 * saved-to-home-screen window, is not there at all.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
