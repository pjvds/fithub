import { describe, it, expect, vi } from "vitest";
import { eventToOutboxRow, appendOutbox } from "../src/outbox/publish.js";
import type { CloudEvent } from "../src/events/types.js";

const SAMPLE_EVENT: CloudEvent<{ activityId: string }> = {
  specversion: "1.0",
  id: "evt-abc-123",
  type: "com.fithub.activity.synced",
  source: "/zwift/sync",
  subject: "user-42",
  time: "2024-03-15T10:00:00.000Z",
  datacontenttype: "application/json",
  data: { activityId: "act-1" },
};

describe("eventToOutboxRow", () => {
  it("maps CloudEvent fields to an OutboxRow", () => {
    const row = eventToOutboxRow(SAMPLE_EVENT);

    expect(row.id).toBe(SAMPLE_EVENT.id);
    expect(row.eventType).toBe(SAMPLE_EVENT.type);
    expect(row.source).toBe(SAMPLE_EVENT.source);
    expect(row.subject).toBe(SAMPLE_EVENT.subject);
    expect(row.payload).toBe(JSON.stringify(SAMPLE_EVENT));
    expect(row.occurredAt).toEqual(new Date(SAMPLE_EVENT.time));
  });

  it("sets subject to null when the event has no subject", () => {
    const eventWithoutSubject = { ...SAMPLE_EVENT, subject: undefined };
    const row = eventToOutboxRow(eventWithoutSubject);
    expect(row.subject).toBeNull();
  });
});

describe("appendOutbox", () => {
  function makeDb() {
    const qb = {
      insert: vi.fn(),
      values: vi.fn().mockResolvedValue(undefined),
    };
    qb.insert.mockReturnValue(qb);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return qb as any;
  }

  it("inserts the correct outbox row", async () => {
    const db = makeDb();

    await appendOutbox(db, SAMPLE_EVENT);

    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: SAMPLE_EVENT.id,
        eventType: SAMPLE_EVENT.type,
        source: SAMPLE_EVENT.source,
        subject: SAMPLE_EVENT.subject,
        payload: JSON.stringify(SAMPLE_EVENT),
      }),
    );
  });
});
