import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ClientGrpc, Client, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { Observable, firstValueFrom } from 'rxjs';

interface ChatService {
  checkUserInConversation(data: {
    userId: string;
    conversationId: string;
  }): Observable<{
    success: boolean;
    hasAccess: boolean;
    message: string;
  }>;
}

@Injectable()
export class ChatClientService implements OnModuleInit {
  private readonly logger = new Logger(ChatClientService.name);
  private chatService: ChatService;

  @Client({
    transport: Transport.GRPC,
    options: {
      package: 'chat',
      protoPath: join(__dirname, '../../protos/chat.proto'),
      url: process.env.CHAT_SERVICE_URL || 'chat-service:50053',
    },
  })
  private client: ClientGrpc;

  onModuleInit() {
    this.chatService = this.client.getService<ChatService>('ChatService');
    this.logger.log('Chat Service gRPC client initialized');
  }

  async checkUserInConversation(
    userId: string,
    conversationId: string,
  ): Promise<{ success: boolean; hasAccess: boolean; message: string }> {
    try {
      this.logger.log(`Checking user access: userId=${userId}, conversationId=${conversationId}`);
      
      const result = await firstValueFrom(this.chatService.checkUserInConversation({
        userId,
        conversationId,
      }));

      this.logger.log(`Access check result: ${JSON.stringify(result)}`);
      
      // 確保回傳正確的物件結構
      if (result && typeof result === 'object') {
        return {
          success: Boolean(result.success),
          hasAccess: Boolean(result.hasAccess),
          message: String(result.message || ''),
        };
      } else {
        this.logger.error('Invalid result from chat service:', result);
        return {
          success: false,
          hasAccess: false,
          message: 'Invalid response from chat service',
        };
      }
    } catch (error) {
      this.logger.error('Failed to check user in conversation:', error);
      return {
        success: false,
        hasAccess: false,
        message: 'Failed to verify user access',
      };
    }
  }
}