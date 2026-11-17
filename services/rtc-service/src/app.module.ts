import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { RtcModule } from './rtc/rtc.module';
import { LiveKitModule } from './livekit/livekit.module';
import { CallRecordModule } from './call-record/call-record.module';
import { ChatClientModule } from './grpc-clients/chat-client.module';
import { UserClientModule } from './grpc-clients/user-client.module';
import { NotificationClientModule } from './grpc-clients/notification-client.module';

@Module({
  imports: [
    // 配置模組
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NODE_ENV === 'production' ? '.env.prod' : '.env.dev',
    }),

    // MongoDB 連接
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),

    // 業務模組
    RtcModule,
    LiveKitModule,
    CallRecordModule,
    ChatClientModule,
    UserClientModule,
    NotificationClientModule,
  ],
})
export class AppModule {}
