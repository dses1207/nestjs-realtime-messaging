import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { NotificationController } from './controllers/notification.controller';
import { NotificationService } from './services/notification.service';
import { FCMService } from './services/fcm.service';
import { APNsService } from './services/apns.service';
import { TemplateService } from './services/template.service';
import { OnlineStatusService } from './services/online-status.service';
import { DeviceToken, DeviceTokenSchema } from './schemas/device-token.schema';
import { NotificationSettings, NotificationSettingsSchema } from './schemas/notification-settings.schema';
import { NotificationHistory, NotificationHistorySchema } from './schemas/notification-history.schema';
import { UserOnlineStatus, UserOnlineStatusSchema } from './schemas/user-online-status.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    ScheduleModule.forRoot(),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: DeviceToken.name, schema: DeviceTokenSchema },
      { name: NotificationSettings.name, schema: NotificationSettingsSchema },
      { name: NotificationHistory.name, schema: NotificationHistorySchema },
      { name: UserOnlineStatus.name, schema: UserOnlineStatusSchema },
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationService,
    FCMService,
    APNsService,
    TemplateService,
    OnlineStatusService,
  ],
})
export class AppModule {}