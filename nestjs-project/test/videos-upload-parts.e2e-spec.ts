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

describe('POST /videos/:id/upload/parts (e2e)', () => {
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
        email: `parts_e2e_${Date.now()}_${Math.random().toString(36).slice(2)}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: 'Parts Channel',
        nickname: `pc_${Math.random().toString(36).slice(2, 10)}`,
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

  it('should sign one presigned URL per requested part (200)', async () => {
    const { token } = await createAuthenticatedChannel();
    const { id } = await initUpload(token);

    const res = await request(app.getHttpServer())
      .post(`/videos/${id}/upload/parts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: [1, 2] });

    expect(res.status).toBe(200);
    const body = res.body as {
      parts: Array<{ part_number: number; url: string }>;
    };
    expect(body.parts).toHaveLength(2);
    expect(body.parts[0].part_number).toBe(1);
    expect(body.parts[0].url).toEqual(expect.any(String));
    expect(body.parts[1].part_number).toBe(2);
  });

  it('should return 404 UPLOAD_NOT_FOUND for an unknown video', async () => {
    const { token } = await createAuthenticatedChannel();

    const res = await request(app.getHttpServer())
      .post('/videos/unknown0001/upload/parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: [1] });

    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toBe('UPLOAD_NOT_FOUND');
  });

  it('should return 400 VALIDATION_ERROR for empty part_numbers', async () => {
    const { token } = await createAuthenticatedChannel();

    const res = await request(app.getHttpServer())
      .post('/videos/unknown0001/upload/parts')
      .set('Authorization', `Bearer ${token}`)
      .send({ part_numbers: [] });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('VALIDATION_ERROR');
  });
});
