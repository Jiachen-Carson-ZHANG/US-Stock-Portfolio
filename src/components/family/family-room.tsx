"use client";
import { useState, useRef, type ReactNode, type FormEvent } from "react";
import Image from "next/image";
import { useLocale } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import type { FamilyState } from "@/lib/family/repository";
import { familyCopy } from "./dictionary";
const field =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
function Field({
  label,
  name,
  type = "text",
  required = true,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  defaultValue?: string;
}) {
  return (
    <label className="block space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      <input
        className={field}
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue}
        min={type === "number" ? "0.01" : undefined}
        step={type === "number" ? "any" : undefined}
        maxLength={type === "text" ? 2000 : undefined}
      />
    </label>
  );
}
export function FamilyRoom({
  initial,
  openAccess,
  symbol,
  postcard,
}: {
  initial: FamilyState;
  openAccess: boolean;
  symbol?: string;
  postcard: {
    currency: string;
    date: string;
    value: number;
    observations: number;
    points: { date: string; value: number }[];
  } | null;
}) {
  const locale = useLocale(),
    t = familyCopy[locale],
    [state, setState] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const pending = useRef(false);
  const [goalPhoto, setGoalPhoto] = useState("");
  const [photoLoading, setPhotoLoading] = useState(false);
  const money = (v: number, currency = "USD") =>
    new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
      style: "currency",
      currency,
    }).format(v);
  async function act(action: Record<string, unknown>) {
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? t.error);
      setState(data);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : t.error);
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function submit(
    e: FormEvent<HTMLFormElement>,
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    e.preventDefault();
    const form = e.currentTarget;
    const values: Record<string, unknown> = Object.fromEntries(
      new FormData(form),
    );
    for (const k of ["target", "amount", "quantity"])
      if (k in values) values[k] = Number(values[k]);
    for (const key of ["symbol", "reason"])
      if (values[key] === "") delete values[key];
    if (
      await act({
        action,
        ...values,
        ...extra,
        ...(action === "goal" && goalPhoto ? { imageData: goalPhoto } : {}),
      })
    ) {
      form.reset();
      if (action === "goal") setGoalPhoto("");
    }
  }
  async function refresh() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/family", { cache: "no-store" });
      if (!r.ok) throw new Error(t.error);
      setState(await r.json());
    } catch {
      setError(t.error);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const submitButton = (label: string) => (
    <Button type="submit" disabled={busy || photoLoading}>
      {busy ? t.busy : label}
    </Button>
  );
  const points = postcard?.points ?? [];
  const low = Math.min(...points.map((p) => p.value)),
    high = Math.max(...points.map((p) => p.value));
  const chartPoints = points
    .map(
      (p, i) =>
        `${10 + (i * 280) / Math.max(1, points.length - 1)},${65 - ((p.value - low) / Math.max(1, high - low)) * 50}`,
    )
    .join(" ");
  const c = state.challenge,
    m = c?.members.find((m) => m.userId === state.user.id),
    voted = state.nominations.some((n) => n.votes.includes(state.user.id));
  return (
    <div className="space-y-6">
      <header>
        <Button
          variant="outline"
          disabled={busy}
          onClick={refresh}
          className="float-right"
        >
          {t.refresh}
        </Button>
        <h1 className="text-xl font-semibold tracking-tight">{t.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.subtitle}</p>
        <p className="mt-3 text-xs text-muted-foreground">
          {t.identity}: {state.user.displayName}
        </p>
        {openAccess && (
          <p className="mt-2 max-w-3xl rounded-lg bg-muted p-3 text-sm">
            {t.open}
          </p>
        )}
      </header>
      {error && (
        <p
          role="alert"
          className="sticky top-2 z-10 rounded-lg border border-negative bg-surface p-3 text-sm text-negative"
        >
          {error}
        </p>
      )}
      <Section title={t.postcard}>
        {postcard && points.length > 1 && (
          <div>
            <p className="text-xs text-muted-foreground">
              {t.change} · {points[0].date} → {postcard.date}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {money(postcard.value - points[0].value, postcard.currency)}
            </p>
            <svg
              viewBox="0 0 300 80"
              className="mt-2 h-20 w-full text-accent"
              role="img"
              aria-label={t.trend}
            >
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                points={chartPoints}
              />
            </svg>
          </div>
        )}
        {postcard ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">{t.snapshot}</p>
              <p className="mt-1 text-lg font-semibold">
                {money(postcard.value, postcard.currency)}
              </p>
              <p className="text-xs text-muted-foreground">{postcard.date}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{t.observations}</p>
              <p className="mt-1 text-lg font-semibold">
                {postcard.observations}
              </p>
            </div>
            <p className="text-sm">{t.question}</p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t.snapshotEmpty}</p>
        )}
      </Section>
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Section title={t.discussion}>
            <form onSubmit={(e) => submit(e, "post")} className="space-y-3">
              <Field
                name="symbol"
                label={t.symbol}
                required={false}
                defaultValue={symbol}
              />
              <label className="block text-xs text-muted-foreground">
                {t.message}
                <textarea
                  className={`${field} mt-1`}
                  name="text"
                  rows={3}
                  maxLength={2000}
                  required
                />
              </label>
              {submitButton(t.post)}
            </form>
            {state.posts.some((p) => p.unread) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act({ action: "read" })}
              >
                {t.read}
              </Button>
            )}
            {state.posts.length === 0 && (
              <p className="text-sm text-muted-foreground">{t.empty}</p>
            )}
            {state.posts.map((p) => (
              <article
                key={p.id}
                className="space-y-3 border-t border-border pt-4"
              >
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span>{p.author}</span>
                  <time>{p.createdAt.slice(0, 10)}</time>
                  {p.symbol && (
                    <strong className="text-accent">{p.symbol}</strong>
                  )}
                  {p.unread && <span>{t.unread}</span>}
                </div>
                <p className="whitespace-pre-wrap break-words text-sm">
                  {p.text}
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["interesting", "explain", "discuss"] as const).map((r) => (
                    <button
                      key={r}
                      disabled={busy}
                      aria-pressed={p.reactions[state.user.id] === r}
                      onClick={() =>
                        act({ action: "react", id: p.id, reaction: r })
                      }
                      className={`min-h-11 rounded-full border px-3 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent sm:min-h-8 ${p.reactions[state.user.id] === r ? "border-accent text-accent" : "border-border"}`}
                    >
                      {t[r]} ·{" "}
                      {Object.values(p.reactions).filter((v) => v === r).length}
                    </button>
                  ))}
                </div>
                {p.replies.map((r) => (
                  <div
                    key={r.id}
                    className="ml-3 border-l-2 border-border pl-3"
                  >
                    <p className="text-xs text-muted-foreground">
                      {r.author} · {r.createdAt.slice(0, 10)}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm">
                      {r.text}
                    </p>
                  </div>
                ))}
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => submit(e, "reply", { id: p.id })}
                >
                  <div className="min-w-0 flex-1">
                    <Field name="text" label={t.reply} />
                  </div>
                  {submitButton(t.send)}
                </form>
                {(p.userId === state.user.id ||
                  state.user.role === "owner") && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(t.remove + "?"))
                        void act({ action: "deletePost", id: p.id });
                    }}
                  >
                    {t.remove}
                  </Button>
                )}
              </article>
            ))}
          </Section>
          <Section title={t.capsules}>
            <p className="text-xs text-muted-foreground">{t.immutable}</p>
            <form className="space-y-3" onSubmit={(e) => submit(e, "predict")}>
              <Field name="text" label={t.prediction} />
              <Field name="revealAt" type="date" label={t.reveal} />
              {submitButton(t.lock)}
            </form>
            {state.predictions.map((p) => (
              <article key={p.id} className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground">
                  {p.author} · {p.revealAt.slice(0, 10)}
                </p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {p.text ?? `${t.locked} ${p.revealAt.slice(0, 10)}`}
                </p>
              </article>
            ))}
          </Section>
        </div>
        <div className="space-y-6">
          <Section title={t.nominate}>
            <p className="text-xs text-muted-foreground">
              {t.once} {state.week} (UTC)
            </p>
            <form className="space-y-3" onSubmit={(e) => submit(e, "nominate")}>
              <Field name="symbol" label={t.ticker} />
              <Field name="text" label={t.nomination} />
              {submitButton(t.send)}
            </form>
            {state.nominations.map((n) => (
              <article
                key={n.id}
                className="flex gap-3 border-t border-border pt-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {n.symbol}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {n.author}
                    </span>
                  </p>
                  <p className="break-words text-sm">{n.text}</p>
                  <p className="mt-1 text-xs">
                    {n.votes.length} {t.votes}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={busy || voted}
                  onClick={() => act({ action: "vote", id: n.id })}
                >
                  {t.vote}
                </Button>
              </article>
            ))}
          </Section>
          <Section title={t.quiz}>
            <p className="text-sm text-muted-foreground">{t.learn}</p>
            {state.quiz ? (
              <>
                <p className="text-lg font-semibold">
                  {t.score}: {state.quiz.score}/3
                </p>
                <p className="text-xs text-muted-foreground">{t.quizDone}</p>
                {t.explanations.map((e, i) => (
                  <p key={e} className="text-sm">
                    {i + 1}. {e}
                  </p>
                ))}
              </>
            ) : (
              <form
                className="space-y-5"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  await act({
                    action: "quiz",
                    answers: [0, 1, 2].map((i) => Number(f.get(`q${i}`))),
                  });
                }}
              >
                {t.questions.map((q, i) => (
                  <fieldset key={q} className="space-y-2">
                    <legend className="mb-2 text-sm font-medium">
                      {i + 1}. {q}
                    </legend>
                    {t.options[i].map((o, j) => (
                      <label key={o} className="flex gap-2 text-sm">
                        <input required type="radio" name={`q${i}`} value={j} />
                        {o}
                      </label>
                    ))}
                  </fieldset>
                ))}
                {submitButton(t.submit)}
              </form>
            )}
          </Section>
          <Section title={t.goals}>
            <p className="text-xs text-muted-foreground">{t.separate}</p>
            <form className="space-y-3" onSubmit={(e) => submit(e, "goal")}>
              <Field name="text" label={t.goal} />
              <Field name="target" type="number" label={t.target} />
              <label className="block space-y-1 text-xs text-muted-foreground">
                <span>{t.photo}</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className={field}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    setGoalPhoto("");
                    setPhotoLoading(false);
                    if (!file) return;
                    if (
                      file.size > 350000 ||
                      !["image/png", "image/jpeg", "image/webp"].includes(
                        file.type,
                      )
                    ) {
                      setError(t.photo);
                      event.target.value = "";
                      return;
                    }
                    const reader = new FileReader();
                    setPhotoLoading(true);
                    reader.onload = () => {
                      setGoalPhoto(String(reader.result));
                      setPhotoLoading(false);
                    };
                    reader.onerror = () => {
                      setError(t.error);
                      setPhotoLoading(false);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {submitButton(t.create)}
            </form>
            {state.goals.map((g) => (
              <article
                key={g.id}
                className="space-y-3 border-t border-border pt-4"
              >
                {g.imageData && (
                  <Image
                    src={g.imageData}
                    alt={g.text}
                    width={640}
                    height={320}
                    unoptimized
                    referrerPolicy="no-referrer"
                    className="h-36 w-full rounded-lg object-cover"
                  />
                )}
                <p className="font-medium">{g.text}</p>
                {g.saved >= g.target && (
                  <p className="text-sm font-medium text-accent">
                    {t.milestone}
                  </p>
                )}
                <p className="text-sm">
                  {money(g.saved)} / {money(g.target)} {t.saved}
                </p>
                <progress
                  className="h-2 w-full accent-accent"
                  max={g.target}
                  value={Math.min(g.saved, g.target)}
                  aria-label={g.text}
                />
                <form
                  className="flex items-end gap-2"
                  onSubmit={(e) => submit(e, "contribute", { id: g.id })}
                >
                  <div className="min-w-0 flex-1">
                    <Field name="amount" type="number" label={t.amount} />
                  </div>
                  {submitButton(t.contribute)}
                </form>
                <details className="text-xs">
                  <summary className="cursor-pointer">
                    {t.ledger} ({g.contributions.length})
                  </summary>
                  {g.contributions.map((x) => (
                    <p key={x.id} className="mt-2">
                      {x.author} · {money(x.amount)} ·{" "}
                      {x.createdAt.slice(0, 10)}
                    </p>
                  ))}
                </details>
              </article>
            ))}
          </Section>
        </div>
      </div>
      <Section title={t.challenge}>
        <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">
          {t.paper}
        </p>
        {(!c || c.ended) && state.user.role === "owner" && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => submit(e, "challenge")}
          >
            <Field name="text" label={t.challengeName} />
            <Field name="endsAt" type="date" label={t.ends} />
            {submitButton(t.start)}
          </form>
        )}
        {!c && <p className="text-sm text-muted-foreground">{t.none}</p>}
        {c && (
          <>
            <h3 className="font-medium">{c.text}</h3>
            <p className="text-sm text-accent">
              {c.mode === "demo" ? t.demo : t.live}
            </p>
            {!c.ended && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => act({ action: "mark" })}
              >
                {t.mark}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {c.ended ? t.ended : t.active} · {c.endsAt.slice(0, 10)}
            </p>
            {!m && !c.ended && (
              <Button disabled={busy} onClick={() => act({ action: "join" })}>
                {t.join}
              </Button>
            )}
            {m && !c.ended && (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(e) => submit(e, "trade")}
              >
                <Field name="symbol" label={t.ticker} />
                <Field name="quantity" type="number" label={t.quantity} />
                <Field name="reason" label={t.rationale} required={false} />
                <label className="space-y-1 text-xs">
                  <span className="block">{t.trade}</span>
                  <select className={field} name="side">
                    <option value="buy">{t.buy}</option>
                    <option value="sell">{t.sell}</option>
                  </select>
                </label>
                {submitButton(t.trade)}
              </form>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {[t.identity, t.cash, t.value, t.return, t.drawdown].map(
                      (h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-3 py-2 font-medium"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {c.members.map((m) => (
                    <tr key={m.userId} className="border-b border-border">
                      <td className="px-3 py-3">{m.author}</td>
                      <td className="px-3">{money(m.cash)}</td>
                      <td className="px-3">{money(m.value)}</td>
                      <td className="px-3">{m.returnPercent.toFixed(2)}%</td>
                      <td className="px-3">{m.observedDrawdown.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.entries(c.prices).map(([s, p]) => (
              <p key={s} className="text-xs text-muted-foreground">
                {s}: {money(p.price)} · {p.at} · {p.source}
              </p>
            ))}
            {m && (
              <>
                <details>
                  <summary className="cursor-pointer text-sm">
                    {t.holdings}
                  </summary>
                  {Object.entries(m.holdings).map(([s, q]) => (
                    <p key={s} className="mt-2 text-xs">
                      {s}: {q}
                    </p>
                  ))}
                </details>
                <details>
                  <summary className="cursor-pointer text-sm">
                    {t.trades}
                  </summary>
                  {m.trades.map((x, i) => (
                    <p key={i} className="mt-2 text-xs">
                      {x.reason && <span className="block">{x.reason}</span>}
                      {x.at} · {x.side === "buy" ? t.buy : t.sell} {x.quantity}{" "}
                      {x.symbol} @ {money(x.price)}
                    </p>
                  ))}
                </details>
              </>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
