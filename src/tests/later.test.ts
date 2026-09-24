import { describe, expect, it } from "vitest";
import { runLater } from "@/lib/later";

describe("work that should not make anybody wait", () => {
  it("still runs outside a request, where nothing will freeze it", async () => {
    let ran = false;
    runLater(async () => {
      ran = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(ran).toBe(true);
  });

  it("swallows a failure rather than leaving an unhandled rejection", async () => {
    // An unhandled rejection in a test run fails the run, which is how this
    // would surface if the guard were missing.
    runLater(async () => {
      throw new Error("background failure");
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(true).toBe(true);
  });
});
