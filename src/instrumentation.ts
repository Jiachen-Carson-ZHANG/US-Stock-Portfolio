import type { Instrumentation } from "next";

/**
 * Every server error, written down where it can be read.
 *
 * "Something went wrong" was appearing with no trace of what. The timing log
 * only covered the operations that had been wrapped by hand, and the failures
 * were happening outside them — in a layout, in an auth guard, anywhere. The
 * full message exists only on the server, and the browser is given a digest
 * instead, deliberately: the message can name a table or a column and the
 * browser is not the place for that.
 *
 * So the server records it against that digest. The reference on the error
 * screen then leads straight to the cause on the logs page, and nobody has to
 * guess from a screenshot again.
 *
 * Nothing here may throw. An error handler that fails while handling an error
 * is how one bad request becomes a crash loop.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  // This file is bundled for the edge runtime as well, where the middleware
  // runs and where node:crypto and a Postgres client do not exist. The import
  // is dynamic and guarded so the edge bundle never pulls them in.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { recordFailure } = await import("@/lib/observe");

    const message = error instanceof Error ? error.message : String(error);
    const digest =
      typeof error === "object" && error !== null && "digest" in error
        ? String((error as { digest?: unknown }).digest)
        : null;

    // The path, not the query string: a path says which page broke, and a
    // query string can carry things that do not belong in a log.
    const path = (request.path ?? "").split("?")[0] || "unknown";

    await recordFailure(
      `render ${path}`,
      [digest ? `ref ${digest}` : null, context.routerKind, message]
        .filter(Boolean)
        .join(" · "),
    );
  } catch {
    // Reporting the failure failed. There is nowhere left to say so.
  }
};
