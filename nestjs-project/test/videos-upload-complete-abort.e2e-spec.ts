import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Channel } from '../src/channels/entities/channel.entity';
import { DomainExceptionFilter } from '../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../src/common/filters/validation-exception.filter';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { User } from '../src/users/entities/user.entity';
import { VideoStatus } from '../src/videos/entities/video-status.enum';
import { Video } from '../src/videos/entities/video.entity';

describe('POST /videos/:id/upload/complete + abort (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let jwtService: JwtService;
  let throttlerStorage: ThrottlerStorageService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(
      new DomainExceptionFilter(),
      new ValidationExceptionFilter(),
    );
    await app.init();

    dataSource = moduleFixture.get(DataSource);
    jwtService = moduleFixture.get(JwtService);
    throttlerStorage =
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
    throttlerStorage.storage.clear();
  });

  async function createAuthenticatedChannel(): Promise<{
    token: string;
    channel: Channel;
  }> {
    const userRepository = dataSource.getRepository(User);
    const channelRepository = dataSource.getRepository(Channel);

    const user = await userRepository.save(
      userRepository.create({
        email: `ca_e2e_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'CA Channel',
        nickname: `ca_${Math.random().toString(36).slice(2, 10)}`,
        user_id: user.id,
      }),
    );
    const token = await jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return { token, channel };
  }

  async function initUpload(token: string): Promise<{
    id: string;
    upload_id: string;
  }> {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({ mime_type: 'video/mp4', size_bytes: 104857600 });

    expect(res.status).toBe(201);
    return res.body as { id: string; upload_id: string };
  }

  async function uploadSinglePart(token: string, id: string): Promise<string> {
    const partsRes = await request(app.getHttpServer())
      .post(`/videos/${id}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: [1] });
    expect(partsRes.status).toBe(200);

    const url = (
      partsRes.body as {
        parts: Array<{ part_number: number; url: string }>;
      }
    ).parts[0].url;
    const putResponse = await fetch(url, {
      method: 'PUT',
      body: Buffer.from('part-bytes'),
    });
    expect(putResponse.ok).toBe(true);

    return (putResponse.headers.get('etag') ?? '').replace(/"/g, '');
  }

  it('should complete an upload and return PROCESSING (AC #1)', async () => {
    const { token } = await createAuthenticatedChannel();
    const { id } = await initUpload(token);
    const etag = await uploadSinglePart(token, id);

    const res = await request(app.getHttpServer())
      .post(`/videos/${id}/upload/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ part_number: 1, etag }] });

    expect(res.status).toBe(200);
    const body = res.body as { id: string; status: string };
    expect(body.id).toBe(id);
    expect(body.status).toBe('PROCESSING');

    const video = await dataSource.getRepository(Video).findOneBy({ id });
    expect(video!.status).toBe('PROCESSING');
  });

  it('should reject complete outside UPLOADING (AC #2)', async () => {
    const { token, channel } = await createAuthenticatedChannel();

    await dataSource.getRepository(Video).save({
      id: 'processing1',
      channel_id: channel.id,
      mime_type: 'video/mp4',
      video_object_key: 'videos/processing1',
      upload_id: 'upload-x',
      status: VideoStatus.PROCESSING,
    });

    const res = await request(app.getHttpServer())
      .post('/videos/processing1/upload/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ part_number: 1, etag: 'etag1' }] });

    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('INVALID_UPLOAD_STATE');
  });

  it('should return 404 UPLOAD_NOT_FOUND for an unknown video (AC #4)', async () => {
    const { token } = await createAuthenticatedChannel();

    const res = await request(app.getHttpServer())
      .post('/videos/missing0001/upload/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ part_number: 1, etag: 'etag1' }] });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('UPLOAD_NOT_FOUND');
  });

  it('should abort an upload and persist FAILED (AC #3)', async () => {
    const { token } = await createAuthenticatedChannel();
    const { id } = await initUpload(token);

    const res = await request(app.getHttpServer())
      .post(`/videos/${id}/upload/abort`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(204);

    const video = await dataSource.getRepository(Video).findOneBy({ id });
    expect(video!.status).toBe('FAILED');
  });
});
