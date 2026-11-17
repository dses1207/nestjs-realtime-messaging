import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { GrpcClientService } from './services/grpc-client.service';
import { UserController } from './controllers/user.controller';
import { ChatController } from './controllers/chat.controller';
import { FileController } from './controllers/file.controller';
import { NotificationController } from './controllers/notification.controller';
import { AuthController } from './controllers/auth.controller';
import { SystemMessageController } from './controllers/system-message.controller';
import { SystemPermissionController } from './controllers/system-permission.controller';
import { RtcController } from './controllers/rtc.controller';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SystemMessagePermissionGuard } from './guards/system-message-permission.guard';
import { WebSocketModule } from './websocket/websocket.module';
import { RtcClientModule } from './rtc-client/rtc-client.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'your-secret-key',
      signOptions: { expiresIn: '24h' },
    }),
    WebSocketModule,
    RtcClientModule,
  ],
  controllers: [
    AppController,
    UserController,
    ChatController,
    FileController,
    NotificationController,
    AuthController,
    SystemMessageController,
    SystemPermissionController,
    RtcController,
  ],
  providers: [
    AppService,
    GrpcClientService,
    JwtAuthGuard,
    SystemMessagePermissionGuard,
    {
      provide: 'CHAT_SERVICE',
      useFactory: () => {
        return ClientProxyFactory.create({
          transport: Transport.GRPC,
          options: {
            package: 'chat',
            protoPath: '/app/protos/chat.proto',
            url: 'chat-service:50053',
            maxReceiveMessageLength: 200 * 1024 * 1024,
            maxSendMessageLength: 200 * 1024 * 1024,
          },
        });
      },
    },
    {
      provide: 'USER_SERVICE',
      useFactory: () => {
        return ClientProxyFactory.create({
          transport: Transport.GRPC,
          options: {
            package: 'user',
            protoPath: '/app/protos/user.proto',
            url: 'user-service:50052',
            maxReceiveMessageLength: 200 * 1024 * 1024,
            maxSendMessageLength: 200 * 1024 * 1024,
          },
        });
      },
    },
  ],
})
export class AppModule {}
