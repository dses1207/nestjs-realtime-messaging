import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { WebSocketModule } from './websocket/websocket.module';
import { ChatClientModule } from './chat-client/chat-client.module';
import { RtcClientModule } from './rtc-client/rtc-client.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ScheduleModule.forRoot(),
    WebSocketModule,
    ChatClientModule,
    RtcClientModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {} 