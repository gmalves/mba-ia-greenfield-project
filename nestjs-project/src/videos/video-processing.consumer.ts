import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { UnrecoverableError, type Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Repository } from 'typeorm';
import workerConfig from '../config/worker.config';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
}

interface FfprobeData {
  streams: FfprobeStream[];
  format: { duration?: string };
}

function ffprobeAsync(input: string): Promise<FfprobeData> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(input, (err, data) => {
      if (err) {
        reject(err as Error);
      } else {
        resolve(data as FfprobeData);
      }
    });
  });
}

@Processor('video-processing', { concurrency: 1 })
export class VideoProcessingConsumer extends WorkerHost {
  private readonly tmpDir: string;

  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    private readonly storage: StorageService,
    @Inject(workerConfig.KEY)
    worker: ConfigType<typeof workerConfig>,
  ) {
    super();
    this.tmpDir = worker.tmpDir;
  }

  async process(job: Job<{ videoId: string }>): Promise<void> {
    const videoId = job.data.videoId;
    const video = await this.videoRepository.findOne({
      where: { id: videoId },
    });
    if (!video) {
      throw new Error(`Video ${videoId} not found`);
    }

    const { url } = await this.storage.getPresignedGetUrl(
      video.video_object_key,
    );

    let metadata: FfprobeData;
    try {
      metadata = await ffprobeAsync(url);
    } catch {
      await this.markFailed(video);
      throw new UnrecoverableError(`ffprobe failed for video ${videoId}`);
    }

    const videoStream = metadata.streams.find((s) => s.codec_type === 'video');
    if (!videoStream) {
      await this.markFailed(video);
      throw new UnrecoverableError(`No video stream for video ${videoId}`);
    }

    const thumbnailKey = `videos/${videoId}/thumbnail.png`;
    await mkdir(this.tmpDir, { recursive: true });
    const thumbnailPath = await this.extractThumbnail(url, videoId);
    const thumbnailBuffer = await readFile(thumbnailPath);
    await this.storage.putObject(thumbnailKey, thumbnailBuffer, 'image/png');

    video.duration_seconds = metadata.format.duration
      ? Number(metadata.format.duration)
      : null;
    video.width = videoStream.width ?? null;
    video.height = videoStream.height ?? null;
    video.thumbnail_object_key = thumbnailKey;
    video.status = VideoStatus.READY;
    await this.videoRepository.save(video);
  }

  private async markFailed(video: Video): Promise<void> {
    video.status = VideoStatus.FAILED;
    await this.videoRepository.save(video);
  }

  private extractThumbnail(inputUrl: string, videoId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      ffmpeg(inputUrl)
        .seekInput(0)
        .outputOptions('-frames:v', '1')
        .screenshots({
          count: 1,
          folder: this.tmpDir,
          filename: `${videoId}.png`,
          size: '1280x?',
        })
        .on('filenames', (files: string[]) => {
          resolve(join(this.tmpDir, files[0]));
        })
        .on('error', (err: Error) => {
          reject(err);
        });
    });
  }
}
