import { Module } from '@nestjs/common';
import { RtcController } from './rtc.controller';
import { RtcService } from './rtc.service';
import { LiveKitModule } from '../livekit/livekit.module';
import { CallRecordModule } from '../call-record/call-record.module';
import { ChatClientModule } from '../grpc-clients/chat-client.module';
import { UserClientModule } from '../grpc-clients/user-client.module';
import { NotificationClientModule } from '../grpc-clients/notification-client.module';

@Module({
  imports: [
    LiveKitModule,
    CallRecordModule,
    ChatClientModule,
    UserClientModule,
    NotificationClientModule,
  ],
  controllers: [RtcController],
  providers: [RtcService],
  exports: [RtcService],
})
export class RtcModule {}
