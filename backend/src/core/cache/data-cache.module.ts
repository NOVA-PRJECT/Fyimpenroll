import { Global, Module } from '@nestjs/common'
import { APP_INTERCEPTOR } from '@nestjs/core'
import { DataCacheService } from './data-cache.service'
import { DataCacheInterceptor } from './data-cache.interceptor'
@Global()
@Module({ providers: [DataCacheService, { provide: APP_INTERCEPTOR, useClass: DataCacheInterceptor }], exports: [DataCacheService] })
export class DataCacheModule {}
