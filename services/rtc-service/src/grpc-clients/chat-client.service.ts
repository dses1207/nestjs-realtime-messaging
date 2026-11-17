import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

@Injectable()
export class ChatClientService implements OnModuleInit {
  private readonly logger = new Logger(ChatClientService.name);
  private chatService: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const PROTO_PATH = join(__dirname, '../../protos/chat.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const chatProto: any = grpc.loadPackageDefinition(packageDefinition).chat;

    const CHAT_SERVICE_URL = this.configService.get<string>('CHAT_SERVICE_URL');
    const CHAT_SERVICE_PORT = this.configService.get<string>('CHAT_SERVICE_PORT');

    // 檢查 URL 是否已包含端口，避免重複
    const serviceAddress = CHAT_SERVICE_URL?.includes(':')
      ? CHAT_SERVICE_URL
      : `${CHAT_SERVICE_URL}:${CHAT_SERVICE_PORT}`;

    this.chatService = new chatProto.ChatService(
      serviceAddress,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 200 * 1024 * 1024,
        'grpc.max_send_message_length': 200 * 1024 * 1024,
      },
    );

    this.logger.log(
      `✅ Chat gRPC client connected to ${serviceAddress}`,
    );
  }

  /**
   * 保存通話開始/結束訊息到對話
   */
  async saveCallMessage(
    conversationId: string,
    senderId: string,
    content: string,
    messageType: 'call_start' | 'call_end',
    callId: string,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      this.chatService.SaveMessage(
        {
          conversation_id: conversationId,
          sender_id: senderId,
          content,
          message_type: messageType,
          metadata: JSON.stringify({ callId }),
        },
        (error: any, response: any) => {
          if (error) {
            this.logger.error('SaveMessage gRPC error:', error.message);
            reject(error);
          } else {
            resolve(response);
          }
        },
      );
    });
  }

  /**
   * 獲取對話詳情
   */
  async getConversationDetails(conversationId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.chatService.GetConversationDetails(
        { conversation_id: conversationId },
        (error: any, response: any) => {
          if (error) {
            this.logger.error('GetConversationDetails gRPC error:', error.message);
            reject(error);
          } else {
            resolve(response);
          }
        },
      );
    });
  }

  /**
   * 獲取對話參與者
   */
  async getConversationParticipants(conversationId: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.chatService.GetConversationParticipants(
        { conversation_id: conversationId },
        (error: any, response: any) => {
          if (error) {
            this.logger.error('GetConversationParticipants gRPC error:', error.message);
            reject(error);
          } else {
            resolve(response.participant_ids || []);
          }
        },
      );
    });
  }
}
