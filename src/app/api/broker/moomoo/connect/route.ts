import { requireApiOwner } from "@/lib/auth/guards";
import { logger } from "@/lib/logger";
import { authorizeUrl, createPkcePair, createState } from "@/lib/moomoo/oauth";
import { redirectUri, storePendingFlow } from "@/lib/moomoo/flow";

export async function POST() {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  const clientId = process.env.MOOMOO_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      { error: "MOOMOO_CLIENT_ID is not configured. Run: npm run moomoo:register" },
      { status: 500 },
    );
  }

  const { verifier, challenge } = createPkcePair();
  const state = createState();
  await storePendingFlow({ state, verifier });

  logger.info("broker.connect.started", { provider: "moomoo" });

  return Response.json({
    authorizeUrl: authorizeUrl({
      clientId,
      challenge,
      redirectUri: redirectUri(),
      state,
    }),
  });
}
