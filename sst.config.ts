/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "fithub",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "cloudflare",
      providers: {
        cloudflare: "6.13.0",
      },
    };
  },
  async run() {
    const tokenMasterKey = new sst.Secret("TOKEN_MASTER_KEY");
    const stravaClientSecret = new sst.Secret("STRAVA_CLIENT_SECRET");
    const stravaClientId = new sst.Secret("STRAVA_CLIENT_ID");
    const redirectBaseUrl = new sst.Secret("REDIRECT_BASE_URL");
    const emailProviderKey = new sst.Secret("EMAIL_PROVIDER_KEY");

    const db = new sst.cloudflare.D1("FithubDb");

    const feedCache = new sst.cloudflare.Kv("FeedCache");
    const authKv = new sst.cloudflare.Kv("AuthKv");

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

    // Auth worker — OpenAuth.js issuer with CloudflareStorage
    const authDomain = "auth.fithub.space";
    const auth = new sst.cloudflare.Worker("Auth", {
      handler: "packages/functions/src/auth/index.ts",
      link: [authKv, db, emailProviderKey],
      url: true,
      domain: authDomain,
    });

    const apiSecrets = [
      tokenMasterKey,
      stravaClientSecret,
      stravaClientId,
      redirectBaseUrl,
    ];

    const api = new sst.cloudflare.Worker("Api", {
      handler: "packages/functions/src/api/index.ts",
      url: true,
      link: [db, feedCache, authKv, blobStore, eventBus, syncJobs, retryJobs, auth, ...apiSecrets],
      transform: {
        worker: {
          serviceBindings: [{ name: "Auth", service: auth.name }],
        },
      },
    });

    const outboxRelay = new sst.cloudflare.Worker("OutboxRelay", {
      handler: "packages/functions/src/outbox-relay/index.ts",
      link: [db, eventBus],
    });

    // Scheduler Worker — cron triggers hourly for Strava reconcile
    const scheduler = new sst.cloudflare.Worker("Scheduler", {
      handler: "packages/functions/src/scheduler/index.ts",
      link: [db, tokenMasterKey, stravaClientSecret],
    });

    // Sync worker — queue consumer for sync-jobs and retry-jobs
    // NOTE: UserSyncCoordinator Durable Object namespace binding must be added
    // via the Cloudflare dashboard or wrangler.toml transform after first deploy.
    const syncWorker = new sst.cloudflare.Worker("SyncWorker", {
      handler: "packages/functions/src/worker/index.ts",
      link: [db, syncJobs, retryJobs, blobStore, feedCache, tokenMasterKey, stravaClientSecret],
    });

    // Web frontend — Astro SSR app deployed as a Cloudflare Worker
    const web = new sst.cloudflare.Astro("Web", {
      path: "web",
      domain: "app.fithub.space",
      link: [auth],
      environment: {
        AUTH_WORKER_URL: `https://${authDomain}`,
        API_BASE_URL: api.url,
      },
    });

    return {
      apiUrl: api.url,
      webUrl: web.url,
      authUrl: auth.url,
      dbId: db.id,
      blobStore: blobStore.name,
      outboxRelay: outboxRelay.id,
      scheduler: scheduler.id,
      syncWorker: syncWorker.id,
    };
  },
});
