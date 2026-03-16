import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import { APP_ENV, type AppEnv } from '../../config/env.js';
import { GENERATE_IMAGE_QUEUE } from './queue.constants.js';
import { QueueConnectionService } from './queue-connection.service.js';

@Global()
@Module({
  providers: [
    QueueConnectionService,
    {
      provide: GENERATE_IMAGE_QUEUE,
      inject: [QueueConnectionService, APP_ENV],
      useFactory: (connectionService: QueueConnectionService, env: AppEnv) =>
        new Queue(env.QUEUE_NAME_GENERATE_IMAGE, {
          connection: connectionService.connection,
        }),
    },
  ],
  exports: [QueueConnectionService, GENERATE_IMAGE_QUEUE],
})
export class QueueModule {}
