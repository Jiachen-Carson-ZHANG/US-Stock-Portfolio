import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { defaultFor } from "@/lib/portfolios";

export default async function Home() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // Signed in but not approved: the waiting page, not the login form, which
  // would read as "your password was wrong".
  if (user.status !== "active") redirect("/pending");

  const portfolio = await defaultFor(await getDb(), user);
  redirect(portfolio ? `/${portfolio.slug}` : "/no-portfolio");
}
