/* eslint-disable @typescript-eslint/unbound-method */
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import storageConfig from '../config/storage.config';
import { StorageService } from '../storage/storage.service';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { User } from '../users/entities/user.entity';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('VideosService (integration)', () => {
  let dataSource: DataSource;
  let videosService: VideosService;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;
  let queue: jest.Mocked<Queue>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);

    const storage = new StorageService(storageConfig());
    queue = { add: jest.fn() } as unknown as jest.Mocked<Queue>;
    videosService = new VideosService(
      videoRepository,
      channelRepository,
      storage,
      queue,
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
    jest.clearAllMocks();
  });

  let counter = 0;
  async function createUserAndChannel(): Promise<{
    user: User;
    channel: Channel;
  }> {
    const user = await userRepository.save(
      userRepository.create({
        email: `vidsvc_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    const channel = await channelRepository.save(
      channelRepository.create({
        name: `Chan ${counter}`,
        nickname: `vidsvc_${counter}`,
        user_id: user.id,
      }),
    );
    return { user, channel };
  }

  it('persists a Video in UPLOADING with channel_id and upload_id', async () => {
    const { user, channel } = await createUserAndChannel();

    const result = await videosService.initUpload(
      { mime_type: 'video/mp4', size_bytes: 1024, title: 'Integration' },
      user.id,
    );

    expect(result.id).toHaveLength(11);
    expect(result.upload_id).toBeTruthy();

    const persisted = await videoRepository.findOneBy({ id: result.id });
    expect(persisted).not.toBeNull();
    expect(persisted!.status).toBe(VideoStatus.UPLOADING);
    expect(persisted!.channel_id).toBe(channel.id);
    expect(persisted!.upload_id).toBe(result.upload_id);
    expect(persisted!.video_object_key).toBe(`videos/${result.id}`);
  });

  it('generates presigned part URLs for a UPLOADING video', async () => {
    const { user } = await createUserAndChannel();
    const init = await videosService.initUpload(
      { mime_type: 'video/mp4', size_bytes: 1024 },
      user.id,
    );

    const parts = await videosService.getPresignedPartUrls(init.id, [1, 2]);

    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.part_number)).toEqual([1, 2]);
    for (const part of parts) {
      expect(part.url).toContain('http');
    }
  });

  it('completes an upload: transitions to PROCESSING and enqueues a job', async () => {
    const { user } = await createUserAndChannel();
    const init = await videosService.initUpload(
      { mime_type: 'video/mp4', size_bytes: 1024 },
      user.id,
    );

    const [part] = await videosService.getPresignedPartUrls(init.id, [1]);
    const putResponse = await fetch(part.url, {
      method: 'PUT',
      body: Buffer.from('part-bytes'),
    });
    expect(putResponse.ok).toBe(true);
    const etag = (putResponse.headers.get('etag') ?? '').replace(/"/g, '');

    const result = await videosService.completeUpload(init.id, {
      parts: [{ part_number: 1, etag }],
    });

    expect(result.status).toBe(VideoStatus.PROCESSING);
    expect(queue.add).toHaveBeenCalledWith('process', { videoId: init.id });

    const persisted = await videoRepository.findOneBy({ id: init.id });
    expect(persisted!.status).toBe(VideoStatus.PROCESSING);
  });

  it('aborts an upload: transitions to FAILED', async () => {
    const { user } = await createUserAndChannel();
    const init = await videosService.initUpload(
      { mime_type: 'video/mp4', size_bytes: 1024 },
      user.id,
    );

    await videosService.abortUpload(init.id);

    const persisted = await videoRepository.findOneBy({ id: init.id });
    expect(persisted!.status).toBe(VideoStatus.FAILED);
  });

  it('returns status and metadata for a persisted video', async () => {
    const { user } = await createUserAndChannel();
    const init = await videosService.initUpload(
      { mime_type: 'video/mp4', size_bytes: 1024, title: 'Status Test' },
      user.id,
    );

    const result = await videosService.findById(init.id);

    expect(result.id).toBe(init.id);
    expect(result.status).toBe(VideoStatus.UPLOADING);
    expect(result.title).toBe('Status Test');
    expect(result.duration_seconds).toBeNull();
    expect(result.thumbnail_url).toBeNull();
  });

  it('generates presigned GET URLs for a READY video', async () => {
    const { channel } = await createUserAndChannel();
    const video = await videoRepository.save(
      videoRepository.create({
        id: 'readyvideo1',
        channel_id: channel.id,
        mime_type: 'video/mp4',
        video_object_key: 'videos/readyvideo1',
        status: VideoStatus.READY,
      }),
    );

    const stream = await videosService.getStreamUrl(video.id);
    expect(stream.url).toContain('http');
    expect(stream.expires_in).toBeGreaterThan(0);

    const download = await videosService.getDownloadUrl(video.id);
    expect(download.url).toContain('http');
  });
});
