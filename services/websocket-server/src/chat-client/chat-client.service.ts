import { Injectable, Inject } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable } from 'rxjs';

interface ChatService {
  saveMessage(data: {
    content: string;
    conversationId: string;
    senderId: string;
    messageType?: string;
    fileId?: string;
    fileInfo?: { originalName?: string; fileSize?: number; contentType?: string };
  }): Observable<any>;

  getConversationParticipants(data: {
    conversationId: string;
  }): Observable<{ participantIds: string[] }>;

  getConversationDetails(data: {
    conversationId: string;
  }): Observable<{ conversation: any }>;

  // 已讀系統
  markMessagesAsRead(data: {
    userId: string;
    conversationId: string;
    lastReadMessageId: string;
  }): Observable<{
    success: boolean;
    affectedMessageIds: string[];
    newlyReadCount: number;
  }>;

  getReadReceipts(data: {
    messageId: string;
    limit?: number;
    offset?: number;
  }): Observable<{
    receipts: Array<{
      userId: string;
      username: string;
      profilePicture: string;
      readAt: string;
    }>;
    totalCount: number;
  }>;

  getConversationState(data: {
    userId: string;
    conversationId: string;
  }): Observable<{
    unreadCount: number;
    lastReadMessageId: string;
    lastReadAt: string;
  }>;
}

@Injectable()
export class ChatClientService {
  private chatService: ChatService;

  constructor(@Inject('CHAT_SERVICE') private client: ClientGrpc) {}

  onModuleInit() {
    this.chatService = this.client.getService<ChatService>('ChatService');
  }

  async saveMessage(
    content: string, 
    conversationId: string, 
    senderId: string,
    messageType?: string,
    fileId?: string,
    fileInfo?: { originalName?: string; fileSize?: number; contentType?: string }
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      this.chatService.saveMessage({ 
        content, 
        conversationId, 
        senderId,
        messageType,
        fileId,
        fileInfo
      }).subscribe({
        next: (result) => resolve(result),
        error: (error) => reject(error),
      });
    });
  }

  async getConversationParticipants(conversationId: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.chatService.getConversationParticipants({ conversationId }).subscribe({
        next: (result) => resolve(result.participantIds),
        error: (error) => reject(error),
      });
    });
  }

  async getConversationDetails(conversationId: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.chatService.getConversationDetails({ conversationId }).subscribe({
        next: (result) => resolve(result.conversation),
        error: (error) => reject(error),
      });
    });
  }

  // ========== 已讀系統方法 ==========

  async markMessagesAsRead(
    userId: string,
    conversationId: string,
    lastReadMessageId: string,
  ): Promise<{ success: boolean; affectedMessageIds: string[]; newlyReadCount: number }> {
    return new Promise((resolve, reject) => {
      this.chatService
        .markMessagesAsRead({ userId, conversationId, lastReadMessageId })
        .subscribe({
          next: (result) => resolve(result),
          error: (error) => reject(error),
        });
    });
  }

  async getReadReceipts(
    messageId: string,
    limit?: number,
    offset?: number,
  ): Promise<{
    receipts: Array<{
      userId: string;
      username: string;
      profilePicture: string;
      readAt: string;
    }>;
    totalCount: number;
  }> {
    return new Promise((resolve, reject) => {
      this.chatService.getReadReceipts({ messageId, limit, offset }).subscribe({
        next: (result) => resolve(result),
        error: (error) => reject(error),
      });
    });
  }

  async getConversationState(
    userId: string,
    conversationId: string,
  ): Promise<{
    unreadCount: number;
    lastReadMessageId: string;
    lastReadAt: string;
  }> {
    return new Promise((resolve, reject) => {
      this.chatService.getConversationState({ userId, conversationId }).subscribe({
        next: (result) => resolve(result),
        error: (error) => reject(error),
      });
    });
  }
} 