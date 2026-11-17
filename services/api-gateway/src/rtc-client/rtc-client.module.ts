import { Module } from '@nestjs/common';
import { RtcClientService } from './rtc-client.service';

@Module({
  providers: [RtcClientService],
  exports: [RtcClientService],
})
export class RtcClientModule {}
