"use client";

import { useEffect } from "react";
import {
  looksLikeStaleCode,
  reloadOnceForStaleCode,
  reportClientError,
} from "@/lib/stale-code";

/**
 * What a reader sees when a page fails.
 *
 * The default is "A server error occurred. Reload to try again." — true, and
 * useless: it reads the same whether the database is unreachable, a token has
 * expired, or something is genuinely broken. Those have different answers,
 * and the person looking at the screen is usually the one who can fix it.
 *
 * Nothing here exposes a stack trace. `digest` is the id the platform's logs
 * are searchable by, which is the one thing worth carrying across.
 */
export default function ErrorScreen({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const message = error.message ?? "";

  // A tab left open across a deploy is the usual cause, and one reload is the
  // cure; retrying with the same stale code (React's reset) never works.
  useEffect(() => {
    reportClientError("root-boundary", error, error.digest);
    if (looksLikeStaleCode(error)) reloadOnceForStaleCode();
  }, [error]);

  const { title, body } = categorise(message);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 min-h-11 rounded-xl bg-foreground px-5 text-sm font-medium text-background"
        >
          Reload
        </button>

        {error.digest && (
          <p className="mt-6 text-xs text-muted-foreground">
            Reference <span className="tabular">{error.digest}</span>
          </p>
        )}
      </div>
    </main>
  );
}

function categorise(message: string): { title: string; body: string } {
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|database|DATABASE_URL|pg|pool/i.test(message)) {
    return {
      title: "Cannot reach the database",
      body: "This copy of the site is running, but it cannot talk to the database that holds the data. That is a configuration problem on the server, not anything you did — most often a missing or wrong DATABASE_URL on this deployment.",
    };
  }

  if (/token|refresh|unauthor|moomoo|broker/i.test(message)) {
    return {
      title: "The broker connection needs attention",
      body: "The page loaded but the brokerage link could not be used. Reconnecting the account from the connection screen usually settles it. Nothing has been lost.",
    };
  }

  if (/fetch|network|timeout|abort/i.test(message)) {
    return {
      title: "Something did not answer in time",
      body: "A service this page depends on took too long. It is usually momentary — try again in a few seconds.",
    };
  }

  return {
    title: "Something went wrong",
    body: "This page could not be built. It has been logged with the reference below. Trying again often works, since most of these are momentary.",
  };
}
