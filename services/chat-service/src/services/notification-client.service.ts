import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ClientGrpc, Client, Transport } from '@nestjs/microservices';
import { Observable } from 'rxjs';

interface NotificationService {
  sendNotification(data: { 
    userId: string; 
    type: string; 
    title: string; 
    body: string; 
    data?: string 
  }): Observable<any>;
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

  async sendMessageNotification(
    receiverIds: string[],
    senderId: string,
    senderName: string,
    content: string,
    conversationName?: string,
    isGroupMessage?: boolean
  ): Promise<void> {
    try {
      const notifications = receiverIds.map(receiverId => {
        const type = isGroupMessage ? 'group_message' : 'new_message';
        const title = isGroupMessage ? (conversationName || '群組訊息') : senderName;
        const body = isGroupMessage ? `${senderName}: ${content}` : content;

        return this.notificationService.sendNotification({
          userId: receiverId,
          type,
          title,
          body,
          data: JSON.stringify({
            type,
            senderId: senderId,
            receiverId: receiverId,
            content,
            conversationName: isGroupMessage ? conversationName : undefined
          })
        }).toPromise();
      });

      await Promise.all(notifications);
      this.logger.log(`Sent push notifications to ${receiverIds.length} users`);
    } catch (error) {
      this.logger.error('Failed to send push notifications:', error);
      // Don't throw error as notification failure shouldn't block message saving
    }
  }
}