import { describe, it, expect, vi } from "vitest";
import { logAuditEvent } from "../src/audit/logger.js";

function makeDb() {
  const rows: unknown[] = [];
  const db = {
    _rows: rows,
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockImplementation((row: unknown) => {
      rows.push(row);
      return Promise.resolve(undefined);
    }),
  };
  return db as unknown as Parameters<typeof logAuditEvent>[0];
}

describe("logAuditEvent", () => {
  it("inserts a row with all provided fields", async () => {
    const db = makeDb() as ReturnType<typeof makeDb> & { _rows: unknown[] };
    await logAuditEvent(db, {
      userId: "u-1",
      eventType: "connection.created",
      platform: "zwift",
      metadata: { connectionId: "c-1" },
    });
    const rows = (db as unknown as { _rows: unknown[] })._rows;
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.userId).toBe("u-1");
    expect(row.eventType).toBe("connection.created");
    expect(row.platform).toBe("zwift");
    expect(row.metadata).toBe(JSON.stringify({ connectionId: "c-1" }));
    expect(typeof row.id).toBe("string");
  });

  it("sets userId to null when not provided", async () => {
    const db = makeDb() as unknown as { _rows: unknown[] } & Parameters<typeof logAuditEvent>[0];
    await logAuditEvent(db, { eventType: "user.deleted" });
    const row = (db as unknown as { _rows: unknown[] })._rows[0] as Record<string, unknown>;
    expect(row.userId).toBeNull();
  });

  it("sets platform to null when not provided", async () => {
    const db = makeDb() as unknown as { _rows: unknown[] } & Parameters<typeof logAuditEvent>[0];
    await logAuditEvent(db, { userId: "u-2", eventType: "user.export_ready" });
    const row = (db as unknown as { _rows: unknown[] })._rows[0] as Record<string, unknown>;
    expect(row.platform).toBeNull();
  });

  it("sets metadata to null when not provided", async () => {
    const db = makeDb() as unknown as { _rows: unknown[] } & Parameters<typeof logAuditEvent>[0];
    await logAuditEvent(db, { userId: "u-3", eventType: "token.revoked", platform: "strava" });
    const row = (db as unknown as { _rows: unknown[] })._rows[0] as Record<string, unknown>;
    expect(row.metadata).toBeNull();
  });

  it("assigns a unique ID to each audit entry", async () => {
    const db1 = makeDb() as unknown as { _rows: unknown[] } & Parameters<typeof logAuditEvent>[0];
    const db2 = makeDb() as unknown as { _rows: unknown[] } & Parameters<typeof logAuditEvent>[0];
    await logAuditEvent(db1, { eventType: "e1" });
    await logAuditEvent(db2, { eventType: "e2" });
    const id1 = ((db1 as unknown as { _rows: unknown[] })._rows[0] as Record<string, unknown>).id;
    const id2 = ((db2 as unknown as { _rows: unknown[] })._rows[0] as Record<string, unknown>).id;
    expect(id1).not.toBe(id2);
  });
});
