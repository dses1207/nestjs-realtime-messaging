import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UserOnlineStatus, UserOnlineStatusDocument } from '../schemas/user-online-status.schema';

@Injectable()
export class OnlineStatusService {
  private readonly logger = new Logger(OnlineStatusService.name);

  constructor(
    @InjectModel(UserOnlineStatus.name)
    private userOnlineStatusModel: Model<UserOnlineStatusDocument>,
  ) {}

  /**
   * 設定用戶上線狀態
   */
  async setUserOnline(
    userId: string, 
    socketId?: string,
    userAgent?: string,
    ipAddress?: string
  ): Promise<void> {
    try {
      if (!userId || !Types.ObjectId.isValid(userId)) {
        throw new Error(`無效的用戶ID格式: ${userId}`);
      }

      const userObjectId = new Types.ObjectId(userId);
      const now = new Date();

      const updateData: any = {
        isOnline: true,
        lastActiveAt: now,
        lastHeartbeat: now,
      };

      if (userAgent) updateData.userAgent = userAgent;
      if (ipAddress) updateData.ipAddress = ipAddress;

      const result = await this.userOnlineStatusModel.findOneAndUpdate(
        { userId: userObjectId },
        {
          $set: updateData,
          ...(socketId && { $addToSet: { connectedSockets: socketId } })
        },
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true 
        }
      );

      this.logger.debug(`User ${userId} set online, socket: ${socketId}`);
    } catch (error) {
      this.logger.error(`Failed to set user online ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 設定用戶離線狀態
   */
  async setUserOffline(userId: string, socketId?: string): Promise<void> {
    try {
      if (!userId || !Types.ObjectId.isValid(userId)) {
        throw new Error(`無效的用戶ID格式: ${userId}`);
      }

      const userObjectId = new Types.ObjectId(userId);

      if (socketId) {
        // 移除特定的 socket 連接
        await this.userOnlineStatusModel.updateOne(
          { userId: userObjectId },
          { 
            $pull: { connectedSockets: socketId },
            $set: { lastActiveAt: new Date() }
          }
        );

        // 檢查是否還有其他連接
        const status = await this.userOnlineStatusModel.findOne({ userId: userObjectId });
        if (status && status.connectedSockets.length === 0) {
          // 沒有其他連接，設定為離線
          await this.userOnlineStatusModel.updateOne(
            { userId: userObjectId },
            { 
              $set: { 
                isOnline: false, 
                lastActiveAt: new Date() 
              } 
            }
          );
        }
      } else {
        // 直接設定用戶離線（清除所有連接）
        await this.userOnlineStatusModel.updateOne(
          { userId: userObjectId },
          { 
            $set: { 
              isOnline: false, 
              lastActiveAt: new Date(),
              connectedSockets: []
            } 
          },
          { upsert: true }
        );
      }

      this.logger.debug(`User ${userId} set offline, socket: ${socketId}`);
    } catch (error) {
      this.logger.error(`Failed to set user offline ${userId}:`, error);
      throw error;
    }
  }

  /**
   * 更新用戶心跳
   */
  async updateHeartbeat(userId: string, socketId?: string): Promise<void> {
    try {
      if (!userId || !Types.ObjectId.isValid(userId)) {
        return; // 忽略無效的用戶ID，避免頻繁的錯誤日誌
      }

      const userObjectId = new Types.ObjectId(userId);
      const now = new Date();

      await this.userOnlineStatusModel.updateOne(
        { userId: userObjectId },
        { 
          $set: { 
            lastHeartbeat: now,
            lastActiveAt: now,
            isOnline: true
          },
          ...(socketId && { $addToSet: { connectedSockets: socketId } })
        },
        { upsert: true }
      );

      this.logger.debug(`Heartbeat updated for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to update heartbeat for user ${userId}:`, error);
    }
  }

  /**
   * 檢查用戶是否在線
   */
  async isUserOnline(userId: string): Promise<boolean> {
    try {
      if (!userId || !Types.ObjectId.isValid(userId)) {
        return false;
      }

      const userObjectId = new Types.ObjectId(userId);
      const status = await this.userOnlineStatusModel.findOne({ userId: userObjectId });

      if (!status) {
        return false;
      }

      // 檢查最後心跳是否在 5 分鐘內
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const isRecentlyActive = status.lastHeartbeat > fiveMinutesAgo;

      return status.isOnline && isRecentlyActive;
    } catch (error) {
      this.logger.error(`Failed to check user online status ${userId}:`, error);
      return false;
    }
  }

  /**
   * 批量檢查用戶是否在線
   */
  async areUsersOnline(userIds: string[]): Promise<Record<string, boolean>> {
    try {
      const validUserIds = userIds.filter(id => Types.ObjectId.isValid(id));
      const userObjectIds = validUserIds.map(id => new Types.ObjectId(id));

      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const statuses = await this.userOnlineStatusModel.find({
        userId: { $in: userObjectIds },
        isOnline: true,
        lastHeartbeat: { $gte: fiveMinutesAgo }
      }).select('userId');

      const onlineUserIds = new Set(statuses.map(s => s.userId.toString()));
      
      const result: Record<string, boolean> = {};
      validUserIds.forEach(userId => {
        result[userId] = onlineUserIds.has(userId);
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to check multiple user online status:', error);
      return {};
    }
  }

  /**
   * 取得在線用戶統計
   */
  async getOnlineStats(): Promise<{
    totalOnline: number;
    totalUsers: number;
    recentlyActive: number;
  }> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const [totalOnline, totalUsers, recentlyActive] = await Promise.all([
        this.userOnlineStatusModel.countDocuments({
          isOnline: true,
          lastHeartbeat: { $gte: fiveMinutesAgo }
        }),
        this.userOnlineStatusModel.countDocuments({}),
        this.userOnlineStatusModel.countDocuments({
          lastActiveAt: { $gte: oneHourAgo }
        })
      ]);

      return {
        totalOnline,
        totalUsers,
        recentlyActive
      };
    } catch (error) {
      this.logger.error('Failed to get online stats:', error);
      return { totalOnline: 0, totalUsers: 0, recentlyActive: 0 };
    }
  }

  /**
   * 清理離線用戶（定期任務）
   * 每5分鐘執行一次，清理超過5分鐘沒有心跳的用戶
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupOfflineUsers(): Promise<void> {
    try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      
      const result = await this.userOnlineStatusModel.updateMany(
        {
          isOnline: true,
          lastHeartbeat: { $lt: fiveMinutesAgo }
        },
        {
          $set: { 
            isOnline: false,
            connectedSockets: []
          }
        }
      );

      if (result.modifiedCount > 0) {
        this.logger.log(`Cleaned up ${result.modifiedCount} offline users`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup offline users:', error);
    }
  }

  /**
   * 清理舊的狀態記錄（每日執行）
   * 刪除30天前的非活躍用戶記錄
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async cleanupOldStatusRecords(): Promise<void> {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      const result = await this.userOnlineStatusModel.deleteMany({
        isOnline: false,
        lastActiveAt: { $lt: thirtyDaysAgo }
      });

      if (result.deletedCount > 0) {
        this.logger.log(`Cleaned up ${result.deletedCount} old status records`);
      }
    } catch (error) {
      this.logger.error('Failed to cleanup old status records:', error);
    }
  }
}