import { describe, it, expect } from "vitest";
import { newCloudEvent } from "../src/events/types.js";
import { eventSchemaRegistry } from "../src/events/schemas.js";

describe("CloudEvents", () => {
  it("creates a valid v1.0 envelope", () => {
    const evt = newCloudEvent({
      id: "11111111-1111-1111-1111-111111111111",
      source: "fithub.api",
      type: "activity.created",
      data: {
        userId: "u1",
        activityId: "a1",
        platform: "zwift",
        externalId: "ext-1",
      },
    });
    expect(evt.specversion).toBe("1.0");
    expect(evt.datacontenttype).toBe("application/json");
    expect(typeof evt.time).toBe("string");
  });

  it("validates payload via registry", () => {
    const schema = eventSchemaRegistry["sync_job.completed"];
    const ok = schema.parse({
      userId: "u1",
      platform: "zwift",
      jobId: "j1",
      newActivities: 5,
      mergedActivities: 1,
    });
    expect(ok.newActivities).toBe(5);
  });

  it("rejects invalid payloads", () => {
    const schema = eventSchemaRegistry["activity.merged"];
    expect(() =>
      schema.parse({ userId: "u1", canonicalActivityId: "a1", newSourceId: "s1", score: 999 }),
    ).toThrow();
  });
});
