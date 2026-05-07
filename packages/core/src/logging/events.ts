export const LogEvent = {
  // Auth — token verification
  authTokenAccepted: "auth.token.accepted",
  authTokenRejected: "auth.token.rejected",

  // Auth — magic-link / code flow
  authMagicLinkSent: "auth.magic_link.sent",
  authMagicLinkSendFailed: "auth.magic_link.send_failed",
  authMagicLinkExpired: "auth.magic_link.expired",
  authSignup: "auth.signup",
  authSignin: "auth.signin",
  authSignout: "auth.signout",

  apiRequestStarted: "api.request.started",
  apiRequestCompleted: "api.request.completed",
  apiRequestFailed: "api.request.failed",

  outboxRelayTickStarted: "outbox.relay.tick.started",
  outboxRelayTickCompleted: "outbox.relay.tick.completed",
  outboxRelayPublishFailed: "outbox.relay.publish.failed",

  oauthRefreshStarted: "oauth.refresh.started",
  oauthRefreshSucceeded: "oauth.refresh.succeeded",
  oauthRefreshFailed: "oauth.refresh.failed",

  connectionCreated: "connection.created",
  connectionRevoked: "connection.revoked",
  connectionDegraded: "connection.degraded",

  oauthInitiateStarted: "oauth.initiate.started",
  oauthCallbackCompleted: "oauth.callback.completed",
  oauthCallbackFailed: "oauth.callback.failed",
  oauthDisconnectStarted: "oauth.disconnect.started",
  oauthDisconnectCompleted: "oauth.disconnect.completed",

  schedulerTickStarted: "scheduler.tick.started",
  schedulerTickCompleted: "scheduler.tick.completed",

  syncJobEnqueued: "sync.job.enqueued",
  syncJobStarted: "sync.job.started",
  syncJobCompleted: "sync.job.completed",
  syncJobFailed: "sync.job.failed",

  activityIngested: "sync.activity.ingested",
  rateLimitExhausted: "sync.rate_limit.exhausted",

  webhookSubscriptionCreated: "webhook.subscription.created",
  webhookSubscriptionDeleted: "webhook.subscription.deleted",
  webhookReceived: "webhook.received",
  webhookSignatureFailed: "webhook.signature.failed",
} as const;

export type LogEvent = (typeof LogEvent)[keyof typeof LogEvent];
