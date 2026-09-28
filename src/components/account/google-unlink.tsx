"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Stops a linked Google account signing in, after a warning about the password. */
export function GoogleUnlink({ label, confirm }: { label: string; confirm: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(confirm)) return;
        setBusy(true);
        await fetch("/api/auth/google/unlink", { method: "POST" }).catch(() => null);
        setBusy(false);
        router.refresh();
      }}
    >
      {label}
    </Button>
  );
}
