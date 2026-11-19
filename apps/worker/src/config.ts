export interface WorkerConfig {
  databaseUrl: string;
  redisUrl: string;
  queueName: string;
  leaseMs: number;
  heartbeatMs: number;
  s3: {
    endpoint: string | undefined;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

export function loadConfig(): WorkerConfig {
  return {
    databaseUrl: required("DATABASE_URL"),
    redisUrl: required("REDIS_URL"),
    queueName: process.env.QUEUE_NAME ?? "image-processing",
    leaseMs: positiveInt("DB_LEASE_MS", 20_000),
    heartbeatMs: positiveInt("DB_HEARTBEAT_MS", 10_000),
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? "auto",
      bucket: required("S3_BUCKET"),
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      forcePathStyle: bool("S3_FORCE_PATH_STYLE", false),
    },
  };
}
