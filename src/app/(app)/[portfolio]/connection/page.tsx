import { getDb } from "@/lib/db";
import { readConnectionStatus } from "@/lib/moomoo/tokens";
import { requirePortfolio } from "@/lib/portfolios/context";
import { MoomooConnection, SyncButton } from "@/components/layout/settings-actions";
import { OwnBrokerageButton } from "@/components/broker/own-brokerage";
import { Badge } from "@/components/ui/misc";
import { serverDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Connecting a portfolio to its moomoo account. The checklist of what to
 * tick on moomoo's screen comes with the Connect button (MoomooConnection),
 * so it is the same here and in Settings.
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

  const outcomes: Record<string, { tone: "ok" | "bad"; message: string }> = {
    connected: { tone: "ok", message: t.connection.outcomeConnected },
    connected_sync_failed: { tone: "bad", message: t.connection.outcomeSyncFailed },
    write_scope: { tone: "bad", message: t.connection.outcomeWriteScope },
    missing_scope: { tone: "bad", message: t.connection.outcomeMissingScope },
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
        {/* The page a practice account's owner lands on when they go looking
            for "connect". It used to end at "there is nothing to connect",
            which left them with no way forward at all. */}
        {owns && (
          <section className="space-y-3 rounded-xl border border-border bg-surface p-5">
            <p className="text-sm">{t.connection.mockSetUp}</p>
            <OwnBrokerageButton />
          </section>
        )}
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
            <MoomooConnection
              connected={connection !== null}
              portfolioSlug={portfolio.slug}
            />
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
