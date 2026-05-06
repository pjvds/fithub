export interface CanonicalActivity {
  id: string;
  userId: string;
  activityType: string;
  startedAt: Date;
  durationSeconds: number | null;
  distanceMeters: number | null;
  title: string | null;
}

export interface RawActivity {
  externalId: string;
  rawJson: unknown;
  rawBlobPath?: string;
}

export interface PlatformAdapter {
  readonly platform: string;
  fetchActivities(token: string, since?: Date): Promise<RawActivity[]>;
  refreshToken(refreshToken: string): Promise<{ accessToken: string; refreshToken?: string; expiresAt?: Date }>;
  validateToken(token: string): Promise<boolean>;
  revokeToken(token: string): Promise<void>;
}
