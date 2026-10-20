import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { VideoProcessingModule } from './videos/video-processing.module';

@Module({
  imports: [AppModule, VideoProcessingModule],
})
class WorkerBootstrapModule {}

async function bootstrap(): Promise<void> {
  await NestFactory.createApplicationContext(WorkerBootstrapModule);
}

void bootstrap();
