import { Skeleton } from "@/components/ui/misc";

/**
 * What a page looks like while the server is still building it.
 *
 * Without one of these, clicking a tab does nothing visible until the server
 * answers. The click registers, the old page stays interactive, another tab
 * can be clicked on top of it — but none of that is apparent, so the site
 * reads as frozen. Next also refuses to prefetch a dynamic route that has no
 * loading boundary, so the wait started on click rather than on hover.
 *
 * With one, the tab swaps instantly: the sidebar and header stay, this stands
 * in for the content, and the real thing replaces it when it arrives.
 */
export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-6 w-40" />

      <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl sm:h-32" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>

      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}

/** For the pages that are a list rather than a grid of figures. */
export function ListSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-6 w-40" />
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
