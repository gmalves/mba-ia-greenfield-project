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

describe('GET /videos/:id (e2e)', () => {
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
        email: `st_e2e_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Status Channel',
        nickname: `st_${Math.random().toString(36).slice(2, 10)}`,
        user_id: user.id,
      }),
    );
    const token = await jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return { token, channel };
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

  it('should return video status and metadata (AC #1)', async () => {
    const { token, channel } = await createAuthenticatedChannel();
    const video = await seedVideo(channel, {
      id: 'uploadvid01',
      status: VideoStatus.UPLOADING,
      title: 'Draft video',
    });

    const res = await request(app.getHttpServer())
      .get(`/videos/${video.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: video.id,
      status: 'UPLOADING',
      title: 'Draft video',
      duration_seconds: null,
      thumbnail_url: null,
    });
  });

  it('should return 404 UPLOAD_NOT_FOUND for an unknown video (AC #2)', async () => {
    const { token } = await createAuthenticatedChannel();

    const res = await request(app.getHttpServer())
      .get('/videos/missing0001')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('UPLOAD_NOT_FOUND');
  });

  it('should return a thumbnail_url only when READY (AC #3)', async () => {
    const { token, channel } = await createAuthenticatedChannel();

    const uploading = await seedVideo(channel, {
      id: 'uploadvid01',
      status: VideoStatus.UPLOADING,
      title: 'Uploading',
    });
    const uploadingRes = await request(app.getHttpServer())
      .get(`/videos/${uploading.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(uploadingRes.status).toBe(200);
    expect(
      (uploadingRes.body as { thumbnail_url: string | null }).thumbnail_url,
    ).toBeNull();

    const ready = await seedVideo(channel, {
      id: 'readyvideo1',
      status: VideoStatus.READY,
      title: 'Ready',
      duration_seconds: 120.5,
      thumbnail_object_key: 'videos/readyvideo1/thumb.png',
    });
    const readyRes = await request(app.getHttpServer())
      .get(`/videos/${ready.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(readyRes.status).toBe(200);
    expect(
      (readyRes.body as { thumbnail_url: string | null }).thumbnail_url,
    ).toBeTruthy();
    expect(
      (readyRes.body as { duration_seconds: number | null }).duration_seconds,
    ).toBe(120.5);
  });
});
