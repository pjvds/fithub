const STRAVA_API_BASE = "https://www.strava.com/api/v3";

export interface StravaSubscription {
  id: number;
  callbackUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface StravaSubscriptionConfig {
  clientId: string;
  clientSecret: string;
}

export class StravaSubscriptionManager {
  constructor(private readonly config: StravaSubscriptionConfig) {}

  /**
   * Create a Strava webhook subscription.
   * Returns the new subscription ID on success.
   */
  async create(callbackUrl: string, verifyToken: string): Promise<number> {
    const resp = await fetch(`${STRAVA_API_BASE}/push_subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        callback_url: callbackUrl,
        verify_token: verifyToken,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Strava subscription create failed ${resp.status}: ${body}`);
    }

    const data = (await resp.json()) as { id: number };
    return data.id;
  }

  /** Delete a Strava webhook subscription by ID. */
  async delete(subscriptionId: number): Promise<void> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const resp = await fetch(
      `${STRAVA_API_BASE}/push_subscriptions/${subscriptionId}?${params.toString()}`,
      { method: "DELETE" },
    );

    if (!resp.ok && resp.status !== 404) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Strava subscription delete failed ${resp.status}: ${body}`);
    }
  }

  /** List existing webhook subscriptions for this app. */
  async list(): Promise<StravaSubscription[]> {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const resp = await fetch(
      `${STRAVA_API_BASE}/push_subscriptions?${params.toString()}`,
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Strava subscription list failed ${resp.status}: ${body}`);
    }

    return resp.json() as Promise<StravaSubscription[]>;
  }
}
