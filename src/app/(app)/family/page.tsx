import { redirect } from "next/navigation";

/**
 * The family room became the playground.
 *
 * The old room mixed a shared watchlist, a weekly challenge and a snapshot of
 * one account's value, which meant a page that was partly a conversation and
 * partly other people's money. The conversation is what anybody used, so it
 * became a room of its own; the watchlist keeps its own page; and the
 * valuation belongs to whoever owns it.
 *
 * Kept as a redirect rather than deleted: the address has been shared.
 */
export default function FamilyPage() {
  redirect("/playground");
}
