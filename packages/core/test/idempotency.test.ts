import { describe, it, expect, vi } from "vitest";
import { withIdempotency } from "../src/events/idempotency.js";

// Minimal drizzle-style chainable mock that resolves at the terminal call.
function makeDb(existingRows: unknown[]) {
  const qb = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(existingRows),
    insert: vi.fn(),
    values: vi.fn(),
    onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
  };
  qb.select.mockReturnValue(qb);
  qb.from.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.insert.mockReturnValue(qb);
  qb.values.mockReturnValue(qb);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return qb as any;
}

describe("withIdempotency", () => {
  it("returns skipped and does not call handler when event was already processed", async () => {
    const db = makeDb([{ eventId: "evt-1" }]);
    const handler = vi.fn();

    const outcome = await withIdempotency("consumer-a", "evt-1", db, handler);

    expect(outcome).toEqual({ status: "skipped" });
    expect(handler).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("calls handler and inserts a record for a new event", async () => {
    const db = makeDb([]);
    const handler = vi.fn().mockResolvedValue(42);

    const outcome = await withIdempotency("consumer-b", "evt-2", db, handler);

    expect(outcome).toEqual({ status: "processed", result: 42 });
    expect(handler).toHaveBeenCalledOnce();
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({ consumerId: "consumer-b", eventId: "evt-2" }),
    );
    expect(db.onConflictDoNothing).toHaveBeenCalledOnce();
  });

  it("propagates handler errors without inserting a record", async () => {
    const db = makeDb([]);
    const handler = vi.fn().mockRejectedValue(new Error("handler exploded"));

    await expect(withIdempotency("consumer-c", "evt-3", db, handler)).rejects.toThrow("handler exploded");
    expect(db.insert).not.toHaveBeenCalled();
  });
});
