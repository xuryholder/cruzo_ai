import { Global, Module } from '@nestjs/common';
import { APP_ENV, loadEnv } from './env.js';

@Global()
@Module({
  providers: [
    {
      provide: APP_ENV,
      useValue: loadEnv(),
    },
  ],
  exports: [APP_ENV],
})
export class EnvModule {}
