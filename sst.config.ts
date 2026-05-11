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

    const emailProviderKey = new sst.Secret("EMAIL_PROVIDER_KEY");
    const betterStackToken = new sst.Secret("BetterStackToken");

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
      transform: {
        worker: { logpush: true },
      },
    });

    const apiSecrets = [
      tokenMasterKey,
      stravaClientSecret,
      stravaClientId,
    ];

    const api = new sst.cloudflare.Worker("Api", {
      handler: "packages/functions/src/api/index.ts",
      url: true,
      link: [db, feedCache, authKv, blobStore, eventBus, syncJobs, retryJobs, auth, ...apiSecrets],
      environment: {
        AUTH_WORKER_URL: `https://${authDomain}`,
        REDIRECT_BASE_URL: "https://app.fithub.space",
      },
      transform: {
        worker: {
          serviceBindings: [{ name: "Auth", service: auth.name }],
          logpush: true,
        },
      },
    });

    const outboxRelay = new sst.cloudflare.Worker("OutboxRelay", {
      handler: "packages/functions/src/outbox-relay/index.ts",
      link: [db, eventBus],
      transform: {
        worker: { logpush: true },
      },
    });

    // Scheduler Worker — cron triggers:
    //   "0 * * * *" — hourly Strava reconcile
    //   "0 0 * * *" — daily processed_events cleanup (T056)
    // Cron expressions must be registered in the Cloudflare dashboard or via
    // wrangler.toml [triggers] because SST Ion does not yet expose a cron prop.
    const scheduler = new sst.cloudflare.Worker("Scheduler", {
      handler: "packages/functions/src/scheduler/index.ts",
      link: [db, tokenMasterKey, stravaClientSecret],
      transform: {
        worker: { logpush: true },
      },
    });

    // Sync worker — queue consumer for sync-jobs and retry-jobs
    const syncWorker = new sst.cloudflare.Worker("SyncWorker", {
      handler: "packages/functions/src/worker/index.ts",
      link: [db, syncJobs, retryJobs, blobStore, feedCache, tokenMasterKey, stravaClientId, stravaClientSecret],
      transform: {
        worker: {
          logpush: true,
        },
      },
    });

    new cloudflare.QueueConsumer("SyncJobsConsumer", {
      accountId: sst.cloudflare.DEFAULT_ACCOUNT_ID,
      queueId: syncJobs.nodes.queue.id,
      scriptName: syncWorker.nodes.worker.scriptName,
      settings: { batchSize: 10, maxWaitTimeMs: 5000, maxRetries: 3 },
      type: "worker",
    });

    new cloudflare.QueueConsumer("RetryJobsConsumer", {
      accountId: sst.cloudflare.DEFAULT_ACCOUNT_ID,
      queueId: retryJobs.nodes.queue.id,
      scriptName: syncWorker.nodes.worker.scriptName,
      settings: { batchSize: 10, maxWaitTimeMs: 5000, maxRetries: 3 },
      type: "worker",
    });

    // Cloudflare Logpush job — ships workers_trace_events to BetterStack Logs
    new cloudflare.LogpushJob("BetterStackLogpush", {
      accountId: sst.cloudflare.DEFAULT_ACCOUNT_ID,
      dataset: "workers_trace_events",
      destinationConf: $interpolate`https://in.logs.betterstack.com?header_Authorization=Bearer%20${betterStackToken.value}`,
      enabled: true,
      name: "fithub-workers-betterstack",
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
