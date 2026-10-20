import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import { StorageService } from './storage.service';

describe('StorageService (integration)', () => {
  let service: StorageService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
      ],
      providers: [StorageService],
    }).compile();

    service = moduleRef.get(StorageService);
  });

  function randomKey(prefix: string): string {
    return `test/${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  it('should create a multipart upload and return an UploadId', async () => {
    const key = randomKey('init');
    const uploadId = await service.createMultipartUpload(key, 'video/mp4');

    expect(uploadId).toBeTruthy();

    await service.abortMultipartUpload(key, uploadId);
  });

  it('should return one presigned part URL per part number', async () => {
    const key = randomKey('parts');
    const uploadId = await service.createMultipartUpload(key, 'video/mp4');

    const parts = await service.getPresignedPartUrls(key, uploadId, [1, 2, 3]);

    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.part_number)).toEqual([1, 2, 3]);
    for (const part of parts) {
      expect(part.url).toContain('http');
    }

    await service.abortMultipartUpload(key, uploadId);
  });

  it('should upload a part, complete the upload, and expose a presigned GET', async () => {
    const key = randomKey('complete');
    const uploadId = await service.createMultipartUpload(key, 'video/mp4');

    const [part] = await service.getPresignedPartUrls(key, uploadId, [1]);
    const putResponse = await fetch(part.url, {
      method: 'PUT',
      body: Buffer.from('fake-video-bytes'),
    });
    expect(putResponse.ok).toBe(true);

    const etag = (putResponse.headers.get('etag') ?? '').replace(/"/g, '');
    expect(etag).toBeTruthy();

    await service.completeMultipartUpload(key, uploadId, [
      { part_number: 1, etag },
    ]);

    const { url } = await service.getPresignedGetUrl(key);
    const getResponse = await fetch(url);
    expect(getResponse.status).toBe(200);
  });

  it('should abort a multipart upload without error', async () => {
    const key = randomKey('abort');
    const uploadId = await service.createMultipartUpload(key, 'video/mp4');

    await expect(
      service.abortMultipartUpload(key, uploadId),
    ).resolves.toBeUndefined();
  });
});
