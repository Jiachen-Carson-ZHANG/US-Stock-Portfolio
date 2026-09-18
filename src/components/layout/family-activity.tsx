"use client";

import { useT } from "@/lib/i18n/context";
import type { AssetInterest, MemberActivity } from "@/lib/activity";

export function FamilyActivity({
  mostViewed,
  byMember,
}: {
  mostViewed: AssetInterest[];
  byMember: MemberActivity[];
}) {
  const t = useT();
  const busiest = mostViewed[0]?.views ?? 0;

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium">{t.settings.familyActivity}</h2>
      <p className="mt-1 mb-4 text-xs text-muted-foreground">
        {t.settings.familyActivityHint}
      </p>

      {mostViewed.length === 0 && byMember.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t.settings.noActivity}</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t.settings.mostViewed}
            </p>
            <ul className="space-y-1.5">
              {mostViewed.map((asset) => (
                <li key={asset.target} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 truncate font-medium">
                    {asset.target}
                  </span>
                  {/* Bar length is the only encoding here, so it carries the count. */}
                  <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${busiest ? (asset.views / busiest) * 100 : 0}%`,
                        background: "var(--chart-1)",
                      }}
                    />
                  </span>
                  <span className="tabular w-16 shrink-0 text-right text-xs text-muted-foreground">
                    {asset.views} {t.settings.views}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t.settings.accounts}
            </p>
            <ul className="divide-y divide-border">
              {byMember.map((member) => (
                <li key={member.username} className="py-2 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium capitalize">{member.username}</p>
                  <p className="text-xs text-muted-foreground">
                    {member.logins} {t.settings.logins} · {member.views}{" "}
                    {t.settings.views}
                    {member.lastSeen && (
                      <>
                        {" · "}
                        {t.settings.lastSeen}{" "}
                        {new Date(member.lastSeen).toLocaleString()}
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
