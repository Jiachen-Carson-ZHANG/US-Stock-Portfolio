import { Check, X } from "lucide-react";
import { getDb } from "@/lib/db";
import { readConnectionStatus } from "@/lib/moomoo/tokens";
import { requirePortfolio } from "@/lib/portfolios/context";
import { MoomooConnection, SyncButton } from "@/components/layout/settings-actions";
import { Badge } from "@/components/ui/misc";
import { serverDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * What to tick on moomoo's consent screen, and why.
 *
 * Shown as a checklist rather than prose because that screen is a list of
 * checkboxes: matching its shape means nobody has to translate a sentence
 * into clicks. The two refused permissions are listed too — leaving them
 * out invites "Select all", which this app rejects on return.
 */
export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ portfolio: string }>;
  searchParams: Promise<{ moomoo?: string }>;
}) {
  const { user, portfolio } = await requirePortfolio((await params).portfolio);
  const { t } = await serverDictionary();
  const owns = portfolio.ownerUserId === user.id;

  /**
   * What to tick on moomoo's consent screen, and why.
   *
   * Shown as a checklist rather than prose because that screen is a list of
   * checkboxes: matching its shape means nobody has to translate a sentence
   * into clicks. The two refused permissions are listed too — leaving them
   * out invites "Select all", which this app rejects on return.
   */
  const permissions = [
    { grant: true, name: t.connection.marketData, why: t.connection.marketDataWhy },
    { grant: true, name: t.connection.accountsOrders, why: t.connection.accountsOrdersWhy },
    { grant: false, name: t.connection.watchlists, why: t.connection.watchlistsWhy },
    { grant: false, name: t.connection.tradeExecution, why: t.connection.tradeExecutionWhy },
  ];

  const outcomes: Record<string, { tone: "ok" | "bad"; message: string }> = {
    connected: { tone: "ok", message: t.connection.outcomeConnected },
    connected_sync_failed: { tone: "bad", message: t.connection.outcomeSyncFailed },
    write_scope: { tone: "bad", message: t.connection.outcomeWriteScope },
    save_failed: { tone: "bad", message: t.connection.outcomeSaveFailed },
    state_mismatch: { tone: "bad", message: t.connection.outcomeStateMismatch },
    denied: { tone: "bad", message: t.connection.outcomeDenied },
    failed: { tone: "bad", message: t.connection.outcomeFailed },
  };
  const outcome = outcomes[(await searchParams).moomoo ?? ""];

  if (portfolio.kind !== "broker") {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">
          {portfolio.displayName} · {t.connection.title}
        </h1>
        <p className="text-sm text-muted-foreground">{t.connection.mockAccount}</p>
      </div>
    );
  }

  const connection = await readConnectionStatus(await getDb(), portfolio.id);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">
            {portfolio.displayName} · {t.connection.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t.connection.subtitle}</p>
        </div>
        <Badge>{connection ? connection.status : t.connection.notConnected}</Badge>
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
          {t.connection.notYours}
        </p>
      ) : (
        <>
          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-sm font-medium">{t.connection.tickThese}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.connection.dontSelectAll}
            </p>

            <ul className="mt-4 space-y-3">
              {permissions.map((permission) => (
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
                        {permission.grant ? t.connection.tick : t.connection.leaveUnticked}
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
              <h2 className="text-sm font-medium">{t.connection.thisConnection}</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t.connection.account}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {connection.accountId
                      ? `••••${connection.accountId.slice(-4)}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t.connection.permissionsHeld}</dt>
                  <dd className="mt-1 text-sm font-medium">{connection.scope || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t.connection.lastRefreshed}</dt>
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
            <h2 className="text-sm font-medium">{t.connection.privacyTitle}</h2>
            <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
              <li>
                <strong className="font-medium text-foreground">
                  {t.connection.privacyPassword}
                </strong>{" "}
                {t.connection.privacyPasswordBody}
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  {t.connection.privacyOperator}
                </strong>{" "}
                {t.connection.privacyOperatorBody}
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  {t.connection.privacyNoTrading}
                </strong>{" "}
                {t.connection.privacyNoTradingBody}
              </li>
              <li>
                {t.connection.privacyAi}
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  {t.connection.privacyRevoke}
                </strong>{" "}
                {t.connection.privacyRevokeBody}
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
