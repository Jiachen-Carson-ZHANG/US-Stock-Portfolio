import { isOpenAccess, requireUser } from "@/lib/auth/guards";
import { BottomNav, Sidebar, SignOutButton } from "@/components/layout/nav";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();
  const canSignOut = !isOpenAccess();

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        role={user.role}
        displayName={user.displayName}
        canSignOut={canSignOut}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border bg-surface px-4 py-3 md:hidden">
          <p className="text-sm font-semibold tracking-tight">Family Portfolio</p>
          {canSignOut && <SignOutButton className="w-auto px-2 py-1" />}
        </header>

        <main className="flex-1 px-4 pt-5 pb-24 md:px-8 md:pt-8 md:pb-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>

      <BottomNav role={user.role} />
    </div>
  );
}
