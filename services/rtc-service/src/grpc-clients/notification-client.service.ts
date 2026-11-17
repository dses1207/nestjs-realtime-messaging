import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

@Injectable()
export class NotificationClientService implements OnModuleInit {
  private readonly logger = new Logger(NotificationClientService.name);
  private notificationService: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const PROTO_PATH = join(__dirname, '../../protos/notification.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const notificationProto: any =
      grpc.loadPackageDefinition(packageDefinition).notification;

    const NOTIFICATION_SERVICE_URL = this.configService.get<string>(
      'NOTIFICATION_SERVICE_URL',
    );
    const NOTIFICATION_SERVICE_PORT = this.configService.get<string>(
      'NOTIFICATION_SERVICE_PORT',
    );

    // 檢查 URL 是否已包含端口，避免重複
    const serviceAddress = NOTIFICATION_SERVICE_URL?.includes(':')
      ? NOTIFICATION_SERVICE_URL
      : `${NOTIFICATION_SERVICE_URL}:${NOTIFICATION_SERVICE_PORT}`;

    this.notificationService = new notificationProto.NotificationService(
      serviceAddress,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 200 * 1024 * 1024,
        'grpc.max_send_message_length': 200 * 1024 * 1024,
      },
    );

    this.logger.log(
      `✅ Notification gRPC client connected to ${serviceAddress}`,
    );
  }

  /**
   * 發送來電通知給離線用戶
   */
  async sendCallNotification(
    userId: string,
    callId: string,
    callerId: string,
    callerName: string,
    callType: 'audio' | 'video',
    conversationId: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      // 注意：這個方法需要在 notification.proto 中定義
      // 如果沒有，可以使用現有的 SendPushNotification 方法
      const notification = {
        user_id: userId,
        title: `來自 ${callerName} 的${callType === 'video' ? '視訊' : '語音'}通話`,
        body: '點擊接聽',
        data: {
          type: 'incoming_call',
          callId,
          callerId,
          callerName,
          callType,
          conversationId,
        },
      };

      // 使用現有的 SendPushNotification 方法
      if (!this.notificationService.SendPushNotification) {
        this.logger.warn('SendPushNotification method not available');
        resolve(false);
        return;
      }

      this.notificationService.SendPushNotification(
        notification,
        (error: any, response: any) => {
          if (error) {
            this.logger.error(`Failed to send call notification to ${userId}:`, error.message);
            resolve(false);
          } else {
            this.logger.log(`✅ Call notification sent to ${userId}`);
            resolve(response.success || false);
          }
        },
      );
    });
  }

  /**
   * 發送未接來電通知
   */
  async sendMissedCallNotification(
    userId: string,
    callerId: string,
    callerName: string,
    callType: 'audio' | 'video',
    conversationId: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const notification = {
        user_id: userId,
        title: `未接來電`,
        body: `${callerName} 的${callType === 'video' ? '視訊' : '語音'}通話`,
        data: {
          type: 'missed_call',
          callerId,
          callerName,
          callType,
          conversationId,
          timestamp: new Date().toISOString(),
        },
      };

      if (!this.notificationService.SendPushNotification) {
        this.logger.warn('SendPushNotification method not available');
        resolve(false);
        return;
      }

      this.notificationService.SendPushNotification(
        notification,
        (error: any, response: any) => {
          if (error) {
            this.logger.error(`Failed to send missed call notification to ${userId}:`, error.message);
            resolve(false);
          } else {
            this.logger.log(`✅ Missed call notification sent to ${userId}`);
            resolve(response.success || false);
          }
        },
      );
    });
  }
}
