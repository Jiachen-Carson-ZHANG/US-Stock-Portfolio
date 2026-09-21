import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { defaultFor } from "@/lib/portfolios";

export default async function Home() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const portfolio = await defaultFor(await getDb(), user);
  redirect(portfolio ? `/${portfolio.slug}` : "/no-portfolio");
}
