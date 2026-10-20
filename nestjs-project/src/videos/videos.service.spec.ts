/* eslint-disable @typescript-eslint/unbound-method */
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';
import { InvalidUploadStateException } from './exceptions/invalid-upload-state.exception';
import { UploadNotFoundException } from './exceptions/upload-not-found.exception';
import { VideoNotReadyException } from './exceptions/video-not-ready.exception';
import { VideosService } from './videos.service';

describe('VideosService', () => {
  let service: VideosService;
  let videoRepository: jest.Mocked<Repository<Video>>;
  let channelRepository: jest.Mocked<Repository<Channel>>;
  let storage: jest.Mocked<StorageService>;
  let queue: jest.Mocked<Queue>;

  beforeEach(async () => {
    videoRepository = {
      create: jest.fn((entity) => entity as Video),
      save: jest.fn((entity) => entity as Video),
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Video>>;

    channelRepository = {
      findOne: jest.fn(),
    } as unknown as jest.Mocked<Repository<Channel>>;

    storage = {
      createMultipartUpload: jest.fn(),
      getPresignedPartUrls: jest.fn(),
      completeMultipartUpload: jest.fn(),
      abortMultipartUpload: jest.fn(),
      getPresignedGetUrl: jest.fn(),
      getClientGetUrl: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    queue = { add: jest.fn() } as unknown as jest.Mocked<Queue>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: getRepositoryToken(Channel), useValue: channelRepository },
        { provide: StorageService, useValue: storage },
        { provide: getQueueToken('video-processing'), useValue: queue },
      ],
    }).compile();

    service = moduleRef.get(VideosService);
  });

  it('should create a Video in UPLOADING and return id + upload_id', async () => {
    const channel = { id: 'channel-uuid' } as Channel;
    channelRepository.findOne.mockResolvedValue(channel);
    storage.createMultipartUpload.mockResolvedValue('upload-123');

    const result = await service.initUpload(
      { mime_type: 'video/mp4', size_bytes: 1000, title: 'Meu vídeo' },
      'user-1',
    );

    expect(result.id).toHaveLength(11);
    expect(result.upload_id).toBe('upload-123');

    expect(storage.createMultipartUpload).toHaveBeenCalledWith(
      `videos/${result.id}`,
      'video/mp4',
    );

    const saved = videoRepository.save.mock.calls[0][0];
    expect(saved.status).toBe(VideoStatus.UPLOADING);
    expect(saved.channel_id).toBe('channel-uuid');
    expect(saved.upload_id).toBe('upload-123');
    expect(saved.video_object_key).toBe(`videos/${result.id}`);
    expect(saved.mime_type).toBe('video/mp4');
    expect(saved.size_bytes).toBe(1000);
    expect(saved.title).toBe('Meu vídeo');
  });

  it('should throw when the authenticated user has no channel', async () => {
    channelRepository.findOne.mockResolvedValue(null);

    await expect(
      service.initUpload(
        { mime_type: 'video/mp4', size_bytes: 1000 },
        'user-1',
      ),
    ).rejects.toThrow('Channel not found for user user-1');
  });

  it('should throw UploadNotFoundException for a missing video id', async () => {
    videoRepository.findOne.mockResolvedValue(null);

    await expect(
      service.getPresignedPartUrls('missing-id', [1]),
    ).rejects.toThrow(UploadNotFoundException);
  });

  it('should throw UploadNotFoundException when upload_id is null', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      upload_id: null,
    } as Video);

    await expect(
      service.getPresignedPartUrls('vid12345678', [1]),
    ).rejects.toThrow(UploadNotFoundException);
  });

  it('should return one presigned part URL per part number', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      upload_id: 'upload-1',
      video_object_key: 'videos/vid12345678',
    } as Video);
    storage.getPresignedPartUrls.mockResolvedValue([
      { part_number: 1, url: 'http://minio:9000/part=1' },
      { part_number: 2, url: 'http://minio:9000/part=2' },
    ]);

    const parts = await service.getPresignedPartUrls('vid12345678', [1, 2]);

    expect(storage.getPresignedPartUrls).toHaveBeenCalledWith(
      'videos/vid12345678',
      'upload-1',
      [1, 2],
    );
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.part_number)).toEqual([1, 2]);
  });

  it('should complete an upload: transition to PROCESSING and enqueue', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      upload_id: 'upload-1',
      video_object_key: 'videos/vid12345678',
      status: VideoStatus.UPLOADING,
    } as Video);

    const result = await service.completeUpload('vid12345678', {
      parts: [{ part_number: 1, etag: 'etag1' }],
    });

    expect(result.status).toBe(VideoStatus.PROCESSING);
    expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
      'videos/vid12345678',
      'upload-1',
      [{ part_number: 1, etag: 'etag1' }],
    );
    expect(queue.add).toHaveBeenCalledWith('process', {
      videoId: 'vid12345678',
    });

    const saved = videoRepository.save.mock.calls[0][0];
    expect(saved.status).toBe(VideoStatus.PROCESSING);
  });

  it('should throw InvalidUploadStateException when completing outside UPLOADING', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      upload_id: 'upload-1',
      status: VideoStatus.PROCESSING,
    } as Video);

    await expect(
      service.completeUpload('vid12345678', {
        parts: [{ part_number: 1, etag: 'etag1' }],
      }),
    ).rejects.toThrow(InvalidUploadStateException);
  });

  it('should abort an upload: transition to FAILED', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      upload_id: 'upload-1',
      video_object_key: 'videos/vid12345678',
      status: VideoStatus.UPLOADING,
    } as Video);

    await service.abortUpload('vid12345678');

    expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
      'videos/vid12345678',
      'upload-1',
    );

    const saved = videoRepository.save.mock.calls[0][0];
    expect(saved.status).toBe(VideoStatus.FAILED);
  });

  it('should throw InvalidUploadStateException when aborting outside UPLOADING', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      upload_id: 'upload-1',
      status: VideoStatus.FAILED,
    } as Video);

    await expect(service.abortUpload('vid12345678')).rejects.toThrow(
      InvalidUploadStateException,
    );
  });

  it('should throw UploadNotFoundException for a missing video id in findById', async () => {
    videoRepository.findOne.mockResolvedValue(null);

    await expect(service.findById('missing-id')).rejects.toThrow(
      UploadNotFoundException,
    );
  });

  it('should return null thumbnail_url for a non-READY video', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      status: VideoStatus.UPLOADING,
      title: 'Draft',
      duration_seconds: null,
      thumbnail_object_key: 'videos/vid12345678/thumb.png',
    } as Video);

    const result = await service.findById('vid12345678');

    expect(result.thumbnail_url).toBeNull();
    expect(storage.getClientGetUrl).not.toHaveBeenCalled();
  });

  it('should return a presigned thumbnail_url for a READY video', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      status: VideoStatus.READY,
      title: 'Done',
      duration_seconds: 120.5,
      thumbnail_object_key: 'videos/vid12345678/thumb.png',
    } as Video);
    storage.getClientGetUrl.mockResolvedValue({
      url: 'http://minio:9000/thumb',
      expiresIn: 3600,
    });

    const result = await service.findById('vid12345678');

    expect(storage.getClientGetUrl).toHaveBeenCalledWith(
      'videos/vid12345678/thumb.png',
    );
    expect(result.thumbnail_url).toBe('http://minio:9000/thumb');
    expect(result.duration_seconds).toBe(120.5);
  });

  it('should throw VideoNotReadyException when streaming a non-READY video', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      status: VideoStatus.UPLOADING,
      video_object_key: 'videos/vid12345678',
    } as Video);

    await expect(service.getStreamUrl('vid12345678')).rejects.toThrow(
      VideoNotReadyException,
    );
  });

  it('should return a streaming URL for a READY video', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      status: VideoStatus.READY,
      video_object_key: 'videos/vid12345678',
    } as Video);
    storage.getClientGetUrl.mockResolvedValue({
      url: 'http://minio:9000/stream',
      expiresIn: 3600,
    });

    const result = await service.getStreamUrl('vid12345678');

    expect(storage.getClientGetUrl).toHaveBeenCalledWith('videos/vid12345678');
    expect(result).toEqual({
      url: 'http://minio:9000/stream',
      expires_in: 3600,
    });
  });

  it('should throw VideoNotReadyException when downloading a non-READY video', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      status: VideoStatus.PROCESSING,
      video_object_key: 'videos/vid12345678',
    } as Video);

    await expect(service.getDownloadUrl('vid12345678')).rejects.toThrow(
      VideoNotReadyException,
    );
  });

  it('should return a download URL with Content-Disposition attachment', async () => {
    videoRepository.findOne.mockResolvedValue({
      id: 'vid12345678',
      status: VideoStatus.READY,
      video_object_key: 'videos/vid12345678',
    } as Video);
    storage.getClientGetUrl.mockResolvedValue({
      url: 'http://minio:9000/download',
      expiresIn: 3600,
    });

    const result = await service.getDownloadUrl('vid12345678');

    expect(storage.getClientGetUrl).toHaveBeenCalledWith('videos/vid12345678', {
      contentDisposition: 'attachment',
    });
    expect(result).toEqual({ url: 'http://minio:9000/download' });
  });
});
