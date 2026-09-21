"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useT } from "@/lib/i18n/context";
import { formatMoney } from "@/lib/money";

/**
 * Recording money paid into the account.
 *
 * This is the one fact the app cannot work out for itself. The broker's API
 * returns trades, never transfers, so a deposit that nobody records looks
 * exactly like a gain of the same size — and it moves every return figure on
 * every page. Hence a control on the dashboard rather than a settings field.
 */
export function AddDeposit({
  portfolioSlug,
  currency,
}: {
  portfolioSlug: string;
  currency: string;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = Number(data.get("amount"));
    const withdrawal = data.get("direction") === "out";

    if (!Number.isFinite(amount) || amount === 0) {
      setError(t.transfers.enterAmount);
      return;
    }

    setBusy(true);
    setError(null);
    const response = await fetch(
      `/api/analysis?portfolio=${encodeURIComponent(portfolioSlug)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "flow",
          date: String(data.get("date") ?? ""),
          amount: withdrawal ? -Math.abs(amount) : Math.abs(amount),
          note: String(data.get("note") ?? "") || t.transfers.bankTransfer,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? t.transfers.failed);
      return;
    }
    form.reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        {t.transfers.record}
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-md space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <p className="text-sm font-medium">{t.transfers.title}</p>
      <p className="text-xs text-muted-foreground">
        {t.transfers.note}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="deposit-date" className="text-xs text-muted-foreground">
            {t.transfers.date}
          </Label>
          <Input
            id="deposit-date"
            name="date"
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deposit-amount" className="text-xs text-muted-foreground">
            {t.transfers.amount} ({currency})
          </Label>
          <Input
            id="deposit-amount"
            name="amount"
            inputMode="decimal"
            placeholder="2000"
            required
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deposit-direction" className="text-xs text-muted-foreground">
          {t.transfers.direction}
        </Label>
        <select
          id="deposit-direction"
          name="direction"
          className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
        >
          <option value="in">{t.transfers.paidIn}</option>
          <option value="out">{t.transfers.withdrawn}</option>
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="deposit-note" className="text-xs text-muted-foreground">
          {t.transfers.noteLabel}
        </Label>
        <Input id="deposit-note" name="note" placeholder={t.transfers.bankTransfer} />
      </div>

      {error && (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t.transfers.recording : t.transfers.submit}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t.common.cancel}
        </Button>
      </div>
    </form>
  );
}

/**
 * Warns when cash cannot be explained by the trades and transfers on record.
 *
 * A large unexplained residual almost always means money moved and nobody
 * said so. Dividends, interest and fees also land here, which is why the
 * threshold is well above their usual size rather than zero.
 */
export function ReconciliationBanner({
  residual,
  currency,
  threshold = 200,
}: {
  residual: number;
  currency: string;
  threshold?: number;
}) {
  const t = useT();
  if (Math.abs(residual) < threshold) return null;

  const amount = formatMoney({ amount: String(Math.abs(residual)), currency });

  return (
    <p
      role="status"
      className="rounded-lg border border-chart-4/40 bg-chart-4/5 px-4 py-3 text-sm"
    >
      <strong className="font-medium">{amount}</strong> {t.transfers.unexplained}
      {residual > 0
        ? ` — ${t.transfers.moreThanExpected}. `
        : ` — ${t.transfers.lessThanExpected}. `}
      {t.transfers.unexplainedHint}
    </p>
  );
}
