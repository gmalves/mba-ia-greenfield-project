import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { nanoid } from 'nanoid';
import { Repository } from 'typeorm';
import { Channel } from '../channels/entities/channel.entity';
import { StorageService, type PresignedPart } from '../storage/storage.service';
import type { CompleteUploadDto } from './dto/complete-upload.dto';
import type { CreateVideoDto } from './dto/create-video.dto';
import { VideoStatus } from './entities/video-status.enum';
import { Video } from './entities/video.entity';
import { InvalidUploadStateException } from './exceptions/invalid-upload-state.exception';
import { UploadNotFoundException } from './exceptions/upload-not-found.exception';
import { VideoNotReadyException } from './exceptions/video-not-ready.exception';

export interface VideoStatusResponse {
  id: string;
  status: VideoStatus;
  title: string | null;
  duration_seconds: number | null;
  thumbnail_url: string | null;
}

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
    @InjectRepository(Channel)
    private readonly channelRepository: Repository<Channel>,
    private readonly storage: StorageService,
    @InjectQueue('video-processing')
    private readonly videoProcessingQueue: Queue,
  ) {}

  async initUpload(
    dto: CreateVideoDto,
    userId: string,
  ): Promise<{ id: string; upload_id: string }> {
    const channel = await this.channelRepository.findOne({
      where: { user_id: userId },
    });
    if (!channel) {
      throw new Error(`Channel not found for user ${userId}`);
    }

    const id = nanoid(11);
    const videoObjectKey = `videos/${id}`;

    const uploadId = await this.storage.createMultipartUpload(
      videoObjectKey,
      dto.mime_type,
    );

    const video = this.videoRepository.create({
      id,
      channel_id: channel.id,
      title: dto.title ?? null,
      status: VideoStatus.UPLOADING,
      mime_type: dto.mime_type,
      size_bytes: dto.size_bytes,
      video_object_key: videoObjectKey,
      upload_id: uploadId,
    });
    await this.videoRepository.save(video);

    return { id, upload_id: uploadId };
  }

  async getPresignedPartUrls(
    id: string,
    partNumbers: number[],
  ): Promise<PresignedPart[]> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video || video.upload_id === null) {
      throw new UploadNotFoundException();
    }

    return this.storage.getPresignedPartUrls(
      video.video_object_key,
      video.upload_id,
      partNumbers,
    );
  }

  async completeUpload(
    id: string,
    dto: CompleteUploadDto,
  ): Promise<{ id: string; status: VideoStatus }> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video || video.upload_id === null) {
      throw new UploadNotFoundException();
    }
    if (video.status !== VideoStatus.UPLOADING) {
      throw new InvalidUploadStateException();
    }

    await this.storage.completeMultipartUpload(
      video.video_object_key,
      video.upload_id,
      dto.parts,
    );

    video.status = VideoStatus.PROCESSING;
    await this.videoRepository.save(video);

    await this.videoProcessingQueue.add('process', { videoId: id });

    return { id, status: VideoStatus.PROCESSING };
  }

  async abortUpload(id: string): Promise<void> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video || video.upload_id === null) {
      throw new UploadNotFoundException();
    }
    if (video.status !== VideoStatus.UPLOADING) {
      throw new InvalidUploadStateException();
    }

    await this.storage.abortMultipartUpload(
      video.video_object_key,
      video.upload_id,
    );

    video.status = VideoStatus.FAILED;
    await this.videoRepository.save(video);
  }

  async findById(id: string): Promise<VideoStatusResponse> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video) {
      throw new UploadNotFoundException();
    }

    let thumbnailUrl: string | null = null;
    if (
      video.status === VideoStatus.READY &&
      video.thumbnail_object_key !== null
    ) {
      thumbnailUrl = (
        await this.storage.getClientGetUrl(video.thumbnail_object_key)
      ).url;
    }

    return {
      id: video.id,
      status: video.status,
      title: video.title,
      duration_seconds: video.duration_seconds,
      thumbnail_url: thumbnailUrl,
    };
  }

  async getStreamUrl(id: string): Promise<{ url: string; expires_in: number }> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video) {
      throw new UploadNotFoundException();
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    const { url, expiresIn } = await this.storage.getClientGetUrl(
      video.video_object_key,
    );
    return { url, expires_in: expiresIn };
  }

  async getDownloadUrl(id: string): Promise<{ url: string }> {
    const video = await this.videoRepository.findOne({ where: { id } });
    if (!video) {
      throw new UploadNotFoundException();
    }
    if (video.status !== VideoStatus.READY) {
      throw new VideoNotReadyException();
    }

    const { url } = await this.storage.getClientGetUrl(video.video_object_key, {
      contentDisposition: 'attachment',
    });
    return { url };
  }
}
