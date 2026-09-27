"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Lock, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/context";

export type ArenaAccount = { slug: string; name: string; kind: "broker" | "mock"; joined: boolean };

/**
 * Entering the Arena, account by account.
 *
 * Nobody is ranked without saying yes, and nobody sees the ranking without
 * having said yes themselves. Until then the board is drawn with every row
 * hidden, so it is clear there is something there and what it costs to see it.
 */
export function ArenaMembership({
  accounts,
  competing,
  locked,
}: {
  /** The viewer's own accounts. */
  accounts: ArenaAccount[];
  /** How many accounts are in, all told. */
  competing: number;
  /** True while none of the viewer's accounts is in. */
  locked: boolean;
}) {
  const zh = useLocale() === "zh";
  const say = (en: string, cn: string) => (zh ? cn : en);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(slug: string, join: boolean) {
    setBusy(slug);
    setError(null);
    const response = await fetch("/api/arena/membership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolio: slug, join }),
    }).catch(() => null);
    setBusy(null);
    if (!response?.ok) {
      setError(say("That did not go through. Please try again.", "没有成功，请再试一次。"));
      return;
    }
    router.refresh();
  }

  return (
    <section className="space-y-5 rounded-xl border border-border bg-surface p-5">
      {locked && (
        <div>
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-base font-semibold">
              {competing === 0
                ? say("Nobody has entered the Arena yet", "还没有人加入竞技场")
                : say(
                    `${competing} ${competing === 1 ? "account is" : "accounts are"} competing`,
                    `已有 ${competing} 个账户参赛`,
                  )}
            </h2>
          </div>
          <ul className="mt-4 space-y-2" aria-hidden="true">
            {Array.from({ length: Math.min(Math.max(competing, 2), 5) }, (_, index) => (
              <li key={index} className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
                <span className="tabular w-5 text-sm text-muted-foreground">{index + 1}</span>
                <span className="h-3 w-28 rounded bg-muted blur-[1px]" />
                <span className="ml-auto h-3 w-14 rounded bg-muted blur-[1px]" />
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            {say(
              "The standings stay hidden until you enter an account of your own. Everyone who takes part sees the others, and nobody else does.",
              "在你让自己的账户参赛之前，排名对你是隐藏的。参赛的人彼此可见，其他人都看不到。",
            )}
          </p>
        </div>
      )}

      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Trophy className="size-4 text-muted-foreground" aria-hidden="true" />
          {say("Your accounts in the Arena", "你的账户与竞技场")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {say(
            "Entering an account shows the other members how it has done in percentages and what it holds as shares of the whole, but never how much money is in it. You can take it out again whenever you like.",
            "参赛后，其他参赛者能看到这个账户按百分比计算的表现，以及每只持仓占整个账户的比例，但永远看不到账户里有多少钱。你可以随时退出。",
          )}
        </p>
        {accounts.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            {say("You have no account of your own to enter yet.", "你还没有可以参赛的账户。")}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
            {accounts.map((account) => (
              <li key={account.slug} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{account.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {account.kind === "mock" ? say("Practice account", "模拟账户") : say("Real account", "真实账户")}
                    {" · "}
                    {account.joined ? say("Competing", "参赛中") : say("Not entered", "未参赛")}
                  </p>
                </div>
                <Button
                  variant={account.joined ? "outline" : "primary"}
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void choose(account.slug, !account.joined)}
                >
                  {busy === account.slug
                    ? say("Saving…", "保存中…")
                    : account.joined
                      ? say("Take it out", "退出竞技场")
                      : say("Enter this account", "让它参赛")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="mt-3 text-sm text-negative">{error}</p>}
      </div>
    </section>
  );
}
