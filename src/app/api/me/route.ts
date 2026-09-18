import { authenticateRequest, unauthorized } from "@/lib/auth/guards";

export async function GET() {
  const user = await authenticateRequest();
  if (!user) return unauthorized();
  return Response.json({ user });
}
