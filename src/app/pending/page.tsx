import { redirect } from "next/navigation";
import { Clock, X } from "lucide-react";
import { getSessionUser, isOpenAccess } from "@/lib/auth/guards";
import { serverDictionary } from "@/lib/i18n/server";
import { LocaleProvider } from "@/lib/i18n/context";
import { BrandMark } from "@/components/layout/brand-mark";
import { LanguageToggle, SignOutButton } from "@/components/layout/nav";

export const dynamic = "force-dynamic";

/**
 * Where an account waits.
 *
 * Deliberately outside the app layout: that layout calls requireUser, which
 * sends a pending account here, so rendering this inside it would loop. It
 * also means the nav, the portfolio switcher and the notification bell are
 * simply absent rather than present-and-empty.
 */
export default async function PendingPage() {
  if (isOpenAccess()) redirect("/");

  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.status === "active") redirect("/");

  const { locale, t } = await serverDictionary();
  const declined = user.status === "declined";

  return (
    <LocaleProvider locale={locale}>
      <main className="auth-field flex min-h-dvh flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-[26rem]">
          <div className="mb-8 flex flex-col items-center text-center">
            <BrandMark className="size-12" />
            <div
              className={`mt-5 flex size-10 items-center justify-center rounded-full ${
                declined ? "bg-muted" : "bg-chart-4/15"
              }`}
            >
              {declined ? (
                <X className="size-5 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Clock className="size-5 text-chart-4" aria-hidden="true" />
              )}
            </div>
            <h1 className="mt-4 text-[1.375rem] font-semibold tracking-tight">
              {declined ? t.pending.declinedTitle : t.pending.title}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {declined ? t.pending.declinedBody : t.pending.body}
            </p>
          </div>

          {!declined && (
            <div className="elevated rounded-2xl border border-border bg-surface p-6">
              <p className="text-sm font-medium">{t.pending.whatNext}</p>
              <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li>{t.pending.step1}</li>
                <li>{t.pending.step2}</li>
                <li>{t.pending.step3}</li>
              </ul>
              <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
                {t.pending.signedInAs} <strong className="font-medium">@{user.username}</strong>
              </p>
            </div>
          )}

          <div className="mt-6 flex items-center justify-between gap-3">
            <LanguageToggle />
            <SignOutButton className="w-auto px-3 py-1.5 text-sm" />
          </div>
        </div>
      </main>
    </LocaleProvider>
  );
}
