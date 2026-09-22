import { afterEach, describe, expect, it, vi } from "vitest";
import { clearInflight, dedupe } from "@/lib/inflight";

afterEach(() => {
  clearInflight();
});

describe("deduplicating concurrent work", () => {
  // The case from the logs: two requests 31ms apart each refreshed the same
  // broker token, because neither knew the other was already doing it.
  it("runs once for callers that overlap", async () => {
    const work = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("token"), 20)),
    );

    const [a, b, c] = await Promise.all([
      dedupe("token", work),
      dedupe("token", work),
      dedupe("token", work),
    ]);

    expect(work).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual(["token", "token", "token"]);
  });

  it("runs again once the first has finished", async () => {
    const work = vi.fn(async () => "value");

    await dedupe("k", work);
    await dedupe("k", work);

    expect(work).toHaveBeenCalledTimes(2);
  });

  it("keeps different keys apart", async () => {
    const work = vi.fn(async (key: string) => key);
    await Promise.all([dedupe("a", () => work("a")), dedupe("b", () => work("b"))]);
    expect(work).toHaveBeenCalledTimes(2);
  });

  // A rejection must not be cached, or one network blip would poison the key
  // until the process restarted.
  it("lets the next caller retry after a failure", async () => {
    const work = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce("recovered");

    await expect(dedupe("k", work)).rejects.toThrow("network");
    await expect(dedupe("k", work)).resolves.toBe("recovered");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("rejects every overlapping caller when the shared work fails", async () => {
    const work = vi.fn(
      () =>
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error("boom")), 10)),
    );

    const results = await Promise.allSettled([dedupe("k", work), dedupe("k", work)]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
  });
});
