import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageModule } from '../storage/storage.module';
import { Video } from './entities/video.entity';
import { VideoProcessingConsumer } from './video-processing.consumer';

@Module({
  imports: [TypeOrmModule.forFeature([Video]), StorageModule],
  providers: [VideoProcessingConsumer],
})
export class VideoProcessingModule {}
