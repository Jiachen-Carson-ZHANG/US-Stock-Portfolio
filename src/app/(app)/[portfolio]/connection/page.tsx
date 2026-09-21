import { Check, X } from "lucide-react";
import { getDb } from "@/lib/db";
import { readConnectionStatus } from "@/lib/moomoo/tokens";
import { requirePortfolio } from "@/lib/portfolios/context";
import { MoomooConnection, SyncButton } from "@/components/layout/settings-actions";
import { Badge } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

/**
 * What to tick on moomoo's consent screen, and why.
 *
 * Shown as a checklist rather than prose because that screen is a list of
 * checkboxes: matching its shape means nobody has to translate a sentence
 * into clicks. The two refused permissions are listed too — leaving them
 * out invites "Select all", which this app rejects on return.
 */
const PERMISSIONS = [
  {
    grant: true,
    name: "Market Data",
    why: "Prices, so your holdings are worth what they are worth today.",
  },
  {
    grant: true,
    name: "Accounts & Orders",
    why: "What you hold and what you have traded. Read-only — it cannot place an order.",
  },
  {
    grant: false,
    name: "Watchlists",
    why: "Would let this app edit the watchlist inside moomoo. It keeps its own instead.",
  },
  {
    grant: false,
    name: "Trade Execution",
    why: "Would let this app buy and sell. It never needs to, so it refuses the permission.",
  },
];

const OUTCOME: Record<string, { tone: "ok" | "bad"; message: string }> = {
  connected: { tone: "ok", message: "Connected. Your holdings are loading." },
  connected_sync_failed: {
    tone: "bad",
    message:
      "Connected, but the first sync did not complete. Press “Sync holdings now”.",
  },
  write_scope: {
    tone: "bad",
    message:
      "That grant included a permission this app refuses to hold, so nothing was saved. Tick only Market Data and Accounts & Orders.",
  },
  save_failed: {
    tone: "bad",
    message:
      "moomoo approved the connection but this app could not store it. Nothing is wrong with your permissions — try again, and if it repeats it is a bug here.",
  },
  state_mismatch: {
    tone: "bad",
    message: "The connection could not be verified. Start it again from this page.",
  },
  denied: { tone: "bad", message: "You cancelled on moomoo's screen. Nothing changed." },
  failed: { tone: "bad", message: "The connection did not complete. Try again." },
};

export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ portfolio: string }>;
  searchParams: Promise<{ moomoo?: string }>;
}) {
  const { user, portfolio } = await requirePortfolio((await params).portfolio);
  const owns = portfolio.ownerUserId === user.id;
  const outcome = OUTCOME[(await searchParams).moomoo ?? ""];

  if (portfolio.kind !== "broker") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">
          {portfolio.displayName} · Broker connection
        </h1>
        <p className="text-sm text-muted-foreground">
          This is a mock account. It trades practice money at real prices, so
          there is no brokerage to connect.
        </p>
      </div>
    );
  }

  const connection = await readConnectionStatus(await getDb(), portfolio.id);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {portfolio.displayName} · Broker connection
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Links this portfolio to a moomoo account so holdings load by
            themselves.
          </p>
        </div>
        <Badge>{connection ? connection.status : "not connected"}</Badge>
      </header>

      {outcome && (
        <p
          role="status"
          className={`rounded-lg border px-4 py-3 text-sm ${
            outcome.tone === "ok"
              ? "border-positive/30 bg-positive/5 text-positive"
              : "border-negative/30 bg-negative/5 text-negative"
          }`}
        >
          {outcome.message}
        </p>
      )}

      {!owns ? (
        <p className="rounded-xl border border-border bg-surface p-5 text-sm text-muted-foreground">
          Only {portfolio.displayName}&rsquo;s own account can connect or
          disconnect a brokerage here.
        </p>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-medium">On moomoo&rsquo;s screen, tick these two</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Do not use &ldquo;Select all&rdquo;. A grant with anything else
              in it is refused on the way back and nothing is saved.
            </p>

            <ul className="mt-4 space-y-3">
              {PERMISSIONS.map((permission) => (
                <li key={permission.name} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded ${
                      permission.grant
                        ? "bg-positive/15 text-positive"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {permission.grant ? (
                      <Check className="size-3.5" />
                    ) : (
                      <X className="size-3.5" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {permission.name}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {permission.grant ? "tick" : "leave unticked"}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">{permission.why}</p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="mt-5">
              <MoomooConnection
                connected={connection !== null}
                portfolioSlug={portfolio.slug}
              />
            </div>
          </section>

          {connection && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-sm font-medium">This connection</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">Account</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {connection.accountId
                      ? `••••${connection.accountId.slice(-4)}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Permissions held</dt>
                  <dd className="mt-1 text-sm font-medium">{connection.scope || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Last refreshed</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {connection.lastRefreshAt
                      ? new Date(connection.lastRefreshAt).toLocaleString()
                      : "—"}
                  </dd>
                </div>
              </dl>
              <div className="mt-5">
                <SyncButton portfolioSlug={portfolio.slug} />
              </div>
            </section>
          )}

          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-medium">What this means for your privacy</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <strong className="font-medium text-foreground">
                  Your moomoo password never reaches this app.
                </strong>{" "}
                You sign in on moomoo&rsquo;s own page and it hands back a
                key that only reads.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  Whoever runs this server can read your portfolio.
                </strong>{" "}
                The key is encrypted in the database, but the encryption key
                lives on the server. There is no arrangement where the app
                can refresh your holdings while you are away and the operator
                cannot look.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  It can never trade.
                </strong>{" "}
                Trade Execution is refused at the door, so the worst case is
                someone seeing what you hold, not moving it.
              </li>
              <li>
                AI commentary sends your holdings and percentages to the
                configured AI provider. Arena news search sends ticker names
                to Tavily, and only when a key is set.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  You can end it at any time.
                </strong>{" "}
                Disconnect below removes the stored key; imported history
                stays. To be certain, also revoke this app inside moomoo —
                that works whether or not you trust this page.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
