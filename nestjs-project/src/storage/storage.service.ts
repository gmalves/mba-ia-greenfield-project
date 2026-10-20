import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import storageConfig from '../config/storage.config';

export interface PresignedPart {
  part_number: number;
  url: string;
}

export interface UploadPart {
  part_number: number;
  etag: string;
}

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  /** Client usado apenas para ASSINAR URLs entregues a clientes externos (navegador). */
  private readonly signingS3: S3Client;
  private readonly bucket: string;

  constructor(
    @Inject(storageConfig.KEY)
    config: ConfigType<typeof storageConfig>,
  ) {
    this.s3 = new S3Client({
      endpoint: config.endpoint,
      forcePathStyle: true,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    this.signingS3 =
      config.publicEndpoint === config.endpoint
        ? this.s3
        : new S3Client({
            endpoint: config.publicEndpoint,
            forcePathStyle: true,
            region: config.region,
            credentials: {
              accessKeyId: config.accessKeyId,
              secretAccessKey: config.secretAccessKey,
            },
          });
    this.bucket = config.bucket;
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const { UploadId } = await this.s3.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );

    if (UploadId === undefined) {
      throw new Error('Object storage did not return an UploadId');
    }
    return UploadId;
  }

  async getPresignedPartUrls(
    key: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<PresignedPart[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await getSignedUrl(
          this.signingS3,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: 3600 },
        ),
      })),
    );
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: UploadPart[],
  ): Promise<void> {
    await this.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.part_number,
            ETag: part.etag,
          })),
        },
      }),
    );
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.s3.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  /** URL pré-assinada para uso INTERNO (ex.: worker baixando o objeto para processar). */
  async getPresignedGetUrl(
    key: string,
    options: { expiresIn?: number; contentDisposition?: string } = {},
  ): Promise<{ url: string; expiresIn: number }> {
    return this.signGetUrl(this.s3, key, options);
  }

  /** URL pré-assinada para CLIENTES externos (streaming, download, thumbnail). */
  async getClientGetUrl(
    key: string,
    options: { expiresIn?: number; contentDisposition?: string } = {},
  ): Promise<{ url: string; expiresIn: number }> {
    return this.signGetUrl(this.signingS3, key, options);
  }

  private async signGetUrl(
    client: S3Client,
    key: string,
    options: { expiresIn?: number; contentDisposition?: string },
  ): Promise<{ url: string; expiresIn: number }> {
    const expiresIn = options.expiresIn ?? 3600;
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.contentDisposition
          ? { ResponseContentDisposition: options.contentDisposition }
          : {}),
      }),
      { expiresIn },
    );
    return { url, expiresIn };
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }
}
