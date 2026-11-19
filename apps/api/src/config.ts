export interface ApiConfig {
  port: number;
  databaseUrl: string;
  redisUrl: string;
  queueName: string;
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

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

export function loadConfig(): ApiConfig {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("PORT must be a positive integer");
  }

  return {
    port,
    databaseUrl: required("DATABASE_URL"),
    redisUrl: required("REDIS_URL"),
    queueName: process.env.QUEUE_NAME ?? "image-processing",
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
