"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/field";
import { Badge } from "@/components/ui/misc";

export type AdminPerson = { id: string; displayName: string; username: string };

export type AdminPortfolio = {
  id: string;
  slug: string;
  displayName: string;
  ownerUserId: string | null;
  kind: "broker" | "mock";
  readers: string[];
};

/**
 * Creating a portfolio and choosing who may read it.
 *
 * Both are administrative. Note what is deliberately absent: no way to set
 * someone's password, and no way to read their broker token. An owner
 * decides who exists and who may look; they do not get to be that person.
 */
export function PortfolioAdmin({
  portfolios,
  people,
}: {
  portfolios: AdminPortfolio[];
  people: AdminPerson[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"broker" | "mock">("broker");
  const [ownerId, setOwnerId] = useState(people[0]?.id ?? "");
  const [slug, setSlug] = useState("");
  const [touchedSlug, setTouchedSlug] = useState(false);

  // The address follows the person's username unless they ask for something
  // else — Mile wanted /mirat. A mock account says so in the address, because
  // a link that looks like a real portfolio and is not would be confusing in
  // exactly the place it matters.
  const suggested = (() => {
    const username = people.find((p) => p.id === ownerId)?.username ?? "";
    if (!username) return "";
    return kind === "mock" ? `${username}-mock` : username;
  })();
  const address = touchedSlug ? slug : suggested;

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);

    setBusy(true);
    setError(null);
    const response = await fetch("/api/portfolios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: address,
        displayName: String(data.get("displayName") ?? ""),
        ownerUserId: String(data.get("ownerUserId") ?? ""),
        kind,
        openingCash: kind === "mock" ? String(data.get("openingCash") ?? "") : undefined,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(body.error ?? "Could not create the portfolio.");
      return;
    }
    form.reset();
    setTouchedSlug(false);
    setSlug("");
    router.refresh();
  }

  async function setAccess(portfolioId: string, userId: string, grant: boolean) {
    setBusy(true);
    await fetch("/api/portfolios", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolioId, userId, grant }),
    });
    setBusy(false);
    router.refresh();
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-5">
      <h2 className="text-sm font-medium">Portfolios</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        A person sees a portfolio if they own it or if it is ticked for them
        here. Owners see everything regardless.
      </p>

      <ul className="mt-4 divide-y divide-border">
        {portfolios.map((portfolio) => {
          const owner = people.find((p) => p.id === portfolio.ownerUserId);
          return (
            <li key={portfolio.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">
                  /{portfolio.slug}{" "}
                  <span className="font-normal text-muted-foreground">
                    {portfolio.displayName}
                  </span>
                </p>
                <Badge>{portfolio.kind}</Badge>
                <span className="text-xs text-muted-foreground">
                  owner: {owner?.displayName ?? "unassigned"}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {people
                  .filter((person) => person.id !== portfolio.ownerUserId)
                  .map((person) => (
                    <label
                      key={person.id}
                      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
                    >
                      <input
                        type="checkbox"
                        className="size-3.5"
                        disabled={busy}
                        checked={portfolio.readers.includes(person.id)}
                        onChange={(event) =>
                          setAccess(portfolio.id, person.id, event.target.checked)
                        }
                      />
                      {person.displayName}
                    </label>
                  ))}
              </div>
            </li>
          );
        })}
      </ul>

      <form onSubmit={create} className="mt-6 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="slug" className="text-xs text-muted-foreground">
            Address
          </Label>
          <Input
            id="slug"
            name="slug"
            value={address}
            onChange={(event) => {
              setTouchedSlug(true);
              setSlug(event.target.value);
            }}
            placeholder="mirat"
            required
          />
          <p className="text-xs text-muted-foreground">
            Their page will be at <code>/{address || "…"}</code>. Follows the
            username unless you change it.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="displayName" className="text-xs text-muted-foreground">
            Name
          </Label>
          <Input id="displayName" name="displayName" placeholder="Mile" required />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ownerUserId" className="text-xs text-muted-foreground">
            Belongs to
          </Label>
          <select
            id="ownerUserId"
            name="ownerUserId"
            required
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
          >
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName} (@{person.username})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="kind" className="text-xs text-muted-foreground">
            Type
          </Label>
          <select
            id="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as "broker" | "mock")}
            className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-base"
          >
            <option value="broker">Real account</option>
            <option value="mock">Mock account</option>
          </select>
          <p className="text-xs text-muted-foreground">
            {kind === "broker"
              ? "Follows a real brokerage. Holdings come from moomoo."
              : "Practice money, real prices. Nothing is actually bought."}
          </p>
        </div>

        {kind === "mock" && (
          <div className="space-y-2">
            <Label htmlFor="openingCash" className="text-xs text-muted-foreground">
              Starting money
            </Label>
            <Input
              id="openingCash"
              name="openingCash"
              placeholder="10000"
              inputMode="decimal"
              required
            />
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-negative sm:col-span-2">
            {error}
          </p>
        )}

        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>
            {busy ? "Working…" : "Create portfolio"}
          </Button>
        </div>
      </form>
    </section>
  );
}
