import Link from "next/link";
import { Lock } from "lucide-react";
import { requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { directoryFor } from "@/lib/portfolios";
import { serverDictionary } from "@/lib/i18n/server";
import { Badge } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

/**
 * The directory.
 *
 * Shows every portfolio on the site, including the ones this person cannot
 * open — a locked row with a name is how somebody learns there is something
 * worth asking for. It carries a name, an owner and a flag; no holding, no
 * value and no return, because those are what the access rule protects.
 */
export default async function PortfolioDirectoryPage() {
  const user = await requireUser();
  const { t } = await serverDictionary();
  const entries = await directoryFor(await getDb(), user);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t.directory.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.directory.subtitle}</p>
      </header>

      <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
        {entries.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {!entry.readable && (
                  <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
                )}
                {entry.displayName}
                {entry.kind === "mock" && <Badge>{t.portfolios.mock}</Badge>}
                {entry.ownerUserId === user.id && <Badge>{t.directory.yours}</Badge>}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {entry.readable ? `/${entry.slug}` : t.directory.locked} ·{" "}
                {t.directory.ownedBy} {entry.ownerName ?? t.directory.nobody}
              </p>
            </div>

            {entry.readable ? (
              <Link
                href={`/${entry.slug}`}
                className="min-h-9 rounded-lg border border-border px-3 text-sm leading-9 transition-colors hover:bg-muted"
              >
                {t.directory.open}
              </Link>
            ) : entry.requested ? (
              <span className="text-xs text-muted-foreground">
                {t.directory.askedAlready}
              </span>
            ) : (
              <Link
                href={`/request-access/${entry.slug}`}
                className="min-h-9 rounded-lg border border-border px-3 text-sm leading-9 transition-colors hover:bg-muted"
              >
                {t.directory.ask}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
