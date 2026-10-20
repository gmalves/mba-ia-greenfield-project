import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const MAX_VIDEO_SIZE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GiB

export class CreateVideoDto {
  /** Draft title (optional; filled later in Fase 04). */
  @IsOptional()
  @IsString()
  title?: string;

  /** Video content type (e.g. "video/mp4"). */
  @IsString()
  @IsNotEmpty()
  mime_type: string;

  /** Total size in bytes (max 10 GiB). */
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_SIZE_BYTES)
  size_bytes: number;
}
