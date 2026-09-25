import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { lastViewedOr } from "@/lib/portfolios/last-viewed";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Signed in but not approved: the waiting page, not the login form, which
  // would read as "your password was wrong".
  if (user.status !== "active") redirect("/pending");

  // The one they last opened, not a rule's pick. Someone reading Carson's
  // account who taps the logo, or signs in again tomorrow, is still reading
  // Carson's account — sending them to their own practice account instead
  // is the "it jumped back" people saw.
  const portfolio = await lastViewedOr(await getDb(), user);
  redirect(portfolio ? `/${portfolio.slug}` : "/no-portfolio");
}
