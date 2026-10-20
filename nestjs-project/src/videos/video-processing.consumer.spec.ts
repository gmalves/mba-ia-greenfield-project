/* eslint-disable @typescript-eslint/unbound-method */
import type { ConfigType } from '@nestjs/config';
import { UnrecoverableError, type Job } from 'bullmq';
import { Repository } from 'typeorm';
import workerConfig from '../config/worker.config';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';
import { VideoProcessingConsumer } from './video-processing.consumer';

jest.mock('fluent-ffmpeg', () => {
  const command = {
    seekInput: jest.fn(),
    outputOptions: jest.fn(),
    screenshots: jest.fn(),
    on: jest.fn(),
  };
  command.seekInput.mockReturnValue(command);
  command.outputOptions.mockReturnValue(command);
  command.screenshots.mockReturnValue(command);
  command.on.mockImplementation((event: string, cb: (arg: unknown) => void) => {
    if (event === 'filenames') {
      cb(['thumb.png']);
    }
    return command;
  });

  const ffmpeg = jest.fn(() => command);
  const ffprobe = jest.fn(
    (_input: string, callback: (err: Error | null, data: unknown) => void) => {
      callback(null, {
        streams: [{ codec_type: 'video', width: 64, height: 64 }],
        format: { duration: '1.0' },
      });
    },
  );
  (ffmpeg as unknown as { ffprobe: unknown }).ffprobe = ffprobe;

  return { __esModule: true, default: ffmpeg };
});

jest.mock('node:fs/promises', () => ({
  mkdir: jest.fn().mockResolvedValue(undefined),
  readFile: jest.fn().mockResolvedValue(Buffer.from('fake-thumbnail')),
}));

describe('VideoProcessingConsumer', () => {
  let consumer: VideoProcessingConsumer;
  let videoRepository: jest.Mocked<Repository<Video>>;
  let storage: jest.Mocked<StorageService>;

  beforeEach(() => {
    videoRepository = {
      findOne: jest.fn(),
      save: jest.fn((entity) => entity as Video),
    } as unknown as jest.Mocked<Repository<Video>>;

    storage = {
      getPresignedGetUrl: jest.fn(),
      putObject: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    consumer = new VideoProcessingConsumer(videoRepository, storage, {
      tmpDir: '/tmp/streamtube',
    } as ConfigType<typeof workerConfig>);
  });

  it('probes, generates a thumbnail, uploads it, and marks READY', async () => {
    const video = {
      id: 'vid12345678',
      status: VideoStatus.PROCESSING,
      video_object_key: 'videos/vid12345678',
    } as Video;
    videoRepository.findOne.mockResolvedValue(video);
    storage.getPresignedGetUrl.mockResolvedValue({
      url: 'http://minio:9000/v',
      expiresIn: 3600,
    });

    await consumer.process({
      data: { videoId: 'vid12345678' },
    } as Job<{ videoId: string }>);

    expect(video.status).toBe(VideoStatus.READY);
    expect(video.width).toBe(64);
    expect(video.height).toBe(64);
    expect(video.duration_seconds).toBe(1);
    expect(video.thumbnail_object_key).toBe('videos/vid12345678/thumbnail.png');
    expect(storage.putObject).toHaveBeenCalledWith(
      'videos/vid12345678/thumbnail.png',
      expect.any(Buffer),
      'image/png',
    );
    expect(videoRepository.save).toHaveBeenCalledWith(video);
  });

  it('marks FAILED and throws UnrecoverableError when ffprobe fails', async () => {
    const video = {
      id: 'vid12345678',
      status: VideoStatus.PROCESSING,
      video_object_key: 'videos/vid12345678',
    } as Video;
    videoRepository.findOne.mockResolvedValue(video);
    storage.getPresignedGetUrl.mockResolvedValue({
      url: 'http://minio:9000/v',
      expiresIn: 3600,
    });

    const ffmpegModule = jest.requireMock<{
      default: { ffprobe: jest.Mock };
    }>('fluent-ffmpeg');
    ffmpegModule.default.ffprobe.mockImplementationOnce(
      (_input: string, callback: (err: Error | null) => void) => {
        callback(new Error('Invalid data found'));
      },
    );

    await expect(
      consumer.process({
        data: { videoId: 'vid12345678' },
      } as Job<{ videoId: string }>),
    ).rejects.toThrow(UnrecoverableError);

    expect(video.status).toBe(VideoStatus.FAILED);
    expect(videoRepository.save).toHaveBeenCalledWith(video);
  });
});
