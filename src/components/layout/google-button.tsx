import { LogIn } from "lucide-react";

/**
 * Off to Google to sign in. A plain link: the redirect, the sealed state and
 * the check on the way back all happen on the server.
 */
export function GoogleButton({ label, intent = "signin" }: { label: string; intent?: "signin" | "link" }) {
  return (
    <a
      href={`/api/auth/google/start${intent === "link" ? "?intent=link" : ""}`}
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-muted"
    >
      <LogIn className="size-4" aria-hidden="true" />
      {label}
    </a>
  );
}
