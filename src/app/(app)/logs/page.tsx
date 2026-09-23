import { requireOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { recentActivity } from "@/lib/activity";
import { pruneTimings, recentTimings, slowestPaths, SLOW_ENOUGH_MS } from "@/lib/observe";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";

/**
 * Long enough to survive the database waking from suspend, which has been
 * measured at 26 seconds. Without this the platform's default cut the render
 * short and the reader got an error page instead of one slow load.
 */
export const maxDuration = 60;


function ms(value: number | null): string {
  if (value === null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * What the site has been doing, and how long it took.
 *
 * Owner only, because it names people. Three questions, in the order anybody
 * actually asks them: which operations are slow, where that time goes, and
 * who has been doing what.
 *
 * The speed table records only the slow ones — anything under the threshold
 * is fine and keeping it would bury what is not. So an empty table is good
 * news, not a broken page.
 */
export default async function LogsPage() {
  await requireOwner();

  const db = await getDb();
  // Trimmed on the way in rather than by a job nobody remembers to set up.
  void pruneTimings().catch(() => {});

  const [paths, recent, activity] = await Promise.all([
    slowestPaths(24),
    recentTimings(60),
    recentActivity(db, 60),
  ]);

  return (
    <div className="space-y-6">
      <BackLink href="/settings" label="Settings" />

      <header>
        <h1 className="text-lg font-semibold tracking-tight">Speed and activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Owner only. Anything that took less than {SLOW_ENOUGH_MS}ms is not
          recorded, so an empty table here means everything was fast.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">Slowest operations, last 24 hours</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Median rather than average: one cold start of nine seconds drags an
          average somewhere no request actually was. &ldquo;Database&rdquo; and
          &ldquo;broker&rdquo; are the time spent inside calls of each kind —
          added up across calls, so where several ran at once they can total
          more than the operation itself took, and that is the point: it says
          the waiting was overlapped rather than serial.
        </p>

        {paths.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Nothing slow enough to record.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="py-2 text-left font-medium">Operation</th>
                  <th scope="col" className="py-2 text-right font-medium">Times</th>
                  <th scope="col" className="py-2 text-right font-medium">Usually</th>
                  <th scope="col" className="py-2 text-right font-medium">Worst</th>
                  <th scope="col" className="py-2 text-right font-medium">Database</th>
                  <th scope="col" className="py-2 text-right font-medium">Broker</th>
                  <th scope="col" className="py-2 text-right font-medium">Failed</th>
                </tr>
              </thead>
              <tbody>
                {paths.map((row) => (
                  <tr key={row.path} className="border-b border-border last:border-0">
                    <th scope="row" className="py-2 text-left font-medium">{row.path}</th>
                    <td className="tabular py-2 text-right text-muted-foreground">
                      {row.samples}
                    </td>
                    <td className="tabular py-2 text-right font-medium">{ms(row.medianMs)}</td>
                    <td className="tabular py-2 text-right text-muted-foreground">
                      {ms(row.worstMs)}
                    </td>
                    <td className="tabular py-2 text-right text-muted-foreground">
                      {ms(row.medianDbMs)}
                    </td>
                    <td className="tabular py-2 text-right text-muted-foreground">
                      {ms(row.medianBrokerMs)}
                    </td>
                    <td
                      className={`tabular py-2 text-right ${row.errors > 0 ? "text-negative" : "text-muted-foreground"}`}
                    >
                      {row.errors}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">The last slow or failed requests</h2>
        {recent.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing recorded.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {recent.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <span className="text-sm font-medium">{row.path}</span>
                <span
                  className={`tabular text-sm ${row.outcome === "ok" ? "" : "text-negative"}`}
                >
                  {ms(row.ms)}
                </span>
                <span className="text-xs text-muted-foreground">
                  db {ms(row.dbMs)} · broker {ms(row.brokerMs)}
                </span>
                {row.username && (
                  <span className="text-xs text-muted-foreground">@{row.username}</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {when(row.createdAt)}
                </span>
                {row.detail && (
                  <span className="w-full text-xs text-negative">{row.detail}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">Who did what</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Every account, newest first. Sign-ins, trades, approvals and the
          positions people opened.
        </p>
        {activity.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {activity.map((event, index) => (
              <li
                key={`${event.createdAt}-${index}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm"
              >
                <span className="font-medium">@{event.username}</span>
                <span className="text-muted-foreground">{event.kind.replace(/_/g, " ")}</span>
                {event.target && <span>{event.target}</span>}
                {event.detail && (
                  <span className="text-xs text-muted-foreground">{event.detail}</span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {when(event.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
