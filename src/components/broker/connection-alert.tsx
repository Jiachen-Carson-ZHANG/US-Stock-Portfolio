"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/local-time";

type Status = { status: string; lastRefreshAt: string | null; lastError: string | null } | null;

/**
 * Says so when the broker connection has stopped working.
 *
 * It broke on 5 October and the only sign was prices that quietly stopped
 * moving. Shown to the account's owner where they will see it, with the
 * reason moomoo gave and the one thing that fixes it.
 */
export function ConnectionAlert({
  connection,
  slug,
  locale,
  copy,
  withButton = false,
}: {
  connection: Status;
  slug: string;
  locale: "en" | "zh";
  copy: { brokenTitle: string; brokenBody: string; brokenReason: string; outageBody: string; reconnectNow: string };
  withButton?: boolean;
}) {
  if (!connection || connection.status === "connected") return null;

  if (connection.status !== "expired") {
    return (
      <p role="status" className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        {copy.outageBody}
      </p>
    );
  }

  const since = connection.lastRefreshAt ? formatDay(connection.lastRefreshAt, locale) : "";
  const reason = connection.lastError?.match(/\(([^)]+)\)/)?.[1] ?? connection.lastError;
  return (
    <section role="alert" className="flex gap-3 rounded-xl border border-negative/40 bg-negative/5 p-4">
      <AlertTriangle className="mt-0.5 size-5 shrink-0 text-negative" aria-hidden="true" />
      <div className="min-w-0 space-y-2">
        <p className="font-medium">{copy.brokenTitle}</p>
        <p className="text-sm text-muted-foreground">
          {copy.brokenBody.replace("{date}", since)}
          {reason ? ` ${copy.brokenReason.replace("{reason}", `“${reason}”`)}` : ""}
        </p>
        {withButton && (
          <Button asChild size="sm">
            <Link href={`/${slug}/connection`}>{copy.reconnectNow}</Link>
          </Button>
        )}
      </div>
    </section>
  );
}
