import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/guards";
import { LoginForm } from "@/components/layout/login-form";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Family Portfolio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Private. Sign in to continue.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
