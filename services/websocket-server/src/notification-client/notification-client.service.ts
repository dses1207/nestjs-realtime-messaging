import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientGrpc, Client, Transport } from '@nestjs/microservices';
import { Observable } from 'rxjs';

interface SendNotificationRequest {
  userId: string;
  type: string;
  title: string;
  body: string;
  messageType?: string;
  data?: Record<string, string>;
}

interface SendNotificationResponse {
  success: boolean;
  message: string;
}

interface SendSmartNotificationRequest {
  userId: string;
  conversationId: string;
  senderName: string;
  content: string;
  messageType: string;
  type: string;
  messageId?: string;
  conversationName?: string;
  fileName?: string;
  fileSize?: string;
  duration?: string;
}

interface SendSmartNotificationResponse {
  success: boolean;
  message: string;
}

interface SendCallNotificationRequest {
  userId: string;
  callId: string;
  callerId: string;
  callerName: string;
  callType: string;
  conversationId: string;
}

interface SendCallNotificationResponse {
  success: boolean;
  message: string;
}

interface NotificationService {
  sendNotification(data: SendNotificationRequest): Observable<SendNotificationResponse>;
  sendSmartNotification(data: SendSmartNotificationRequest): Observable<SendSmartNotificationResponse>;
  sendCallNotification(data: SendCallNotificationRequest): Observable<SendCallNotificationResponse>;
}

@Injectable()
export class NotificationClientService implements OnModuleInit {
  private readonly logger = new Logger(NotificationClientService.name);

  @Client({
    transport: Transport.GRPC,
    options: {
      package: 'notification',
      protoPath: '/app/protos/notification.proto',
      url: process.env.NOTIFICATION_SERVICE_URL || 'notification-service:50056',
    },
  })
  private client: ClientGrpc;

  private notificationService: NotificationService;

  onModuleInit() {
    this.notificationService = this.client.getService<NotificationService>('NotificationService');
  }

  /**
   * 發送推播通知給離線用戶
   */
  async sendPushNotification(
    userId: string,
    notificationData: {
      conversationId: string;
      senderId: string;
      senderName: string;
      content: string;
      messageId: string;
      timestamp: string;
      conversationName?: string;
      isGroupMessage: boolean;
      messageType?: 'text' | 'file' | 'image' | 'document' | 'audio' | 'video';
    }
  ): Promise<boolean> {
    try {
      const type = notificationData.isGroupMessage ? 'group_message' : 'new_message';
      const messageType = notificationData.messageType || 'text';

      // 輕量化標題：只顯示發送者名稱或群組名稱
      const title = notificationData.isGroupMessage
        ? (notificationData.conversationName || '群組訊息')
        : notificationData.senderName;

      // 使用新的智慧通知系統
      const smartRequest = {
        userId,
        conversationId: notificationData.conversationId,
        senderName: notificationData.senderName,
        content: notificationData.content,
        messageType: messageType || 'text',
        type: type,
        messageId: notificationData.messageId || '',
        conversationName: notificationData.conversationName || '',
        // 可選的檔案相關資訊
        fileName: undefined, // 如果有檔案資訊可以傳遞
        fileSize: undefined,
        duration: undefined
      };

      this.logger.log(`🚀 Smart notification: ${messageType} → ${userId} (${JSON.stringify(smartRequest).length}B)`);

      const response = await this.notificationService.sendSmartNotification(smartRequest).toPromise();
      
      if (response?.success) {
        this.logger.log(`Push notification sent successfully to user ${userId}`);
        return true;
      } else {
        this.logger.warn(`Push notification failed for user ${userId}: ${response?.message}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Failed to send push notification to user ${userId}:`, error.message);
      return false;
    }
  }

  /**
   * 發送來電推播通知給離線用戶
   * 使用 FCM 高優先級推播（Android）和 APNs Critical Alert（iOS）
   */
  async sendCallNotification(data: {
    userId: string;
    callId: string;
    callerId: string;
    callerName: string;
    callType: 'audio' | 'video';
    conversationId: string;
  }): Promise<boolean> {
    try {
      this.logger.log(`📞 發送來電推播給用戶 ${data.userId} (來電者: ${data.callerName}, 類型: ${data.callType})`);

      const request: SendCallNotificationRequest = {
        userId: data.userId,
        callId: data.callId,
        callerId: data.callerId,
        callerName: data.callerName,
        callType: data.callType,
        conversationId: data.conversationId,
      };

      const response = await this.notificationService.sendCallNotification(request).toPromise();

      if (response?.success) {
        this.logger.log(`✅ 來電推播發送成功: ${data.userId}`);
        return true;
      } else {
        this.logger.warn(`⚠️ 來電推播發送失敗: ${data.userId} - ${response?.message}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`❌ 發送來電推播時發生錯誤 (用戶 ${data.userId}):`, error.message);
      return false;
    }
  }
}