import { INestApplication, ValidationPipe } from '@nestjs/common';
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

describe('GET /videos/:id/stream + /download (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
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

  async function seedChannel(): Promise<Channel> {
    const userRepository = dataSource.getRepository(User);
    const channelRepository = dataSource.getRepository(Channel);

    const user = await userRepository.save(
      userRepository.create({
        email: `sd_e2e_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: 'SD Channel',
        nickname: `sd_${Math.random().toString(36).slice(2, 10)}`,
        user_id: user.id,
      }),
    );
  }

  async function seedVideo(
    channel: Channel,
    data: { id: string } & Partial<Video>,
  ): Promise<Video> {
    const videoRepository = dataSource.getRepository(Video);
    return videoRepository.save(
      videoRepository.create({
        channel_id: channel.id,
        mime_type: 'video/mp4',
        video_object_key: `videos/${data.id}`,
        ...data,
      }),
    );
  }

  it('should return a streaming URL for a READY video (AC #1)', async () => {
    const channel = await seedChannel();
    const video = await seedVideo(channel, {
      id: 'readyvideo1',
      status: VideoStatus.READY,
    });

    const res = await request(app.getHttpServer()).get(
      `/videos/${video.id}/stream`,
    );

    expect(res.status).toBe(200);
    const body = res.body as { url: string; expires_in: number };
    expect(typeof body.url).toBe('string');
    expect(body.url).toContain('http');
    expect(body.expires_in).toBeGreaterThan(0);
  });

  it('should return 409 VIDEO_NOT_READY for a non-READY video (AC #3)', async () => {
    const channel = await seedChannel();
    const video = await seedVideo(channel, {
      id: 'uploadvid01',
      status: VideoStatus.UPLOADING,
    });

    const res = await request(app.getHttpServer()).get(
      `/videos/${video.id}/stream`,
    );

    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('VIDEO_NOT_READY');
  });

  it('should return 404 UPLOAD_NOT_FOUND for an unknown video (AC #4)', async () => {
    const res = await request(app.getHttpServer()).get(
      '/videos/missing0001/stream',
    );

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('UPLOAD_NOT_FOUND');
  });

  it('should return a download URL with attachment disposition (AC #2)', async () => {
    const channel = await seedChannel();
    const video = await seedVideo(channel, {
      id: 'readyvideo1',
      status: VideoStatus.READY,
    });

    const res = await request(app.getHttpServer()).get(
      `/videos/${video.id}/download`,
    );

    expect(res.status).toBe(200);
    const body = res.body as { url: string };
    expect(typeof body.url).toBe('string');
    expect(body.url).toContain('response-content-disposition=attachment');
  });
});
