"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { useT } from "@/lib/i18n/context";

/**
 * Buying and selling in a mock portfolio.
 *
 * Every rule that matters — enough cash, whole shares, a price no more than
 * fifteen minutes old — is enforced on the server. This form only decides
 * what is comfortable to type.
 */
export function MockTrade({ portfolioSlug }: { portfolioSlug: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(
    null,
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setBusy(true);
    setMessage(null);
    const response = await fetch(
      `/api/mock/trade?portfolio=${encodeURIComponent(portfolioSlug)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          side: String(data.get("side") ?? "buy"),
          symbol: String(data.get("symbol") ?? "").toUpperCase(),
          quantity: Number(data.get("quantity") ?? 0),
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setMessage({ tone: "bad", text: body.error ?? t.mockTrade.failed });
      return;
    }

    form.reset();
    setMessage({
      tone: "ok",
      text: `${t.mockTrade.filledAt} ${body.price} · ${t.mockTrade.cashNow} ${body.cash}`,
    });
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        {t.mockTrade.trade}
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-md space-y-3 rounded-xl border border-border bg-surface p-4"
    >
      <p className="text-sm font-medium">{t.mockTrade.title}</p>
      <p className="text-xs text-muted-foreground">
        {t.mockTrade.note}
      </p>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="trade-side" className="text-xs text-muted-foreground">
            {t.mockTrade.side}
          </Label>
          <select
            id="trade-side"
            name="side"
            className="min-h-11 w-full rounded-xl border border-border bg-background px-2 text-base"
          >
            <option value="buy">{t.mockTrade.buy}</option>
            <option value="sell">{t.mockTrade.sell}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trade-symbol" className="text-xs text-muted-foreground">
            {t.mockTrade.symbol}
          </Label>
          <Input
            id="trade-symbol"
            name="symbol"
            placeholder="NVDA"
            autoCapitalize="characters"
            autoCorrect="off"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="trade-quantity" className="text-xs text-muted-foreground">
            {t.mockTrade.shares}
          </Label>
          <Input
            id="trade-quantity"
            name="quantity"
            inputMode="numeric"
            placeholder="10"
            required
          />
        </div>
      </div>

      {message && (
        <p
          role="status"
          className={`text-sm ${message.tone === "ok" ? "text-positive" : "text-negative"}`}
        >
          {message.text}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? t.mockTrade.placing : t.mockTrade.place}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          {t.mockTrade.close}
        </Button>
      </div>
    </form>
  );
}
