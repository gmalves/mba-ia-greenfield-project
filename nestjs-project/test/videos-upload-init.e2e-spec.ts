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
import { Video } from '../src/videos/entities/video.entity';

describe('POST /videos (e2e)', () => {
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
        email: `video_e2e_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Video Channel',
        nickname: `vc_${Math.random().toString(36).slice(2, 10)}`,
        user_id: user.id,
      }),
    );
    const token = await jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return { token, channel };
  }

  it('should initialize an upload and persist a UPLOADING video (201)', async () => {
    const { token, channel } = await createAuthenticatedChannel();

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        mime_type: 'video/mp4',
        size_bytes: 104857600,
        title: 'Meu vídeo',
      });

    expect(res.status).toBe(201);
    const body = res.body as { id: string; upload_id: string };
    expect(typeof body.id).toBe('string');
    expect(body.id).not.toHaveLength(0);
    expect(typeof body.upload_id).toBe('string');
    expect(body.upload_id).not.toHaveLength(0);

    const video = await dataSource
      .getRepository(Video)
      .findOneBy({ id: body.id });
    expect(video).not.toBeNull();
    expect(video!.status).toBe('UPLOADING');
    expect(video!.channel_id).toBe(channel.id);
  });

  it('should reject an oversized video (400)', async () => {
    const { token } = await createAuthenticatedChannel();

    const res = await request(app.getHttpServer())
      .post('/videos')
      .set('Authorization', `Bearer ${token}`)
      .send({ mime_type: 'video/mp4', size_bytes: 10737418241 });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('VALIDATION_ERROR');
  });

  it('should reject an unauthenticated request (401)', async () => {
    const res = await request(app.getHttpServer())
      .post('/videos')
      .send({ mime_type: 'video/mp4', size_bytes: 104857600 });

    expect(res.status).toBe(401);
  });
});
