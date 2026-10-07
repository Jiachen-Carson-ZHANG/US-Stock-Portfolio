import { Eye, KeyRound, PlugZap, Unplug, Users } from "lucide-react";
import { getDb } from "@/lib/db";
import { readConnectionStatus } from "@/lib/moomoo/tokens";
import { requirePortfolio } from "@/lib/portfolios/context";
import { MoomooConnection, SyncButton } from "@/components/layout/settings-actions";
import { OwnBrokerageButton } from "@/components/broker/own-brokerage";
import { Badge } from "@/components/ui/misc";
import { Clock } from "@/components/ui/clock";
import { ConnectionAlert } from "@/components/broker/connection-alert";
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
  const { t, locale } = await serverDictionary();
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
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {connection ? t.connection.headingConnected : t.connection.headingConnect}
          </h1>
          <Badge>{connection ? connection.status : t.connection.notConnected}</Badge>
        </div>
        <p className="max-w-2xl text-sm text-muted-foreground">{t.connection.subtitle}</p>
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

      {owns && (
        <ConnectionAlert connection={connection} slug={portfolio.slug} locale={locale} copy={t.connection} />
      )}

      {!owns ? (
        <p className="rounded-xl border border-border bg-surface p-5 text-sm text-muted-foreground">
          {t.connection.notYours}
        </p>
      ) : (
        <>
          {connection && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <PlugZap className="size-4 text-positive" aria-hidden="true" />
                {t.connection.thisConnection}
              </h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-muted-foreground">{t.connection.account}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {connection.accountId ? `••••${connection.accountId.slice(-4)}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t.connection.permissionsHeld}</dt>
                  <dd className="mt-1 text-sm font-medium">{connection.scope || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t.connection.lastRefreshed}</dt>
                  <dd className="mt-1 text-sm font-medium">
                    {connection.lastRefreshAt ? <Clock iso={connection.lastRefreshAt} /> : "—"}
                  </dd>
                </div>
              </dl>
              <div className="mt-5">
                <SyncButton portfolioSlug={portfolio.slug} />
              </div>
            </section>
          )}

          {!connection && (
            <section className="rounded-xl border border-border bg-surface p-5">
              <h2 className="text-base font-semibold">{t.connection.howTitle}</h2>
              <ol className="mt-4 grid gap-3 sm:grid-cols-3">
                {[t.connection.howStep1, t.connection.howStep2, t.connection.howStep3].map((step, index) => (
                  <li key={step} className="flex gap-3 rounded-lg bg-muted/40 p-3 text-sm">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-medium text-background">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* The checklist is always open, reconnecting included: it is the
              one thing to get right on moomoo's screen, and a folded list
              was the part people skipped. */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-base font-semibold">
              {connection ? t.connection.reconnectChecklist : t.connection.connectCardTitle}
            </h2>
            {!connection && <p className="mt-1 text-sm text-muted-foreground">{t.connection.connectLead}</p>}
            <div className="mt-4">
              <MoomooConnection connected={connection !== null} portfolioSlug={portfolio.slug} />
            </div>
          </section>

          {/* What connecting means, in the order people ask it: where the key
              is, who can see the account, what the key can do, and how to
              undo it. Including the uncomfortable part, that whoever runs the
              server could in principle change it to read the key, because an
              assurance that leaves that out is not one worth giving. */}
          <section className="rounded-xl border border-border bg-surface p-5">
            <h2 className="text-base font-semibold">{t.connection.trustTitle}</h2>
            <ul className="mt-4 space-y-4">
              {[
                { icon: KeyRound, title: t.connection.trustKey, body: t.connection.trustKeyBody },
                { icon: Users, title: t.connection.trustVisible, body: t.connection.trustVisibleBody },
                { icon: Eye, title: t.connection.trustOwner, body: t.connection.trustOwnerBody },
                { icon: Unplug, title: t.connection.trustControl, body: t.connection.trustControlBody },
              ].map((item) => (
                <li key={item.title} className="flex gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <item.icon className="size-4 text-muted-foreground" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{item.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
