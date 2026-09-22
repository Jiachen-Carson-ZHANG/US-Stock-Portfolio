/** Open access is for local development only. Production always requires sign-in. */
export function isOpenAccess(): boolean {
  const mode = process.env.AUTH_MODE;
  if (process.env.NODE_ENV === "production" && mode !== "password") {
    throw new Error("Production requires AUTH_MODE=password.");
  }
  if (mode && mode !== "password" && mode !== "open") throw new Error("Invalid AUTH_MODE.");
  return mode !== "password";
}
