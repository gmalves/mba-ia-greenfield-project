import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import queueConfig from '../config/queue.config';
import { QueuesModule } from './queues.module';

describe('QueuesModule', () => {
  it('should compile with the configured queue connection', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [queueConfig] }),
        QueuesModule,
      ],
    }).compile();

    expect(moduleRef.get(QueuesModule)).toBeDefined();

    await moduleRef.close();
  });
});
