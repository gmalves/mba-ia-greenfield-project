import { DataSource, Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import { User } from '../../users/entities/user.entity';
import { VideoStatus } from './video-status.enum';
import { Video } from './video.entity';

const ALL_ENTITIES = [User, Channel, Video, RefreshToken, VerificationToken];

describe('Video entity (integration)', () => {
  let dataSource: DataSource;
  let userRepository: Repository<User>;
  let channelRepository: Repository<Channel>;
  let videoRepository: Repository<Video>;

  beforeAll(async () => {
    dataSource = createTestDataSource(ALL_ENTITIES);
    await dataSource.initialize();
    userRepository = dataSource.getRepository(User);
    channelRepository = dataSource.getRepository(Channel);
    videoRepository = dataSource.getRepository(Video);
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

  let counter = 0;
  let videoCounter = 0;

  async function createChannel(): Promise<Channel> {
    const user = await userRepository.save(
      userRepository.create({
        email: `video_user_${++counter}@example.com`,
        password: 'hashed',
      }),
    );
    return channelRepository.save(
      channelRepository.create({
        name: `Channel ${counter}`,
        nickname: `video_chan_${counter}`,
        user_id: user.id,
      }),
    );
  }

  function nextVideoId(): string {
    return `vid${String(++videoCounter).padStart(8, '0')}`;
  }

  function videoData(channelId: string): {
    id: string;
    channel_id: string;
    mime_type: string;
    video_object_key: string;
  } {
    const id = nextVideoId();
    return {
      id,
      channel_id: channelId,
      mime_type: 'video/mp4',
      video_object_key: `videos/${id}/original.mp4`,
    };
  }

  it('should default status to UPLOADING', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create(videoData(channel.id)),
    );

    expect(video.status).toBe(VideoStatus.UPLOADING);
  });

  it('should reject an invalid status value', async () => {
    const channel = await createChannel();

    await expect(
      videoRepository.save(
        videoRepository.create({
          ...videoData(channel.id),
          status: 'INVALID' as VideoStatus,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should enforce not-null on required fields', async () => {
    const channel = await createChannel();

    await expect(
      videoRepository.save(
        videoRepository.create({
          id: nextVideoId(),
          channel_id: channel.id,
        }),
      ),
    ).rejects.toThrow();
  });

  it('should enforce the channel_id foreign key', async () => {
    await expect(
      videoRepository.save(
        videoRepository.create({
          ...videoData('00000000-0000-0000-0000-000000000000'),
        }),
      ),
    ).rejects.toThrow();
  });

  it('should auto-set created_at and updated_at timestamps', async () => {
    const channel = await createChannel();
    const video = await videoRepository.save(
      videoRepository.create(videoData(channel.id)),
    );

    expect(video.created_at).toBeInstanceOf(Date);
    expect(video.updated_at).toBeInstanceOf(Date);
  });

  it('should load the related channel via the ManyToOne relation', async () => {
    const channel = await createChannel();
    await videoRepository.save(videoRepository.create(videoData(channel.id)));

    const found = await videoRepository.findOne({
      where: { channel_id: channel.id },
      relations: ['channel'],
    });

    expect(found?.channel.name).toBe(channel.name);
  });
});
