import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { ChatClientService } from './chat-client.service';

@Module({
  imports: [
    ConfigModule,
    ClientsModule.registerAsync([
      {
        name: 'CHAT_SERVICE',
        imports: [ConfigModule],
        useFactory: async (configService: ConfigService) => ({
          transport: Transport.GRPC,
          options: {
            package: 'chat',
            protoPath: '/app/protos/chat.proto',
            url: configService.get<string>('CHAT_SERVICE_URL', 'chat-service:50053'),
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [ChatClientService],
  exports: [ChatClientService],
})
export class ChatClientModule {} 