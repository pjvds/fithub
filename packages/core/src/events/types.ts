export interface CloudEvent<T = unknown> {
  specversion: "1.0";
  id: string;
  source: string;
  type: string;
  time: string;
  subject?: string;
  datacontenttype?: "application/json";
  correlationid?: string;
  data: T;
}

export type DomainEventType =
  | "activity.ingested"
  | "activity.created"
  | "activity.merged"
  | "connection.created"
  | "connection.revoked"
  | "connection.degraded"
  | "health_upload.received"
  | "sync_job.completed"
  | "sync_job.failed"
  | "token.refresh_failed"
  | "user.deleted"
  | "user.export_ready"
  | "webhook.strava.activity_created";

export function newCloudEvent<T>(input: {
  id: string;
  source: string;
  type: DomainEventType;
  data: T;
  subject?: string;
  occurredAt?: Date;
  correlationId?: string;
}): CloudEvent<T> {
  return {
    specversion: "1.0",
    id: input.id,
    source: input.source,
    type: input.type,
    time: (input.occurredAt ?? new Date()).toISOString(),
    ...(input.subject !== undefined ? { subject: input.subject } : {}),
    ...(input.correlationId !== undefined ? { correlationid: input.correlationId } : {}),
    datacontenttype: "application/json",
    data: input.data,
  };
}
