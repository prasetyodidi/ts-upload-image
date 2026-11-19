import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

export interface S3StorageConfig {
  endpoint: string | undefined;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface StoredObject {
  key: string;
  bytes: number;
}

export interface DownloadedObject {
  body: ReadableStream;
  contentLength: number | undefined;
  contentType: string | undefined;
}

export class S3ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async putInput(
    jobId: string,
    data: Buffer,
    contentType: string,
  ): Promise<StoredObject> {
    const key = `inputs/${jobId}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
        ContentLength: data.byteLength,
      }),
    );
    return { key, bytes: data.byteLength };
  }

  async getInput(key: string): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    if (!response.Body) {
      throw new Error(`Object ${key} has no body`);
    }

    return Buffer.from(await response.Body.transformToByteArray());
  }

  async putOutput(jobId: string, data: Buffer): Promise<StoredObject> {
    const key = `outputs/${jobId}.webp`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: "image/webp",
        ContentLength: data.byteLength,
      }),
    );
    return { key, bytes: data.byteLength };
  }

  async getOutput(key: string): Promise<DownloadedObject> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    if (!response.Body) {
      throw new Error(`Object ${key} has no body`);
    }

    return {
      body: response.Body.transformToWebStream(),
      contentLength: response.ContentLength,
      contentType: response.ContentType,
    };
  }

  async headOutput(jobId: string): Promise<{ exists: boolean; bytes?: number }> {
    const key = `outputs/${jobId}.webp`;
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return response.ContentLength === undefined
        ? { exists: true }
        : { exists: true, bytes: response.ContentLength };
    } catch (error) {
      if (isObjectMissing(error)) {
        return { exists: false };
      }
      throw error;
    }
  }

  async deleteOutput(jobId: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: `outputs/${jobId}.webp`,
      }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

function isObjectMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.Code === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}
