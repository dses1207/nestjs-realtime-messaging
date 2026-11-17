import { Module } from '@nestjs/common';
import { ChatClientService } from './chat-client.service';

@Module({
  providers: [ChatClientService],
  exports: [ChatClientService],
})
export class ChatClientModule {}
