import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoStatus } from './video-status.enum';

@Entity('videos')
export class Video {
  @PrimaryColumn({ type: 'varchar', length: 11 })
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @Index()
  @Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.UPLOADING })
  status: VideoStatus;

  @Column({ type: 'varchar' })
  mime_type: string;

  @Column({
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: unknown): number | null =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  size_bytes: number | null;

  @Column({
    type: 'numeric',
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: unknown): number | null =>
        value === null || value === undefined ? null : Number(value),
    },
  })
  duration_seconds: number | null;

  @Column({ type: 'integer', nullable: true })
  width: number | null;

  @Column({ type: 'integer', nullable: true })
  height: number | null;

  @Column({ type: 'varchar' })
  video_object_key: string;

  @Column({ type: 'varchar', nullable: true })
  thumbnail_object_key: string | null;

  @Column({ type: 'varchar', nullable: true })
  upload_id: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
