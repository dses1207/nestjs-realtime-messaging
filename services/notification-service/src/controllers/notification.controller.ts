import { Controller, Logger, Get } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { NotificationService } from '../services/notification.service';
import { SendNotificationDto, RegisterDeviceTokenDto, UpdateNotificationSettingsDto } from '../dto/notification.dto';

@Controller('notification')
export class NotificationController {
  private readonly logger = new Logger(NotificationController.name);

  constructor(
    private readonly notificationService: NotificationService,
  ) {}

  @GrpcMethod('NotificationService', 'SendNotification')
  async grpcSendNotification(data: SendNotificationDto) {
    try {
      const result = await this.notificationService.sendNotification(data);
      return {
        success: result,
        message: result ? '推播通知發送成功' : '推播通知發送失敗',
      };
    } catch (error) {
      this.logger.error('Failed to send notification:', error);
      throw new RpcException({
        code: 3, // INVALID_ARGUMENT
        message: error.message || '發送推播通知失敗',
      });
    }
  }

  @GrpcMethod('NotificationService', 'SendMessageNotification')
  async grpcSendMessageNotification(data: {
    userId: string;
    type: string;
    senderName: string;
    content: string;
    conversationName?: string;
    senderId?: string;
    conversationId?: string;
    language?: string;
  }) {
    try {
      const result = await this.notificationService.sendMessageNotification({
        ...data,
        type: data.type as 'new_message' | 'group_message' | 'group_invite'
      });
      return {
        success: result,
        message: result ? '訊息推播發送成功' : '訊息推播發送失敗',
      };
    } catch (error) {
      this.logger.error('Failed to send message notification:', error);
      throw new RpcException({
        code: 3, // INVALID_ARGUMENT
        message: error.message || '發送訊息推播失敗',
      });
    }
  }

  @GrpcMethod('NotificationService', 'SendSmartNotification')
  async grpcSendSmartNotification(data: {
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
  }) {
    try {
      const result = await this.notificationService.sendMessageNotification({
        userId: data.userId,
        type: data.type as 'new_message' | 'group_message' | 'group_invite',
        senderName: data.senderName,
        content: data.content,
        conversationName: data.conversationName,
        conversationId: data.conversationId,
        messageId: data.messageId,
        messageType: data.messageType as 'text' | 'file' | 'image' | 'document' | 'audio' | 'video',
        fileName: data.fileName,
        fileSize: data.fileSize,
        duration: data.duration,
      });

      return {
        success: result,
        message: result ? '智能推播發送成功' : '智能推播發送失敗',
      };
    } catch (error) {
      this.logger.error('Failed to send smart notification:', error);
      throw new RpcException({
        code: 3,
        message: error.message || '發送智能推播失敗',
      });
    }
  }

  @GrpcMethod('NotificationService', 'RegisterDeviceToken')
  async grpcRegisterDeviceToken(data: RegisterDeviceTokenDto) {
    try {
      const result = await this.notificationService.registerDeviceToken(data);
      return {
        success: result,
        message: result ? '裝置 Token 註冊成功' : '裝置 Token 註冊失敗',
        deviceToken: result ? {
          userId: data.userId,
          token: data.token,
          platform: data.platform,
          deviceId: data.deviceId,
          appVersion: data.appVersion,
          createdAt: new Date().toISOString(),
        } : null,
      };
    } catch (error) {
      this.logger.error('Failed to register device token:', error);
      throw new RpcException({
        code: 3, // INVALID_ARGUMENT
        message: error.message || '註冊裝置 Token 失敗',
      });
    }
  }

  @GrpcMethod('NotificationService', 'UpdateNotificationSettings')
  async grpcUpdateNotificationSettings(data: UpdateNotificationSettingsDto) {
    try {
      const result = await this.notificationService.updateNotificationSettings(data);
      return {
        success: result,
        message: result ? '推播設定更新成功' : '推播設定更新失敗',
      };
    } catch (error) {
      this.logger.error('Failed to update notification settings:', error);
      throw new RpcException({
        code: 3, // INVALID_ARGUMENT
        message: error.message || '更新推播設定失敗',
      });
    }
  }

  @GrpcMethod('NotificationService', 'GetNotificationSettings')
  async grpcGetNotificationSettings(data: { userId: string }) {
    try {
      const settings = await this.notificationService.getNotificationSettings(data.userId);
      return {
        settings: {
          userId: settings.userId.toString(),
          newMessage: settings.newMessage,
          groupInvite: settings.groupInvite,
          groupMessage: settings.groupMessage,
          createdAt: settings.createdAt.toISOString(),
          updatedAt: settings.updatedAt.toISOString(),
        },
      };
    } catch (error) {
      this.logger.error('Failed to get notification settings:', error);
      throw new RpcException({
        code: 5, // NOT_FOUND
        message: error.message || '取得推播設定失敗',
      });
    }
  }

  @GrpcMethod('NotificationService', 'SendCallNotification')
  async grpcSendCallNotification(data: {
    userId: string;
    callId: string;
    callerId: string;
    callerName: string;
    callType: string;
    conversationId: string;
  }) {
    try {
      this.logger.log(`📞 收到來電推播請求 - 用戶: ${data.userId}, 來電者: ${data.callerName}`);

      const result = await this.notificationService.sendCallNotification({
        userId: data.userId,
        callId: data.callId,
        callerId: data.callerId,
        callerName: data.callerName,
        callType: data.callType as 'audio' | 'video',
        conversationId: data.conversationId,
      });

      return {
        success: result,
        message: result ? '來電推播發送成功' : '來電推播發送失敗',
      };
    } catch (error) {
      this.logger.error('Failed to send call notification:', error);
      throw new RpcException({
        code: 3,
        message: error.message || '發送來電推播失敗',
      });
    }
  }

  @GrpcMethod('NotificationService', 'RemoveDeviceToken')
  async grpcRemoveDeviceToken(data: { userId: string; token: string }) {
    try {
      const result = await this.notificationService.removeDeviceToken(data.userId, data.token);
      return {
        success: result,
        message: result ? '裝置 Token 移除成功' : '裝置 Token 移除失敗',
      };
    } catch (error) {
      this.logger.error('Failed to remove device token:', error);
      throw new RpcException({
        code: 3, // INVALID_ARGUMENT
        message: error.message || '移除裝置 Token 失敗',
      });
    }
  }

  @GrpcMethod('NotificationService', 'GetNotificationHistory')
  async grpcGetNotificationHistory(data: {
    userId: string;
    limit?: number;
    offset?: number;
    type?: string;
    startDate?: string;
    endDate?: string;
  }) {
    try {
      const result = await this.notificationService.getNotificationHistory(data);
      return {
        notifications: result.notifications,
        total: result.total,
        hasMore: result.hasMore,
      };
    } catch (error) {
      this.logger.error('Failed to get notification history:', error);
      throw new RpcException({
        code: 3, // INVALID_ARGUMENT
        message: error.message || '取得推播歷史記錄失敗',
      });
    }
  }

  /**
   * 健康檢查端點
   */
  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'notification-service',
      features: {
        smartNotification: true,
        notificationGrouping: true,
        soundControl: true
      }
    };
  }

}