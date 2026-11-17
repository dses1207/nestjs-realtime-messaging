import { Injectable, Logger } from '@nestjs/common';
import * as apn from '@parse/node-apn';
import * as fs from 'fs';
import { NotificationPayload, APNsResponse } from '../interfaces/notification.interface';

@Injectable()
export class APNsService {
  private readonly logger = new Logger(APNsService.name);
  private readonly productionProvider: any; // apn.Provider for production
  private readonly developmentProvider: any; // apn.Provider for development/sandbox

  constructor() {
    try {
      const keyPath = process.env.APNS_KEY_PATH || '/app/keys/apns-key.p8';
      // 沒有 Apple 金鑰時不建立 Provider：服務照常啟動，只是 APNs 推播停用（本機開發 / Demo 不需要金鑰）
      if (!fs.existsSync(keyPath)) {
        this.logger.warn(`APNs key not found (${keyPath}) — APNs push notifications are disabled`);
        return;
      }
      const tokenConfig = {
        key: keyPath,
        keyId: process.env.APNS_KEY_ID || '',
        teamId: process.env.APNS_TEAM_ID || '',
      };

      // 初始化 Production Provider
      this.productionProvider = new apn.Provider({
        token: tokenConfig,
        production: true,
      });

      // 初始化 Development/Sandbox Provider
      this.developmentProvider = new apn.Provider({
        token: tokenConfig,
        production: false,
      });

      this.logger.log('APNs Service initialized successfully');
      this.logger.log('📱 APNs Dual Mode: Production + Development providers ready');
    } catch (error) {
      this.logger.error('Failed to initialize APNs Service:', error);
      throw error;
    }
  }

  /**
   * 根據環境選擇正確的 Provider
   */
  private getProvider(environment: 'development' | 'production' = 'production'): any {
    if (!this.productionProvider) {
      throw new Error('APNs is disabled: no APNs key');
    }
    return environment === 'production' ? this.productionProvider : this.developmentProvider;
  }

  /**
   * 驗證 device token 格式
   * APNs device token 應該是 64 個十六進位字元（32 bytes）
   */
  private validateDeviceTokenFormat(token: string): { valid: boolean; reason?: string } {
    if (!token) {
      return { valid: false, reason: 'Token is empty or null' };
    }

    if (token.length !== 64) {
      return { valid: false, reason: `Invalid length: ${token.length} (expected 64)` };
    }

    if (!/^[0-9a-fA-F]{64}$/.test(token)) {
      return { valid: false, reason: 'Token contains invalid characters (must be hexadecimal)' };
    }

    return { valid: true };
  }

  /**
   * 根據 pushType 和 interruptionLevel 計算正確的 priority
   * iOS 13+ 規範：
   * - background 通知必須使用 priority 5
   * - alert 通知通常使用 priority 10
   * - time-sensitive 和 critical 必須使用 priority 10
   */
  private calculatePriority(
    pushType: 'alert' | 'background',
    interruptionLevel?: string
  ): number {
    // 背景通知必須使用 priority 5
    if (pushType === 'background') {
      return 5;
    }

    // 緊急通知使用 priority 10
    if (interruptionLevel === 'critical' || interruptionLevel === 'time-sensitive') {
      return 10;
    }

    // alert 類型預設為 10
    return 10;
  }

  /**
   * 取得預設的 expiration 時間戳
   */
  private getDefaultExpiration(): number {
    const expirationSeconds = parseInt(
      process.env.APNS_NOTIFICATION_EXPIRATION || '86400', // 預設24小時
      10
    );
    return Math.floor(Date.now() / 1000) + expirationSeconds;
  }

  /**
   * 取得預設的 interruption level
   */
  private getDefaultInterruptionLevel(): 'passive' | 'active' | 'time-sensitive' | 'critical' {
    const level = process.env.APNS_DEFAULT_INTERRUPTION_LEVEL || 'active';
    return level as 'passive' | 'active' | 'time-sensitive' | 'critical';
  }

  /**
   * 取得預設的 relevance score
   */
  private getDefaultRelevanceScore(): number {
    const score = parseFloat(process.env.APNS_DEFAULT_RELEVANCE_SCORE || '0.8');
    return Math.min(Math.max(score, 0), 1); // 限制在 0.0-1.0
  }

  async sendNotification(
    deviceToken: string,
    payload: NotificationPayload,
    environment: 'development' | 'production' = 'production',
  ): Promise<APNsResponse> {
    try {
      const notification = new apn.Notification();

      // ===== 基本配置 =====
      notification.alert = {
        title: payload.title,
        body: payload.body,
      };
      notification.sound = 'default';  // 主流 IM：每則都響
      notification.badge = 1;
      notification.topic = process.env.APNS_BUNDLE_ID || '';

      // ===== iOS 13+ 必需配置 =====
      notification.pushType = 'alert';

      // ===== iOS 15+ 新特性 =====
      // 中斷等級 (interruption-level)
      const interruptionLevel = payload.interruptionLevel || this.getDefaultInterruptionLevel();
      notification.interruptionLevel = interruptionLevel;

      // 相關性分數 (relevance-score)
      const relevanceScore = payload.relevanceScore !== undefined
        ? payload.relevanceScore
        : this.getDefaultRelevanceScore();
      notification.relevanceScore = relevanceScore;

      // 可修改內容 (mutable-content)
      if (payload.mutableContent) {
        notification.mutableContent = true;
      }

      // ===== Priority 動態設定（2025規範） =====
      notification.priority = this.calculatePriority('alert', interruptionLevel);

      // ===== 通知生命週期控制 =====
      notification.expiry = payload.expirationTimestamp || this.getDefaultExpiration();

      // ===== 通知分組 =====
      if (payload.threadId) {
        notification.threadId = payload.threadId;
      }

      // ===== iOS 16.1+ Live Activities =====
      if (payload.targetContentId) {
        notification.targetContentId = payload.targetContentId;
      }

      // ===== 進階功能 =====
      if (payload.category) {
        notification.category = payload.category;
      }

      if (payload.urlArgs && payload.urlArgs.length > 0) {
        notification.urlArgs = payload.urlArgs;
      }

      // ===== 自訂資料 =====
      // 將自訂資料放在 payload 的根層級（與 aps 同級）
      notification.payload = {
        title: payload.title,
        body: payload.body,
        ...(payload.threadId && { threadId: payload.threadId }),
        interruptionLevel,
        relevanceScore: relevanceScore.toString(),
        ...(payload.data || {}),
      };

      // ===== 發送通知 =====
      const provider = this.getProvider(environment);
      const result = await provider.send(notification, deviceToken);

      if (result.sent.length > 0) {
        this.logger.log(
          `✅ APNs sent [${environment}]: ${deviceToken.substring(0, 20)}... ` +
          `[${interruptionLevel}] score=${relevanceScore.toFixed(2)} priority=${notification.priority}`
        );
        return {
          sent: true,
          token: deviceToken,
          timestamp: new Date().toISOString(),
          interruptionLevel,
          relevanceScore,
          priority: notification.priority,
        };
      } else {
        const failedError = result.failed[0]?.error;
        const errorObj = {
          code: failedError?.code || 'unknown',
          message: failedError?.message || String(failedError) || 'Unknown error',
          status: failedError?.status,
        };
        this.logger.error(
          `❌ APNs failed [${environment}]: ${deviceToken.substring(0, 20)}... - ${JSON.stringify(errorObj)}`
        );
        return { sent: false, error: errorObj, token: deviceToken };
      }
    } catch (error) {
      this.logger.error('Failed to send APNs notification:', error);
      const errorObj = {
        message: error instanceof Error ? error.message : String(error),
      };
      return { sent: false, error: errorObj, token: deviceToken };
    }
  }

  /**
   * 檢查錯誤是否為環境相關錯誤
   */
  private isEnvironmentMismatchError(failure: any): boolean {
    const errorReason = failure.response?.reason?.toLowerCase() || '';
    const errorCode = failure.error?.code?.toLowerCase() || '';
    const errorMessage = failure.error?.message?.toLowerCase() || '';

    // 環境相關的錯誤原因
    const envErrors = [
      'badenvironmentkeyintoken',
      'baddevicetoken',
      'unregistered'
    ];

    return envErrors.some(err =>
      errorReason.includes(err) ||
      errorCode.includes(err) ||
      errorMessage.includes(err)
    );
  }

  async sendBatchNotification(
    deviceTokens: string[],
    payload: NotificationPayload,
    environment: 'development' | 'production' = 'production',
    isRetry: boolean = false,
  ): Promise<APNsResponse[]> {
    try {
      // ===== Device Token 診斷資訊 =====
      this.logger.debug(`🔍 Preparing batch notification for ${deviceTokens.length} device(s)`);
      this.logger.debug(`🔍 Target environment: ${environment}${isRetry ? ' (RETRY)' : ''}`);
      this.logger.debug(`🔍 APNs config: Bundle ID=${process.env.APNS_BUNDLE_ID || 'NOT_SET'}, Team ID=${process.env.APNS_TEAM_ID || 'NOT_SET'}, Key ID=${process.env.APNS_KEY_ID || 'NOT_SET'}`);

      // ===== 驗證所有 device tokens =====
      const tokenValidations = deviceTokens.map((token, index) => {
        const maskedToken = token.length >= 16
          ? `${token.substring(0, 8)}...${token.substring(token.length - 8)}`
          : token;
        const validation = this.validateDeviceTokenFormat(token);

        this.logger.debug(
          `🔍 Token ${index + 1}: ${maskedToken} | ` +
          `Valid: ${validation.valid} | ` +
          `Length: ${token.length}` +
          (validation.reason ? ` | Reason: ${validation.reason}` : '')
        );

        return { token, maskedToken, validation };
      });

      // 過濾出無效的 tokens
      const invalidTokens = tokenValidations.filter(tv => !tv.validation.valid);
      if (invalidTokens.length > 0) {
        this.logger.warn(
          `⚠️  Found ${invalidTokens.length} invalid token(s). ` +
          `These will likely fail at APNs server.`
        );
      }

      const notification = new apn.Notification();

      // ===== 基本配置 =====
      notification.alert = {
        title: payload.title,
        body: payload.body,
      };
      notification.sound = 'default';  // 主流 IM：每則都響
      notification.badge = 1;
      notification.topic = process.env.APNS_BUNDLE_ID || '';

      // ===== iOS 13+ 必需配置 =====
      notification.pushType = 'alert';

      // ===== iOS 15+ 新特性 =====
      const interruptionLevel = payload.interruptionLevel || this.getDefaultInterruptionLevel();
      notification.interruptionLevel = interruptionLevel;

      const relevanceScore = payload.relevanceScore !== undefined
        ? payload.relevanceScore
        : this.getDefaultRelevanceScore();
      notification.relevanceScore = relevanceScore;

      if (payload.mutableContent) {
        notification.mutableContent = true;
      }

      // ===== Priority 動態設定 =====
      notification.priority = this.calculatePriority('alert', interruptionLevel);

      // ===== 通知生命週期控制 =====
      notification.expiry = payload.expirationTimestamp || this.getDefaultExpiration();

      // ===== 通知分組 =====
      if (payload.threadId) {
        notification.threadId = payload.threadId;
      }

      // ===== iOS 16.1+ Live Activities =====
      if (payload.targetContentId) {
        notification.targetContentId = payload.targetContentId;
      }

      // ===== 進階功能 =====
      if (payload.category) {
        notification.category = payload.category;
      }

      if (payload.urlArgs && payload.urlArgs.length > 0) {
        notification.urlArgs = payload.urlArgs;
      }

      // ===== 自訂資料 =====
      // 將自訂資料放在 payload 的根層級（與 aps 同級）
      notification.payload = {
        title: payload.title,
        body: payload.body,
        ...(payload.threadId && { threadId: payload.threadId }),
        interruptionLevel,
        relevanceScore: relevanceScore.toString(),
        ...(payload.data || {}),
      };

      // ===== 批次發送通知 =====
      const provider = this.getProvider(environment);
      const result = await provider.send(notification, deviceTokens);

      this.logger.log(
        `📦 APNs batch [${environment}]: ${result.sent.length}/${deviceTokens.length} successful ` +
        `[${interruptionLevel}] score=${relevanceScore.toFixed(2)} priority=${notification.priority}`
      );

      // ===== 記錄失敗的詳細資訊（增強版） =====
      if (result.failed.length > 0) {
        this.logger.warn(`❌ APNs batch failures: ${result.failed.length}/${deviceTokens.length} devices failed`);
        result.failed.forEach((failure) => {
          const maskedToken = `${failure.device.substring(0, 8)}...${failure.device.substring(failure.device.length - 8)}`;
          const errorCode = failure.error?.code || 'unknown';
          const errorStatus = failure.error?.status || 'N/A';
          const errorMessage = failure.error?.message || String(failure.error) || 'Unknown error';
          const errorReason = failure.response?.reason || 'N/A';

          // ===== 增強錯誤日誌：輸出完整的 error 和 response 物件 =====
          this.logger.error(
            `  ❌ Token: ${maskedToken} | ` +
            `Code: ${errorCode} | ` +
            `Status: ${errorStatus} | ` +
            `Reason: ${errorReason} | ` +
            `Message: ${errorMessage}`
          );

          // 輸出完整的錯誤物件以便診斷
          this.logger.debug(`  🔍 Full error object: ${JSON.stringify(failure.error, null, 2)}`);
          this.logger.debug(`  🔍 Full response object: ${JSON.stringify(failure.response, null, 2)}`);
        });
      }

      // ===== 自動重試機制：針對環境錯誤 =====
      const responses: APNsResponse[] = [];
      const tokensNeedRetry: string[] = [];

      for (const token of deviceTokens) {
        const sentDevice = result.sent.find(s => s.device === token);
        const failedDevice = result.failed.find(f => f.device === token);

        if (sentDevice) {
          // 成功發送
          responses.push({
            sent: true,
            token,
            timestamp: new Date().toISOString(),
            interruptionLevel,
            relevanceScore,
            priority: notification.priority,
            environment, // 記錄實際使用的環境
          });
        } else if (failedDevice) {
          // 檢查是否為環境相關錯誤且未重試過
          if (!isRetry && this.isEnvironmentMismatchError(failedDevice)) {
            tokensNeedRetry.push(token);
            this.logger.warn(
              `  🔄 Will retry token ${token.substring(0, 8)}...${token.substring(token.length - 8)} ` +
              `with ${environment === 'production' ? 'development' : 'production'} environment`
            );
          } else {
            // 不重試或重試後仍失敗
            const errorObj = {
              code: failedDevice.error?.code || 'unknown',
              message: failedDevice.error?.message || String(failedDevice.error) || 'Unknown error',
              status: failedDevice.error?.status,
              reason: failedDevice.response?.reason,
            };
            responses.push({ sent: false, error: errorObj, token, environment });
          }
        } else {
          responses.push({ sent: false, error: { message: 'Unknown error' }, token, environment });
        }
      }

      // ===== 執行重試：使用相反的環境 =====
      if (tokensNeedRetry.length > 0 && !isRetry) {
        const alternativeEnv = environment === 'production' ? 'development' : 'production';
        this.logger.log(`🔄 Retrying ${tokensNeedRetry.length} token(s) with ${alternativeEnv} environment...`);

        const retryResults = await this.sendBatchNotification(
          tokensNeedRetry,
          payload,
          alternativeEnv,
          true, // 標記為重試
        );

        // 合併重試結果
        retryResults.forEach(retryResult => {
          if (retryResult.sent) {
            this.logger.log(
              `  ✅ Retry SUCCESS for token ${retryResult.token.substring(0, 8)}...${retryResult.token.substring(retryResult.token.length - 8)} ` +
              `using ${alternativeEnv} environment`
            );
          }
          responses.push(retryResult);
        });
      }

      return responses;
    } catch (error) {
      this.logger.error('Failed to send APNs batch notification:', error);
      const errorObj = {
        message: error instanceof Error ? error.message : String(error),
      };
      return deviceTokens.map((token) => ({ sent: false, error: errorObj, token, environment }));
    }
  }

  async validateToken(deviceToken: string, environment: 'development' | 'production' = 'production'): Promise<boolean> {
    try {
      const testNotification = new apn.Notification();
      testNotification.alert = 'Test';
      testNotification.topic = process.env.APNS_BUNDLE_ID || '';

      const provider = this.getProvider(environment);
      const result = await provider.send(testNotification, deviceToken);
      return result.sent.length > 0;
    } catch (error) {
      this.logger.warn(`Invalid APNs token: ${deviceToken}`);
      return false;
    }
  }

  /**
   * 發送推播到多個裝置（簡化版，與 FCM Service 介面一致）
   * 支援 Critical Alert 和所有 iOS 15+ 特性
   */
  async sendToDevices(
    deviceTokens: string[],
    payload: {
      title: string;
      body: string;
      data: any;
      interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical';
      relevanceScore?: number;
      sound?: {
        critical?: boolean;  // Critical Alert 聲音
        name?: string;
        volume?: number;
      } | string;
      badge?: number;
      category?: string;
      threadId?: string;
      mutableContent?: boolean;
    },
    environment: 'development' | 'production' = 'production',
  ): Promise<APNsResponse[]> {
    try {
      this.logger.log(`📤 發送 APNs 推播到 ${deviceTokens.length} 個裝置`);
      this.logger.debug(`   環境: ${environment}`);
      this.logger.debug(`   中斷等級: ${payload.interruptionLevel || 'active'}`);

      // 檢查是否為 Critical Alert
      const isCriticalAlert = payload.interruptionLevel === 'critical';
      if (isCriticalAlert) {
        this.logger.log(`🚨 使用 Critical Alert 模式（突破勿擾模式）`);
      }

      // 準備 APNs Notification
      const notification = new apn.Notification();

      // ===== 基本配置 =====
      notification.alert = {
        title: payload.title,
        body: payload.body,
      };

      // Badge
      if (payload.badge !== undefined) {
        notification.badge = payload.badge;
      }

      // Topic
      notification.topic = process.env.APNS_BUNDLE_ID || '';

      // ===== iOS 13+ 必需配置 =====
      notification.pushType = 'alert';

      // ===== iOS 15+ 新特性 =====
      // 中斷等級
      const interruptionLevel = payload.interruptionLevel || 'active';
      notification.interruptionLevel = interruptionLevel;

      // 相關性分數
      if (payload.relevanceScore !== undefined) {
        notification.relevanceScore = payload.relevanceScore;
      }

      // ===== Critical Alert 聲音配置 =====
      if (isCriticalAlert && typeof payload.sound === 'object' && payload.sound.critical) {
        // Critical Alert 使用特殊聲音格式
        notification.sound = {
          critical: 1,  // 啟用 Critical Alert
          name: payload.sound.name || 'default',
          volume: payload.sound.volume || 1.0,
        };
        this.logger.log(`🔊 Critical Alert 聲音: ${payload.sound.name}, 音量: ${payload.sound.volume}`);
      } else if (typeof payload.sound === 'string') {
        notification.sound = payload.sound;
      } else if (payload.sound && typeof payload.sound === 'object') {
        notification.sound = payload.sound.name || 'default';
      } else {
        notification.sound = 'default';
      }

      // Category (for CallKit integration)
      if (payload.category) {
        notification.category = payload.category;
      }

      // Thread ID (for grouping)
      if (payload.threadId) {
        notification.threadId = payload.threadId;
      }

      // Mutable Content (for Notification Service Extension)
      if (payload.mutableContent) {
        notification.mutableContent = true;
      }

      // ===== 自訂資料 =====
      if (payload.data) {
        notification.payload = payload.data;
      }

      // ===== Priority（Critical Alert 必須使用 10）=====
      notification.priority = this.calculatePriority('alert', interruptionLevel);

      // ===== Expiration =====
      notification.expiry = this.getDefaultExpiration();

      // ===== 發送推播 =====
      const provider = this.getProvider(environment);
      const results: APNsResponse[] = [];

      for (const token of deviceTokens) {
        try {
          const result = await provider.send(notification, token);

          if (result.sent && result.sent.length > 0) {
            this.logger.log(`✅ APNs 發送成功: ${token.substring(0, 20)}...`);
            results.push({
              sent: true,
              token,
              timestamp: new Date().toISOString(),
              environment,
            });
          } else if (result.failed && result.failed.length > 0) {
            const failure = result.failed[0];
            this.logger.error(`❌ APNs 發送失敗: ${token.substring(0, 20)}... - ${JSON.stringify(failure)}`);
            results.push({
              sent: false,
              token,
              error: failure.error || failure.response,
              environment,
            });
          }
        } catch (error) {
          this.logger.error(`❌ APNs 發送異常: ${token.substring(0, 20)}...`, error);
          results.push({
            sent: false,
            token,
            error: {
              message: error instanceof Error ? error.message : String(error),
            },
            environment,
          });
        }
      }

      const successCount = results.filter(r => r.sent).length;
      this.logger.log(`📊 APNs 發送完成: ${successCount}/${deviceTokens.length} 成功`);

      return results;

    } catch (error) {
      this.logger.error('❌ APNs sendToDevices 失敗:', error);
      return deviceTokens.map(token => ({
        sent: false,
        token,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
        environment,
      }));
    }
  }

  async shutdown(): Promise<void> {
    if (!this.productionProvider) return;
    await Promise.all([
      this.productionProvider.shutdown(),
      this.developmentProvider.shutdown(),
    ]);
    this.logger.log('APNs Service shutdown: both providers closed');
  }
}