import { describe, it, expect, vi, beforeEach } from "vitest";
import { mergeActivities } from "../src/dedup/merger.js";

function makeDb(canonicalRow: Record<string, unknown> | null) {
  const selectResult = canonicalRow ? [canonicalRow] : [];
  const db = {
    select: vi.fn(),
    update: vi.fn(),
    set: vi.fn(),
    where: vi.fn(),
    limit: vi.fn().mockResolvedValue(selectResult),
    returning: vi.fn().mockResolvedValue([{ id: "src-moved-1" }]),
    delete: vi.fn(),
    insert: vi.fn(),
    values: vi.fn().mockResolvedValue(undefined),
    from: vi.fn(),
    all: vi.fn(),
  };

  // Chain select → from → where → limit
  db.select.mockReturnValue(db);
  db.from.mockReturnValue(db);
  db.where.mockReturnValue(db);
  db.limit.mockResolvedValue(selectResult);

  // Chain update → set → where → returning
  db.update.mockReturnValue(db);
  db.set.mockReturnValue(db);
  db.returning.mockResolvedValue([{ id: "src-moved-1" }]);

  // Chain delete → where
  db.delete.mockReturnValue(db);

  // Chain insert → values
  db.insert.mockReturnValue(db);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return db as any;
}

describe("mergeActivities", () => {
  it("throws when canonical activity is not found", async () => {
    const db = makeDb(null);
    await expect(
      mergeActivities(db, "canon-1", "dup-1", 0.9),
    ).rejects.toThrow("canonical activity not found: canon-1");
  });

  it("re-points sources, deletes duplicate, emits outbox event", async () => {
    const db = makeDb({ id: "canon-1", userId: "u1" });

    const result = await mergeActivities(db, "canon-1", "dup-1", 0.9, "corr-xyz");

    expect(result.canonicalActivityId).toBe("canon-1");
    expect(result.mergedSourceId).toBe("src-moved-1");

    // update activitySources
    expect(db.update).toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith({ activityId: "canon-1" });

    // delete duplicate
    expect(db.delete).toHaveBeenCalled();

    // insert into outbox
    expect(db.insert).toHaveBeenCalled();
    const valuesArg = db.values.mock.calls[0][0];
    expect(valuesArg.eventType).toBe("activity.merged");
    expect(JSON.parse(valuesArg.payload)).toMatchObject({
      correlationid: "corr-xyz",
      data: {
        userId: "u1",
        canonicalActivityId: "canon-1",
        newSourceId: "src-moved-1",
        score: 90,
      },
    });
  });

  it("falls back to duplicateId as sourceId when no sources were moved", async () => {
    const db = makeDb({ id: "canon-1", userId: "u1" });
    db.returning.mockResolvedValue([]); // no sources re-pointed

    const result = await mergeActivities(db, "canon-1", "dup-999", 0.8);
    expect(result.mergedSourceId).toBe("dup-999");
  });

  it("rounds confidence to integer score in outbox payload", async () => {
    const db = makeDb({ id: "canon-1", userId: "u1" });
    await mergeActivities(db, "canon-1", "dup-1", 1.0);
    const valuesArg = db.values.mock.calls[0][0];
    expect(JSON.parse(valuesArg.payload).data.score).toBe(100);
  });
});
