import { Injectable, Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import { NotificationPayload, FCMResponse } from '../interfaces/notification.interface';

@Injectable()
export class FCMService {
  private readonly logger = new Logger(FCMService.name);
  // 沒有 Firebase 金鑰時為 undefined：服務照常啟動，只是 FCM 推播停用（本機開發 / Demo 不需要金鑰）
  private readonly fcmApp?: admin.app.App;

  constructor() {
    try {
      let credential: admin.credential.Credential;

      // 使用檔案路徑方式
      const configPath = process.env.FIREBASE_CONFIG_PATH;
      if (configPath && fs.existsSync(configPath)) {
        this.logger.log(`Initializing FCM with config file: ${configPath}`);
        credential = admin.credential.cert(configPath);
      } 
      // 嘗試預設路徑
      else {
        const defaultPath = path.join(__dirname, '../../keys/firebase-service-account.json');
        if (fs.existsSync(defaultPath)) {
          this.logger.log(`Using default config file: ${defaultPath}`);
          credential = admin.credential.cert(defaultPath);
        } else {
          this.logger.warn('No Firebase configuration found (FIREBASE_CONFIG_PATH) — FCM push notifications are disabled');
          return;
        }
      }

      this.fcmApp = admin.initializeApp({
        credential,
      }, 'fcm-app');

      this.logger.log('FCM Service initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize FCM Service:', error);
      throw error;
    }
  }

  private messaging(): admin.messaging.Messaging {
    if (!this.fcmApp) {
      throw new Error('FCM is disabled: no Firebase configuration');
    }
    return this.fcmApp.messaging();
  }

  async sendNotification(
    deviceToken: string,
    payload: NotificationPayload,
  ): Promise<FCMResponse> {
    try {
      this.logger.log(`=== FCM Single Notification Debug ===`);
      this.logger.log(`Token length: ${deviceToken.length}`);
      this.logger.log(`Token preview: ${deviceToken.substring(0, 20)}...${deviceToken.substring(deviceToken.length - 20)}`);
      this.logger.log(`Token validation: ${!/^[a-zA-Z0-9_:-]+$/.test(deviceToken) ? 'INVALID CHARS DETECTED' : 'Valid format'}`);

      const message: any = {
        data: {
          title: payload.title,
          body: payload.body,
          // 將所有控制邏輯移到 data 中，讓 App 完全控制
          ...(payload.threadId && { threadId: payload.threadId }),
          ...(payload.data || {}),
        },
        token: deviceToken,
        android: {
          priority: 'high' as const,
          // 移除 notification 物件，改用 data-only payload
        },
        // 移除 APNs configuration (FCM 是 Android 專用，APNs 設定已移到 APNs Service)
      };

      this.logger.log(`Sending single FCM notification...`);
      const response = await this.messaging().send(message);
      this.logger.log(`✅ FCM notification sent successfully: ${response}`);

      return {
        messageId: response,
        token: deviceToken,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to send FCM notification to token: ${deviceToken.substring(0, 20)}...`);
      this.logger.error(`Error code: ${error.code}`);
      this.logger.error(`Error message: ${error.message}`);
      this.logger.error('Error details:', JSON.stringify(error, null, 2));
      return {
        error,
        token: deviceToken,
      };
    }
  }

  async sendBatchNotification(
    deviceTokens: string[],
    payload: NotificationPayload,
  ): Promise<FCMResponse[]> {
    try {
      // Token 驗證和日誌記錄
      this.logger.log(`📡 FCM batch: ${deviceTokens.length} tokens, ${JSON.stringify(payload).length}B`);

      const multicastMessage = {
        data: {
          title: payload.title,
          body: payload.body,
          // 將所有控制邏輯移到 data 中，讓 App 完全控制
          ...(payload.threadId && { threadId: payload.threadId }),
          ...(payload.data || {}),
        },
        tokens: deviceTokens,
        android: {
          priority: 'high' as const,
          // 移除 notification 物件，改用 data-only payload
        },
        // 移除 APNs configuration (FCM 是 Android 專用，APNs 設定已移到 APNs Service)
      };

      const response = await this.messaging().sendEachForMulticast(multicastMessage);
      this.logger.log(`✅ FCM results: ${response.successCount}/${response.responses.length} sent`);

      // 詳細錯誤分析
      response.responses.forEach((res, index) => {
        if (res.success) {
          this.logger.log(`✅ Token ${index + 1}: SUCCESS - MessageId: ${res.messageId}`);
        } else {
          this.logger.error(`❌ Token ${index + 1}: FAILED`);
          this.logger.error(`  Token: ${deviceTokens[index].substring(0, 20)}...`);
          this.logger.error(`  Error Code: ${res.error.code}`);
          this.logger.error(`  Error Message: ${res.error.message}`);
          this.logger.error(`  Error Details:`, JSON.stringify(res.error, null, 2));
        }
      });

      return response.responses.map((res, index) => ({
        messageId: res.success ? res.messageId : undefined,
        error: res.success ? undefined : res.error,
        token: deviceTokens[index], // 新增對應的 token
      }));
    } catch (error) {
      this.logger.error('Failed to send FCM batch notification:', error);
      this.logger.error('Error details:', JSON.stringify(error, null, 2));
      this.logger.error('Error stack:', error.stack);
      return deviceTokens.map((token) => ({ error, token }));
    }
  }

  async validateToken(deviceToken: string): Promise<boolean> {
    try {
      await this.messaging().send({
        token: deviceToken,
        data: { test: 'true' },
      }, true); // dry run
      return true;
    } catch (error) {
      this.logger.warn(`Invalid FCM token: ${deviceToken}`);
      return false;
    }
  }

  /**
   * 發送推播到多個裝置（支援完整的 Android 通知配置）
   * 用於來電通知等需要高優先級、自訂通道的場景
   */
  async sendToDevices(
    deviceTokens: string[],
    payload: {
      title: string;
      body: string;
      data: any;
      android?: {
        priority?: 'high' | 'normal';
        ttl?: number;
        notification?: {
          channelId?: string;
          sound?: string;
          priority?: 'min' | 'low' | 'default' | 'high' | 'max';
          visibility?: 'private' | 'public' | 'secret';
          tag?: string;
          color?: string;
          defaultSound?: boolean;
          defaultVibrateTimings?: boolean;
        };
      };
    },
  ): Promise<FCMResponse[]> {
    try {
      this.logger.log(`📞 FCM sendToDevices: 發送到 ${deviceTokens.length} 個裝置`);
      this.logger.log(`Payload: ${JSON.stringify(payload, null, 2)}`);

      // 構建 FCM 訊息
      const multicastMessage: admin.messaging.MulticastMessage = {
        // 將標題和內容放入 data，讓 App 完全控制顯示
        data: {
          title: payload.title,
          body: payload.body,
          ...payload.data,
        },
        tokens: deviceTokens,
        android: {
          priority: payload.android?.priority || 'high',
          ttl: payload.android?.ttl,
          // 使用完整的 notification 配置
          notification: payload.android?.notification ? {
            channelId: payload.android.notification.channelId,
            sound: payload.android.notification.sound,
            priority: payload.android.notification.priority,
            visibility: payload.android.notification.visibility,
            tag: payload.android.notification.tag,
            color: payload.android.notification.color,
            defaultSound: payload.android.notification.defaultSound,
            defaultVibrateTimings: payload.android.notification.defaultVibrateTimings,
          } : undefined,
        },
      };

      this.logger.log(`Sending multicast message...`);
      const response = await this.messaging().sendEachForMulticast(multicastMessage);

      this.logger.log(`✅ FCM 來電推播結果: ${response.successCount}/${response.responses.length} 發送成功`);

      // 詳細錯誤分析
      response.responses.forEach((res, index) => {
        if (res.success) {
          this.logger.log(`✅ Token ${index + 1}: SUCCESS - MessageId: ${res.messageId}`);
        } else {
          this.logger.error(`❌ Token ${index + 1}: FAILED`);
          this.logger.error(`  Token: ${deviceTokens[index].substring(0, 20)}...`);
          this.logger.error(`  Error Code: ${res.error?.code}`);
          this.logger.error(`  Error Message: ${res.error?.message}`);
          if (res.error) {
            this.logger.error(`  Error Details:`, JSON.stringify(res.error, null, 2));
          }
        }
      });

      return response.responses.map((res, index) => ({
        messageId: res.success ? res.messageId : undefined,
        error: res.success ? undefined : res.error,
        token: deviceTokens[index],
      }));
    } catch (error) {
      this.logger.error('❌ Failed to send FCM notification to devices:', error);
      this.logger.error('Error details:', JSON.stringify(error, null, 2));
      this.logger.error('Error stack:', error.stack);
      return deviceTokens.map((token) => ({ error, token }));
    }
  }
}