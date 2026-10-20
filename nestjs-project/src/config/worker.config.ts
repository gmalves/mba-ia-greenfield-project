import { registerAs } from '@nestjs/config';

export default registerAs('worker', () => ({
  concurrency: parseInt(process.env.WORKER_CONCURRENCY || '1', 10),
  tmpDir: process.env.WORKER_TMP_DIR || '/tmp/streamtube',
}));
