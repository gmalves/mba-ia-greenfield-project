import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import type { PresignedPart } from '../storage/storage.service';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { UploadPartsDto } from './dto/upload-parts.dto';
import type { VideoStatus } from './entities/video-status.enum';
import { VideosService, type VideoStatusResponse } from './videos.service';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Initialize a video upload',
    description:
      'Pre-registers a video as a draft (UPLOADING) and creates the multipart upload in object storage, returning the video id and the S3 UploadId.',
  })
  @ApiResponse({
    status: 201,
    description: 'Upload initialized',
    schema: {
      properties: {
        id: { type: 'string' },
        upload_id: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async initUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<{ id: string; upload_id: string }> {
    return this.videosService.initUpload(dto, user.sub);
  }

  @Post(':id/upload/parts')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Issue presigned upload part URLs',
    description:
      'Returns a presigned PUT URL per requested part number so the client can upload bytes directly to object storage.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned part URLs',
    schema: {
      properties: {
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              part_number: { type: 'number' },
              url: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video or upload session not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getPresignedPartUrls(
    @Param('id') id: string,
    @Body() dto: UploadPartsDto,
  ): Promise<{ parts: PresignedPart[] }> {
    const parts = await this.videosService.getPresignedPartUrls(
      id,
      dto.part_numbers,
    );
    return { parts };
  }

  @Post(':id/upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Complete a multipart upload',
    description:
      'Finalizes the S3 multipart upload, transitions the video to PROCESSING and enqueues the processing job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload completed and processing enqueued',
    schema: {
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['PROCESSING'] },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video or upload session not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in the UPLOADING state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async completeUpload(
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ): Promise<{ id: string; status: VideoStatus }> {
    return this.videosService.completeUpload(id, dto);
  }

  @Post(':id/upload/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Abort a multipart upload',
    description:
      'Discards the S3 multipart upload and marks the video as FAILED.',
  })
  @ApiResponse({ status: 204, description: 'Upload aborted' })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video or upload session not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not in the UPLOADING state',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async abortUpload(@Param('id') id: string): Promise<void> {
    await this.videosService.abortUpload(id);
  }

  @Get(':id')
  @ApiBearerAuth('access-token')
  @ApiParam({ name: 'id', description: 'Video id' })
  @ApiOperation({
    summary: 'Get video status',
    description:
      'Returns the current status and metadata of a video, including a presigned thumbnail URL when the video is READY.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video status',
    schema: {
      properties: {
        id: { type: 'string' },
        status: {
          type: 'string',
          enum: ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'],
        },
        title: { type: 'string', nullable: true },
        duration_seconds: { type: 'number', nullable: true },
        thumbnail_url: { type: 'string', nullable: true },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async findById(@Param('id') id: string): Promise<VideoStatusResponse> {
    return this.videosService.findById(id);
  }

  @Public()
  @Get(':id/stream')
  @ApiParam({ name: 'id', description: 'Video id' })
  @ApiOperation({
    summary: 'Get a presigned streaming URL',
    description:
      'Returns a short-lived presigned GET URL compatible with HTTP Range so the client streams directly from object storage.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned streaming URL',
    schema: {
      properties: {
        url: { type: 'string' },
        expires_in: { type: 'number' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getStreamUrl(
    @Param('id') id: string,
  ): Promise<{ url: string; expires_in: number }> {
    return this.videosService.getStreamUrl(id);
  }

  @Public()
  @Get(':id/download')
  @ApiParam({ name: 'id', description: 'Video id' })
  @ApiOperation({
    summary: 'Get a presigned download URL',
    description:
      'Returns a short-lived presigned GET URL with a Content-Disposition: attachment so the client downloads the video.',
  })
  @ApiResponse({
    status: 200,
    description: 'Presigned download URL',
    schema: {
      properties: {
        url: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async getDownloadUrl(@Param('id') id: string): Promise<{ url: string }> {
    return this.videosService.getDownloadUrl(id);
  }
}
