import { Module } from '@nestjs/common';
import { WebSocketGateway } from './websocket.gateway';
import { ConnectionManagerService } from './connection-manager.service';
import { ChatClientModule } from '../chat-client/chat-client.module';
import { RtcClientModule } from '../rtc-client/rtc-client.module';
import { NotificationClientService } from '../notification-client/notification-client.service';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    ChatClientModule,
    RtcClientModule,
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'your-secret-key'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    WebSocketGateway,
    ConnectionManagerService,
    NotificationClientService
  ],
  exports: [
    WebSocketGateway,
    ConnectionManagerService,
    NotificationClientService
  ],
})
export class WebSocketModule {} 