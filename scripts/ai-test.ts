import { aiBaseUrl, aiModel, deepSeekChat, isDeepSeekConfigured } from "../src/lib/deepseek";

/**
 * Verifies the configured provider, model and key end to end. Prints what the
 * provider says on failure — the key itself is never printed.
 */
async function main() {
  console.log("\nAI configuration");
  console.log(`  endpoint : ${aiBaseUrl()}/chat/completions`);
  console.log(`  model    : ${aiModel()}`);
  console.log(
    `  api key  : ${isDeepSeekConfigured() ? "set" : "MISSING — set DEEPSEEK_API_KEY"}`,
  );

  if (!isDeepSeekConfigured()) process.exit(1);

  console.log("\nSending a test prompt…\n");

  const reply = await deepSeekChat(
    [
      { role: "system", content: "Answer in one short sentence." },
      { role: "user", content: "Reply with: connection working." },
    ],
    { maxTokens: 50 },
  );

  console.log(`  reply: ${reply}`);
  console.log("\nAI is configured correctly.\n");
}

main().catch((error) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : error}\n`);
  console.error("Check DEEPSEEK_MODEL matches a model your key can use,");
  console.error("and DEEPSEEK_BASE_URL matches that provider's API host.\n");
  process.exit(1);
});
