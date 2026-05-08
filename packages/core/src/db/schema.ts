import { sqliteTable, text, integer, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["strava"] }).notNull(),
    accessTokenCipher: text("access_token_cipher").notNull(),
    refreshTokenCipher: text("refresh_token_cipher"),
    scopes: text("scopes"),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    status: text("status", { enum: ["active", "degraded", "revoked"] }).notNull().default("active"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    uniqUserPlatform: uniqueIndex("uniq_user_platform").on(t.userId, t.platform),
    idxStatus: index("idx_connections_status").on(t.status),
  }),
);

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    activityType: text("activity_type").notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull(),
    durationSeconds: integer("duration_seconds"),
    distanceMeters: integer("distance_meters"),
    title: text("title"),
    canonicalJson: text("canonical_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    idxUserStarted: index("idx_activities_user_started").on(t.userId, t.startedAt),
  }),
);

export const activitySources = sqliteTable(
  "activity_sources",
  {
    id: text("id").primaryKey(),
    activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    rawPath: text("raw_path"),
    score: integer("score"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    uniqPlatformExternal: uniqueIndex("uniq_platform_external").on(t.platform, t.externalId),
    idxActivity: index("idx_sources_activity").on(t.activityId),
  }),
);

export const dedupPending = sqliteTable("dedup_pending", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  candidateActivityId: text("candidate_activity_id").notNull(),
  matchActivityId: text("match_activity_id").notNull(),
  score: integer("score").notNull(),
  payload: text("payload").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    eventType: text("event_type").notNull(),
    platform: text("platform"),
    metadata: text("metadata"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    idxUser: index("idx_audit_user").on(t.userId, t.createdAt),
  }),
);

export const outboxEvents = sqliteTable(
  "outbox_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    source: text("source").notNull(),
    subject: text("subject"),
    payload: text("payload").notNull(),
    occurredAt: integer("occurred_at", { mode: "timestamp_ms" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    idxUnprocessed: index("idx_outbox_unprocessed").on(t.processedAt, t.occurredAt),
  }),
);

export const processedEvents = sqliteTable(
  "processed_events",
  {
    consumerId: text("consumer_id").notNull(),
    eventId: text("event_id").notNull(),
    processedAt: integer("processed_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.consumerId, t.eventId] }),
    idxProcessedAt: index("idx_processed_at").on(t.processedAt),
  }),
);

export const pushDevices = sqliteTable(
  "push_devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: ["apns", "fcm", "web"] }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    idxUser: index("idx_push_devices_user").on(t.userId),
  }),
);

export const syncJobs = sqliteTable(
  "sync_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    platform: text("platform", { enum: ["strava"] }).notNull(),
    status: text("status", { enum: ["pending", "success", "partial", "failed"] }).notNull().default("pending"),
    source: text("source", { enum: ["manual", "scheduled"] }).notNull().default("manual"),
    activitiesSynced: integer("activities_synced").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
    endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    idxUserStarted: index("idx_sync_jobs_user_started").on(t.userId, t.startedAt),
    idxStatus: index("idx_sync_jobs_status").on(t.status),
  }),
);

export const dedupEvaluations = sqliteTable(
  "dedup_evaluations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    activityId: text("activity_id").notNull().references(() => activities.id, { onDelete: "cascade" }),
    comparedToId: text("compared_to_id"),
    confidence: integer("confidence").notNull(),
    outcome: text("outcome", { enum: ["merged", "pending", "no_match"] }).notNull(),
    reasoningJson: text("reasoning_json").notNull(),
    evaluatedAt: integer("evaluated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => ({
    idxActivityLookup: index("idx_dedup_eval_activity").on(t.activityId, t.comparedToId, t.outcome),
    idxUserTime: index("idx_dedup_eval_user_time").on(t.userId, t.evaluatedAt),
  }),
);
