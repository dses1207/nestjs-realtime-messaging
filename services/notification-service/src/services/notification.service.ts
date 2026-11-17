import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FCMService } from './fcm.service';
import { APNsService } from './apns.service';
import { TemplateService } from './template.service';
import { OnlineStatusService } from './online-status.service';
import { DeviceToken, DeviceTokenDocument } from '../schemas/device-token.schema';
import { NotificationSettings, NotificationSettingsDocument } from '../schemas/notification-settings.schema';
import { NotificationHistory, NotificationHistoryDocument } from '../schemas/notification-history.schema';
import { SendNotificationDto, RegisterDeviceTokenDto, UpdateNotificationSettingsDto } from '../dto/notification.dto';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(DeviceToken.name)
    private deviceTokenModel: Model<DeviceTokenDocument>,
    @InjectModel(NotificationSettings.name)
    private notificationSettingsModel: Model<NotificationSettingsDocument>,
    @InjectModel(NotificationHistory.name)
    private notificationHistoryModel: Model<NotificationHistoryDocument>,
    private fcmService: FCMService,
    private apnsService: APNsService,
    private templateService: TemplateService,
    private onlineStatusService: OnlineStatusService,
  ) {}

  /**
   * 根據通知類型和用戶特性決定 iOS interruption-level
   * iOS 15+ 新特性：控制通知如何與 Focus 模式互動
   */
  private getInterruptionLevel(
    type: 'new_message' | 'group_message' | 'group_invite',
    context: {
      isVIP?: boolean;
      isUrgent?: boolean;
      messageType?: string;
    } = {}
  ): 'passive' | 'active' | 'time-sensitive' | 'critical' {
    const { isVIP = false, isUrgent = false } = context;

    // 緊急訊息：突破 Focus 模式
    if (isUrgent) {
      return 'time-sensitive';
    }

    // VIP 私人訊息：時效性通知
    if (isVIP && type === 'new_message') {
      const vipLevel = process.env.APNS_VIP_INTERRUPTION_LEVEL || 'time-sensitive';
      return vipLevel as any;
    }

    // 根據訊息類型決定
    switch (type) {
      case 'new_message':
        // 私人訊息：正常通知（亮屏+聲音）
        return 'active';

      case 'group_message':
        // 群組訊息：降低干擾（進入通知摘要）
        const groupLevel = process.env.APNS_GROUP_INTERRUPTION_LEVEL || 'passive';
        return groupLevel as any;

      case 'group_invite':
        // 群組邀請：正常通知
        return 'active';

      default:
        return 'active';
    }
  }

  /**
   * 計算通知的相關性分數（用於通知摘要排序）
   * iOS 15+ 新特性：分數越高，在通知摘要中排序越靠前
   */
  private calculateRelevanceScore(context: {
    type: 'new_message' | 'group_message' | 'group_invite';
    isVIP?: boolean;
    conversationActivity?: number;  // 0-1，對話活躍度
    userEngagement?: number;        // 0-1，用戶互動率
  }): number {
    let score = 0.5; // 基礎分數

    // VIP 聯絡人加權 (+0.3)
    if (context.isVIP) {
      const vipScore = parseFloat(process.env.APNS_VIP_RELEVANCE_SCORE || '0.95');
      return Math.min(vipScore, 1.0);
    }

    // 訊息類型加權
    switch (context.type) {
      case 'new_message':
        score += 0.2;  // 私人訊息較重要
        break;
      case 'group_invite':
        score += 0.15; // 群組邀請次之
        break;
      case 'group_message':
        const groupScore = parseFloat(process.env.APNS_GROUP_RELEVANCE_SCORE || '0.6');
        return Math.min(groupScore, 1.0);
    }

    // 對話活躍度加權 (+0.2 max)
    if (context.conversationActivity !== undefined) {
      score += context.conversationActivity * 0.2;
    }

    // 用戶互動率加權 (+0.15 max)
    if (context.userEngagement !== undefined) {
      score += context.userEngagement * 0.15;
    }

    // 限制範圍 0.0-1.0
    return Math.min(Math.max(score, 0), 1);
  }

  async registerDeviceToken(registerDto: RegisterDeviceTokenDto): Promise<boolean> {
    try {
      const { userId, token, platform, deviceId, appVersion, environment } = registerDto;

      // 驗證用戶ID格式
      if (!userId || !Types.ObjectId.isValid(userId)) {
        throw new Error(`無效的用戶ID格式: ${userId}`);
      }

      // 驗證必要欄位
      if (!token || !platform || !deviceId) {
        throw new Error('缺少必要的設備資訊 (token, platform, deviceId)');
      }

      const userObjectId = new Types.ObjectId(userId);

      // 使用 upsert 操作：基於 deviceId 更新或插入
      // 注意：一個 deviceId 在整個系統中只能有一筆記錄
      // 如果不同用戶使用同一 deviceId，會覆蓋前一個用戶的記錄
      const result = await this.deviceTokenModel.updateOne(
        {
          deviceId,  // 只用 deviceId 作為查詢條件
        },
        {
          $set: {
            userId: userObjectId,  // 允許用戶變更
            token,  // 更新 token
            platform,  // 允許平台變更
            appVersion,
            environment: environment || 'production',
            lastUsed: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: {
            createdAt: new Date(),
          },
        },
        { upsert: true }  // 如果不存在則插入，存在則更新
      );

      if (result.upsertedCount > 0) {
        this.logger.log(
          `✅ Registered NEW device token for user ${userId} ` +
          `[${platform}/${deviceId}/${environment || 'production'}]`
        );
      } else if (result.modifiedCount > 0) {
        this.logger.log(
          `🔄 Updated EXISTING device token for user ${userId} ` +
          `[${platform}/${deviceId}/${environment || 'production'}]`
        );
      } else {
        this.logger.log(
          `ℹ️ Device token UNCHANGED for user ${userId} ` +
          `[${platform}/${deviceId}/${environment || 'production'}]`
        );
      }

      return true;
    } catch (error) {
      this.logger.error(`Failed to register device token for user ${registerDto.userId}:`, error);
      throw error; // 拋出錯誤而不是返回 false
    }
  }

  /**
   * 發送訊息推播通知（使用模板系統）
   */
  async sendMessageNotification(data: {
    userId: string;
    type: 'new_message' | 'group_message' | 'group_invite';
    senderName: string;
    content: string;
    conversationName?: string;
    senderId?: string;
    conversationId?: string;
    messageId?: string;
    messageType?: 'text' | 'file' | 'image' | 'document' | 'audio' | 'video';
    fileName?: string;
    fileSize?: string;
    duration?: string;
    language?: string;
  }): Promise<boolean> {
    try {
      const {
        userId, type, senderName, content, conversationName, senderId, conversationId,
        messageType = 'text', fileName, fileSize, duration, language = 'zh-TW'
      } = data;

      // 取得通知模板（支援 messageType）
      const template = await this.templateService.getTemplate(type, messageType, language);

      // 準備模板資料（包含檔案相關資訊）
      const templateData = {
        senderName,
        content: messageType === 'text' ? content : undefined, // 非文字訊息不顯示content
        conversationName: conversationName || '群組',
        fileName,
        fileSize,
        duration,
        greeting: this.templateService.getTimeBasedGreeting(language)
      };

      // 驗證模板資料
      const validation = this.templateService.validateTemplateData(type, messageType, templateData);
      if (!validation.valid) {
        this.logger.warn(`Template data validation failed for user ${userId}:`, validation.missingFields);
      }

      // 渲染通知內容
      const rendered = await this.templateService.renderTemplate(template, templateData);

      // 準備推播資料
      const notificationData = {
        type,
        senderId: senderId || '',
        conversationId: conversationId || '',
        messageId: data.messageId || '',
        messageType,
        ...(fileName && { fileName }),
        ...(fileSize && { fileSize }),
        ...(duration && { duration }),
        timestamp: new Date().toISOString(),
      };

      // 發送推播
      return await this.sendNotification({
        userId,
        type,
        title: rendered.title,
        body: rendered.truncatedBody || rendered.body,
        data: notificationData
      });

    } catch (error) {
      this.logger.error(`Failed to send message notification to user ${data.userId}:`, error);
      return false;
    }
  }

  async sendNotification(notificationDto: SendNotificationDto): Promise<boolean> {
    try {
      let { userId, type, title, body, data } = notificationDto;
      // 從data中獲取messageType，避免數據冗餘
      const messageType = data?.messageType || 'text';
      const userObjectId = new Types.ObjectId(userId);

      const settings = await this.getNotificationSettings(userId);
      if (!this.shouldSendNotification(type, settings)) {
        this.logger.log(`Notification blocked by user settings for user ${userId}`);
        return false;
      }

      // 檢查用戶是否離線（只對離線用戶發送推播）
      const isOnline = await this.onlineStatusService.isUserOnline(userId);
      if (isOnline) {
        this.logger.log(`Notification skipped for online user ${userId}`);
        return true; // 用戶在線，不需要推播，返回 true 表示處理成功
      }

      // 如果 title 或 body 為空，使用模板系統生成
      if (!title || !body) {
        const template = await this.templateService.getTemplate(type, messageType as 'text' | 'file' | 'image' | 'document' | 'audio' | 'video', 'zh-TW');

        // 從 data 中提取模板所需的資訊
        const templateData = {
          senderName: data?.senderName || 'Unknown User',
          content: data?.content || '',
          conversationName: data?.conversationName || '群組',
          fileName: data?.fileName,
          fileSize: data?.fileSize,
          duration: data?.duration
        };

        const rendered = await this.templateService.renderTemplate(template, templateData);
        title = title || rendered.title;
        body = body || (rendered.truncatedBody || rendered.body);
      }

      const deviceTokens = await this.deviceTokenModel.find({
        userId: userObjectId,
      });

      if (deviceTokens.length === 0) {
        this.logger.log(`No device tokens found for user ${userId}`);
        return false;
      }

      const fcmTokens = deviceTokens.filter(t => t.platform === 'fcm').map(t => t.token);

      // APNs tokens grouped by environment
      const apnsProductionTokens = deviceTokens
        .filter(t => t.platform === 'apns' && (t.environment === 'production' || !t.environment))
        .map(t => t.token);
      const apnsDevelopmentTokens = deviceTokens
        .filter(t => t.platform === 'apns' && t.environment === 'development')
        .map(t => t.token);

      // ===== 建立基礎 payload =====
      const basePayload = {
        title,
        body,
        messageType: messageType as 'text' | 'file' | 'image' | 'document' | 'audio' | 'video',
        data: data || {},
      };

      // ===== FCM Payload (Android only) =====
      const fcmPayload = { ...basePayload };

      // ===== APNs Payload (iOS with iOS 15+ smart features) =====
      const interruptionLevel = this.getInterruptionLevel(type as 'new_message' | 'group_message' | 'group_invite', {
        isVIP: data?.isVIP === 'true',
        isUrgent: data?.isUrgent === 'true',
        messageType: data?.messageType,
      });

      const relevanceScore = this.calculateRelevanceScore({
        type: type as 'new_message' | 'group_message' | 'group_invite',
        isVIP: data?.isVIP === 'true',
        conversationActivity: parseFloat(data?.conversationActivity || '0.5'),
        userEngagement: parseFloat(data?.userEngagement || '0.5'),
      });

      const apnsPayload = {
        ...basePayload,
        interruptionLevel,
        relevanceScore,
        mutableContent: true,
      };

      this.logger.log(`🚀 Sending ${type}(${messageType || 'text'}) → ${userId}`);
      this.logger.log(`📱 FCM: ${fcmTokens.length}, APNs: ${apnsProductionTokens.length} prod + ${apnsDevelopmentTokens.length} dev`);
      this.logger.log(`📦 FCM payload: ${JSON.stringify(fcmPayload).length}B`);
      this.logger.log(`📦 iOS payload: ${JSON.stringify(apnsPayload).length}B [${interruptionLevel}] score=${relevanceScore.toFixed(2)}`);
      let sentCount = 0;

      if (fcmTokens.length > 0) {
        const fcmResults = await this.fcmService.sendBatchNotification(fcmTokens, fcmPayload);
        const fcmSentCount = fcmResults.filter(r => !r.error).length;
        sentCount += fcmSentCount;

        for (let i = 0; i < fcmResults.length; i++) {
          const result = fcmResults[i];

          // 檢查是否為失效 token 錯誤
          if (result.error && this.isInvalidTokenError(result.error.code)) {
            await this.removeInvalidToken(result.token, result.error.code, 'fcm');
          }

          await this.saveNotificationHistory({
            userId: userObjectId,
            type,
            title,
            body,
            data: data || {},
            platform: 'fcm',
            status: result.error ? 'failed' : 'sent',
            errorMessage: result.error?.message,
            messageId: result.messageId,
          });
        }
      }

      // Send to APNs Production tokens
      if (apnsProductionTokens.length > 0) {
        const apnsResults = await this.apnsService.sendBatchNotification(apnsProductionTokens, apnsPayload, 'production');
        const apnsSentCount = apnsResults.filter(r => r.sent).length;
        sentCount += apnsSentCount;

        for (let i = 0; i < apnsResults.length; i++) {
          const result = apnsResults[i];

          // 檢查環境是否被自動修正（重試成功）
          if (result.sent && result.environment && result.environment !== 'production') {
            this.logger.log(
              `🔄 Auto-correcting environment for token ${result.token?.substring(0, 8)}... ` +
              `from production to ${result.environment}`
            );
            await this.updateTokenEnvironment(result.token, result.environment);
          }

          // 檢查是否為失效 token 錯誤
          if (!result.sent && this.isInvalidApnsTokenError(result.error)) {
            await this.removeInvalidToken(result.token, String(result.error), 'apns');
          }

          await this.saveNotificationHistory({
            userId: userObjectId,
            type,
            title,
            body,
            data: data || {},
            platform: 'apns',
            status: result.sent ? 'sent' : 'failed',
            errorMessage: result.error?.message,
          });
        }
      }

      // Send to APNs Development tokens
      if (apnsDevelopmentTokens.length > 0) {
        const apnsResults = await this.apnsService.sendBatchNotification(apnsDevelopmentTokens, apnsPayload, 'development');
        const apnsSentCount = apnsResults.filter(r => r.sent).length;
        sentCount += apnsSentCount;

        for (let i = 0; i < apnsResults.length; i++) {
          const result = apnsResults[i];

          // 檢查環境是否被自動修正（重試成功）
          if (result.sent && result.environment && result.environment !== 'development') {
            this.logger.log(
              `🔄 Auto-correcting environment for token ${result.token?.substring(0, 8)}... ` +
              `from development to ${result.environment}`
            );
            await this.updateTokenEnvironment(result.token, result.environment);
          }

          // 檢查是否為失效 token 錯誤
          if (!result.sent && this.isInvalidApnsTokenError(result.error)) {
            await this.removeInvalidToken(result.token, String(result.error), 'apns');
          }

          await this.saveNotificationHistory({
            userId: userObjectId,
            type,
            title,
            body,
            data: data || {},
            platform: 'apns',
            status: result.sent ? 'sent' : 'failed',
            errorMessage: result.error?.message,
          });
        }
      }

      this.logger.log(`Notification sent to ${sentCount}/${deviceTokens.length} devices for user ${userId}`);
      return sentCount > 0;
    } catch (error) {
      this.logger.error('Failed to send notification:', error);
      return false;
    }
  }

  async getNotificationSettings(userId: string): Promise<NotificationSettings> {
    try {
      // 驗證用戶ID格式
      if (!userId || !Types.ObjectId.isValid(userId)) {
        throw new Error(`無效的用戶ID格式: ${userId}`);
      }
      
      const userObjectId = new Types.ObjectId(userId);
      
      let settings = await this.notificationSettingsModel.findOne({
        userId: userObjectId,
      });

      if (!settings) {
        settings = await this.notificationSettingsModel.create({
          userId: userObjectId,
          newMessage: true,
          groupInvite: true,
          groupMessage: true,
        });
        this.logger.log(`Created default notification settings for user ${userId}`);
      }

      return settings;
    } catch (error) {
      this.logger.error(`Failed to get notification settings for user ${userId}:`, error);
      throw error;
    }
  }

  async updateNotificationSettings(updateDto: UpdateNotificationSettingsDto): Promise<boolean> {
    try {
      const { userId, ...updates } = updateDto;
      
      // 驗證用戶ID格式
      if (!userId || !Types.ObjectId.isValid(userId)) {
        throw new Error(`無效的用戶ID格式: ${userId}`);
      }
      
      const userObjectId = new Types.ObjectId(userId);

      await this.notificationSettingsModel.updateOne(
        { userId: userObjectId },
        {
          ...updates,
          updatedAt: new Date(),
        },
        { upsert: true },
      );

      this.logger.log(`Updated notification settings for user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to update notification settings for user ${updateDto.userId}:`, error);
      throw error; // 拋出錯誤而不是返回 false
    }
  }

  async removeDeviceToken(userId: string, token: string): Promise<boolean> {
    try {
      // 驗證用戶ID格式
      if (!userId || !Types.ObjectId.isValid(userId)) {
        throw new Error(`無效的用戶ID格式: ${userId}`);
      }
      
      // 驗證 token
      if (!token) {
        throw new Error('缺少設備 Token');
      }
      
      const userObjectId = new Types.ObjectId(userId);

      // 硬刪除：直接從資料庫刪除記錄
      const result = await this.deviceTokenModel.deleteOne({
        userId: userObjectId,
        token,
      });

      // 檢查是否找到並刪除了設備
      if (result.deletedCount === 0) {
        throw new Error(`找不到對應的設備 Token: ${token}`);
      }

      this.logger.log(`🗑️ Deleted device token for user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to remove device token for user ${userId}:`, error);
      throw error; // 拋出錯誤而不是返回 false
    }
  }

  /**
   * 檢查是否為失效 token 相關的錯誤碼 (FCM)
   */
  private isInvalidTokenError(errorCode: string): boolean {
    const invalidTokenCodes = [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
      'messaging/unregistered'
    ];
    return invalidTokenCodes.includes(errorCode);
  }

  /**
   * 檢查是否為失效 token 相關的錯誤 (APNs)
   */
  private isInvalidApnsTokenError(error: any): boolean {
    if (!error) return false;

    // APNs 失效 token 相關的錯誤狀態碼
    const invalidTokenStatuses = [
      400, // Bad Device Token
      410, // Unregistered
    ];

    // 檢查狀態碼
    if (error.status && invalidTokenStatuses.includes(error.status)) {
      return true;
    }

    // 檢查錯誤訊息中的關鍵字
    const errorString = String(error).toLowerCase();
    const invalidKeywords = [
      'baddevicetoken',
      'unregistered',
      'invalid token',
      'device token'
    ];

    return invalidKeywords.some(keyword => errorString.includes(keyword));
  }

  /**
   * 移除失效的設備 Token (用於 FCM/APNs 錯誤處理)
   */
  async removeInvalidToken(token: string, reason: string, platform?: 'fcm' | 'apns'): Promise<void> {
    try {
      if (!token) {
        throw new Error('缺少設備 Token');
      }

      // 硬刪除：直接從資料庫刪除失效的 token
      const result = await this.deviceTokenModel.deleteOne({ token });

      if (result.deletedCount > 0) {
        this.logger.warn(
          `🗑️ Deleted invalid ${platform || 'unknown'} token: ` +
          `${token.substring(0, 20)}... (Reason: ${reason})`
        );
      } else {
        this.logger.warn(
          `⚠️ Attempted to delete non-existent token: ${token.substring(0, 20)}...`
        );
      }
    } catch (error) {
      this.logger.error(`Failed to remove invalid token ${token.substring(0, 20)}...:`, error);
      // 不拋出錯誤，避免影響主要的通知流程
    }
  }

  /**
   * 更新 device token 的環境設定
   * 當自動重試成功時調用，修正資料庫中的環境記錄
   */
  private async updateTokenEnvironment(
    token: string,
    environment: 'development' | 'production',
  ): Promise<void> {
    try {
      if (!token) {
        this.logger.warn('⚠️ Cannot update environment: token is empty');
        return;
      }

      const result = await this.deviceTokenModel.updateOne(
        { token, platform: 'apns' },
        {
          $set: {
            environment,
            updatedAt: new Date(),
          }
        }
      );

      if (result.modifiedCount > 0) {
        this.logger.log(
          `✅ Updated token environment to ${environment} for token ${token.substring(0, 8)}...`
        );
      } else {
        this.logger.warn(
          `⚠️ Token not found or already has correct environment: ${token.substring(0, 8)}...`
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to update token environment for ${token.substring(0, 8)}...:`,
        error
      );
      // 不拋出錯誤，避免影響主要的通知流程
    }
  }

  private shouldSendNotification(
    type: string,
    settings: NotificationSettings,
  ): boolean {
    switch (type) {
      case 'new_message':
        return settings.newMessage;
      case 'group_invite':
        return settings.groupInvite;
      case 'group_message':
        return settings.groupMessage;
      default:
        return false;
    }
  }

  /**
   * 取得推播歷史記錄
   */
  async getNotificationHistory(query: {
    userId: string;
    limit?: number;
    offset?: number;
    type?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{
    notifications: any[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const { userId, limit = 20, offset = 0, type, startDate, endDate } = query;
      
      // 驗證用戶ID格式
      if (!userId || !Types.ObjectId.isValid(userId)) {
        throw new Error(`無效的用戶ID格式: ${userId}`);
      }
      
      const userObjectId = new Types.ObjectId(userId);
      
      // 建構查詢條件
      const queryConditions: any = { userId: userObjectId };
      
      // 類型篩選
      if (type) {
        queryConditions.type = type;
      }
      
      // 時間範圍篩選
      if (startDate || endDate) {
        queryConditions.createdAt = {};
        if (startDate) {
          queryConditions.createdAt.$gte = new Date(startDate);
        }
        if (endDate) {
          queryConditions.createdAt.$lte = new Date(endDate);
        }
      }
      
      // 查詢總數
      const total = await this.notificationHistoryModel.countDocuments(queryConditions);
      
      // 查詢分頁資料
      const notifications = await this.notificationHistoryModel
        .find(queryConditions)
        .sort({ createdAt: -1 }) // 最新的在前面
        .skip(offset)
        .limit(limit)
        .select({
          type: 1,
          title: 1,
          body: 1,
          data: 1,
          platform: 1,
          status: 1,
          errorMessage: 1,
          messageId: 1,
          sentAt: 1,
          createdAt: 1,
        })
        .lean()
        .exec();
      
      // 計算是否還有更多資料
      const hasMore = offset + limit < total;
      
      // 格式化回傳資料
      const formattedNotifications = notifications.map(notification => ({
        id: notification._id.toString(),
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data,
        platform: notification.platform,
        status: notification.status,
        errorMessage: notification.errorMessage || null,
        messageId: notification.messageId || null,
        sentAt: notification.sentAt?.toISOString() || null,
        createdAt: notification.createdAt.toISOString(),
      }));
      
      this.logger.log(`Retrieved ${notifications.length}/${total} notification history records for user ${userId}`);
      
      return {
        notifications: formattedNotifications,
        total,
        hasMore,
      };
      
    } catch (error) {
      this.logger.error(`Failed to get notification history for user ${query.userId}:`, error);
      throw error;
    }
  }


  /**
   * 發送來電推播通知（FCM + APNs Critical Alert）
   * 支援 Android 和 iOS 的強制喚醒來電通知
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
      const { userId, callId, callerId, callerName, callType, conversationId } = data;

      this.logger.log(`📞 發送來電推播 - 用戶: ${userId}, 來電者: ${callerName}, 類型: ${callType}`);

      // 檢查用戶是否在線
      const isOnline = await this.onlineStatusService.isUserOnline(userId);
      if (isOnline) {
        this.logger.log(`✅ 用戶 ${userId} 在線，跳過來電推播`);
        return true;
      }

      // 取得用戶裝置 Token
      const userObjectId = new Types.ObjectId(userId);
      const deviceTokens = await this.deviceTokenModel.find({
        userId: userObjectId,
      }).exec();

      if (deviceTokens.length === 0) {
        this.logger.warn(`⚠️ 用戶 ${userId} 沒有註冊的裝置 Token`);
        return false;
      }

      // 準備推播內容
      const callTypeText = callType === 'video' ? '視訊' : '語音';
      const title = `來自 ${callerName} 的${callTypeText}通話`;
      const body = '點擊接聽';

      // 推播資料（前端用於導航到來電畫面）
      const notificationData = {
        type: 'incoming_call',
        callId,
        callerId,
        callerName,
        callType,
        conversationId,
        timestamp: new Date().toISOString(),
      };

      // 分離 FCM 和 APNs Token
      const fcmTokens = deviceTokens
        .filter(dt => dt.platform === 'fcm')
        .map(dt => dt.token);

      const apnsTokens = deviceTokens
        .filter(dt => dt.platform === 'apns')
        .map(dt => dt.token);

      let fcmSuccess = true;
      let apnsSuccess = true;

      // === FCM 推播（Android）- 高優先級 ===
      if (fcmTokens.length > 0) {
        try {
          this.logger.log(`📱 發送 FCM 來電推播 (${fcmTokens.length} 個裝置)`);

          await this.fcmService.sendToDevices(fcmTokens, {
            title,
            body,
            data: notificationData,
            android: {
              priority: 'high', // 高優先級
              ttl: 60 * 1000, // 60 秒過期
              notification: {
                channelId: 'incoming_call', // 專用通道
                sound: 'default',
                priority: 'max', // 最高優先級
                visibility: 'public',
                tag: `call_${callId}`,
                color: '#00FF00',
                defaultSound: true,
                defaultVibrateTimings: true,
              },
            },
          });

          this.logger.log(`✅ FCM 來電推播發送成功`);
        } catch (error) {
          this.logger.error(`❌ FCM 來電推播失敗:`, error);
          fcmSuccess = false;
        }
      }

      // === APNs 推播（iOS）- Critical Alert ===
      if (apnsTokens.length > 0) {
        try {
          this.logger.log(`🍎 發送 APNs 來電推播 (${apnsTokens.length} 個裝置)`);

          await this.apnsService.sendToDevices(apnsTokens, {
            title,
            body,
            data: notificationData,
            // iOS 15+ Critical Alert（突破勿擾模式和靜音）
            interruptionLevel: 'critical',
            relevanceScore: 1.0, // 最高相關性
            sound: {
              critical: true, // 關鍵：啟用 Critical Alert 聲音
              name: 'default',
              volume: 1.0,
            },
            badge: 1,
            // 分類（用於 CallKit 整合）
            category: 'INCOMING_CALL',
            // Thread ID（用於通知分組）
            threadId: `call_${callId}`,
            // 可修改內容（支援 Notification Service Extension）
            mutableContent: true,
          });

          this.logger.log(`✅ APNs 來電推播發送成功`);
        } catch (error) {
          this.logger.error(`❌ APNs 來電推播失敗:`, error);
          apnsSuccess = false;
        }
      }

      // 保存推播歷史
      await this.saveNotificationHistory({
        userId: userObjectId,
        type: 'incoming_call',
        title,
        body,
        data: notificationData,
        platform: fcmTokens.length > 0 ? 'fcm' : 'apns',
        status: (fcmSuccess && apnsSuccess) ? 'sent' : 'failed',
        messageId: callId,
      });

      const success = fcmSuccess || apnsSuccess;
      this.logger.log(`📊 來電推播結果 - FCM: ${fcmSuccess}, APNs: ${apnsSuccess}, 總體: ${success}`);

      return success;

    } catch (error) {
      this.logger.error(`❌ 發送來電推播失敗:`, error);
      return false;
    }
  }

  private async saveNotificationHistory(historyData: any): Promise<void> {
    try {
      await this.notificationHistoryModel.create({
        ...historyData,
        sentAt: new Date(),
      });
    } catch (error) {
      this.logger.error('Failed to save notification history:', error);
    }
  }
}