/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "fithub",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "cloudflare",
      providers: {
        cloudflare: "5.42.0",
      },
    };
  },
  async run() {
    const tokenMasterKey = new sst.Secret("TOKEN_MASTER_KEY");
    const zwiftClientSecret = new sst.Secret("ZWIFT_CLIENT_SECRET");
    const stravaClientSecret = new sst.Secret("STRAVA_CLIENT_SECRET");
    const openauthSigningKey = new sst.Secret("OPENAUTH_SIGNING_KEY");
    const appleClientSecret = new sst.Secret("APPLE_CLIENT_SECRET");
    const googleClientSecret = new sst.Secret("GOOGLE_CLIENT_SECRET");
    const emailProviderKey = new sst.Secret("EMAIL_PROVIDER_KEY");

    const db = new sst.cloudflare.D1("FithubDb");

    const feedCache = new sst.cloudflare.Kv("FeedCache");
    const _authKv = new sst.cloudflare.Kv("AuthKv");

    const blobStore = new sst.cloudflare.Bucket("BlobStore");

    const eventBusDlq = new sst.cloudflare.Queue("EventBusDlq");
    const syncJobsDlq = new sst.cloudflare.Queue("SyncJobsDlq");
    const retryJobsDlq = new sst.cloudflare.Queue("RetryJobsDlq");

    const eventBus = new sst.cloudflare.Queue("EventBus", {
      dlq: eventBusDlq.arn,
    });
    const syncJobs = new sst.cloudflare.Queue("SyncJobs", {
      dlq: syncJobsDlq.arn,
    });
    const retryJobs = new sst.cloudflare.Queue("RetryJobs", {
      dlq: retryJobsDlq.arn,
    });

    const apiSecrets = [
      tokenMasterKey,
      zwiftClientSecret,
      stravaClientSecret,
      openauthSigningKey,
      appleClientSecret,
      googleClientSecret,
      emailProviderKey,
    ];

    const api = new sst.cloudflare.Worker("Api", {
      handler: "packages/functions/src/api/index.ts",
      url: true,
      link: [db, feedCache, blobStore, eventBus, syncJobs, retryJobs, ...apiSecrets],
    });

    const outboxRelay = new sst.cloudflare.Worker("OutboxRelay", {
      handler: "packages/functions/src/outbox-relay/index.ts",
      link: [db, eventBus],
    });

    return {
      apiUrl: api.url,
      dbId: db.id,
      blobStore: blobStore.name,
      outboxRelay: outboxRelay.id,
    };
  },
});
