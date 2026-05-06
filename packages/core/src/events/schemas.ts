import { z } from "zod";

const isoDate = z.iso.datetime ? z.iso.datetime() : z.string().datetime();

export const ActivityIngestedSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  externalId: z.string().min(1),
  rawPath: z.string().min(1),
  ingestedAt: isoDate,
});

export const ActivityCreatedSchema = z.object({
  userId: z.string().min(1),
  activityId: z.string().min(1),
  platform: z.string().min(1),
  externalId: z.string().min(1),
});

export const ActivityMergedSchema = z.object({
  userId: z.string().min(1),
  canonicalActivityId: z.string().min(1),
  newSourceId: z.string().min(1),
  score: z.number().int().min(0).max(100),
});

export const ConnectionCreatedSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  connectionId: z.string().min(1),
});

export const ConnectionRevokedSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  connectionId: z.string().min(1),
  reason: z.enum(["user_initiated", "token_invalid", "platform_revoked", "gdpr_deletion"]),
});

export const ConnectionDegradedSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  connectionId: z.string().min(1),
  reason: z.string().min(1),
});

export const HealthUploadReceivedSchema = z.object({
  userId: z.string().min(1),
  uploadId: z.string().min(1),
  rawPath: z.string().min(1),
});

export const SyncJobCompletedSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  jobId: z.string().min(1),
  newActivities: z.number().int().nonnegative(),
  mergedActivities: z.number().int().nonnegative(),
});

export const SyncJobFailedSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  jobId: z.string().min(1),
  error: z.string().min(1),
  attempt: z.number().int().nonnegative(),
});

export const TokenRefreshFailedSchema = z.object({
  userId: z.string().min(1),
  platform: z.string().min(1),
  connectionId: z.string().min(1),
  error: z.string().min(1),
});

export const UserDeletedSchema = z.object({
  userId: z.string().min(1),
  reason: z.enum(["user_initiated", "gdpr"]),
});

export const UserExportReadySchema = z.object({
  userId: z.string().min(1),
  exportId: z.string().min(1),
  rawPath: z.string().min(1),
});

export const eventSchemaRegistry = {
  "activity.ingested": ActivityIngestedSchema,
  "activity.created": ActivityCreatedSchema,
  "activity.merged": ActivityMergedSchema,
  "connection.created": ConnectionCreatedSchema,
  "connection.revoked": ConnectionRevokedSchema,
  "connection.degraded": ConnectionDegradedSchema,
  "health_upload.received": HealthUploadReceivedSchema,
  "sync_job.completed": SyncJobCompletedSchema,
  "sync_job.failed": SyncJobFailedSchema,
  "token.refresh_failed": TokenRefreshFailedSchema,
  "user.deleted": UserDeletedSchema,
  "user.export_ready": UserExportReadySchema,
} as const;

export type EventDataMap = {
  [K in keyof typeof eventSchemaRegistry]: z.infer<(typeof eventSchemaRegistry)[K]>;
};
