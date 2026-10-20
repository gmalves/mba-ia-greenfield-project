import type { Job } from 'bullmq';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import workerConfig from '../config/worker.config';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';
import { VideoProcessingConsumer } from './video-processing.consumer';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];
const FIXTURE_PATH = join(process.cwd(), 'test', 'fixtures', 'sample.mp4');

describe('VideoProcessingConsumer (integration)', () => {
  let dataSource: DataSource;
  let videoRepository: Repository<Video>;
  let storage: StorageService;
  let consumer: VideoProcessingConsumer;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    videoRepository = dataSource.getRepository(Video);

    storage = new StorageService(storageConfig());
    consumer = new VideoProcessingConsumer(
      videoRepository,
      storage,
      workerConfig(),
    );
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
    await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM "videos"');
    await cleanAllTables(dataSource);
  });

  it('probes a video, uploads a thumbnail, and marks READY', async () => {
    const user = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: 'worker@example.com',
        password: 'hashed',
      }),
    );
    const channel = await dataSource.getRepository(Channel).save(
      dataSource.getRepository(Channel).create({
        name: 'Worker',
        nickname: 'workerchan',
        user_id: user.id,
      }),
    );

    const videoId = 'workervid01';
    const objectKey = `videos/${videoId}`;

    const fixtureBuffer = await readFile(FIXTURE_PATH);
    await storage.putObject(objectKey, fixtureBuffer, 'video/mp4');

    await videoRepository.save(
      videoRepository.create({
        id: videoId,
        channel_id: channel.id,
        mime_type: 'video/mp4',
        video_object_key: objectKey,
        status: VideoStatus.PROCESSING,
      }),
    );

    await consumer.process({ data: { videoId } } as Job<{ videoId: string }>);

    const persisted = await videoRepository.findOneBy({ id: videoId });
    expect(persisted!.status).toBe(VideoStatus.READY);
    expect(persisted!.duration_seconds).toBeGreaterThan(0);
    expect(persisted!.width).toBe(64);
    expect(persisted!.height).toBe(64);
    expect(persisted!.thumbnail_object_key).toBe(
      `videos/${videoId}/thumbnail.png`,
    );
  });
});
