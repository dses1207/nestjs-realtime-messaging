import { Injectable, Logger } from '@nestjs/common';
import { AuthenticatedSocket } from '../interfaces/message.interface';

@Injectable()
export class ConnectionManagerService {
  private readonly logger = new Logger(ConnectionManagerService.name);
  
  // 一對多映射：userId -> Set<AuthenticatedSocket>
  private userConnections = new Map<string, Set<AuthenticatedSocket>>();
  
  // 快速查找：tokenId -> AuthenticatedSocket
  private tokenConnections = new Map<string, AuthenticatedSocket>();
  
  // 快速查找：socketId -> AuthenticatedSocket
  private socketMap = new Map<string, AuthenticatedSocket>();

  /**
   * 新增連線（基於Token）
   */
  addConnection(socket: AuthenticatedSocket): void {
    const { userId, tokenId } = socket;

    // 檢查是否已有相同token的連線，如果有則斷開舊連線
    const existingConnection = this.tokenConnections.get(tokenId);
    if (existingConnection) {
      this.logger.log(`Replacing existing connection for token: ${tokenId}`);
      this.removeConnectionBySocket(existingConnection);
      existingConnection.disconnect(true);
    }

    // 初始化用戶連線集合
    if (!this.userConnections.has(userId)) {
      this.userConnections.set(userId, new Set());
    }

    // 新增連線到各個映射表
    this.userConnections.get(userId)!.add(socket);
    this.tokenConnections.set(tokenId, socket);
    this.socketMap.set(socket.id, socket);

    this.logger.log(`User ${userId} connected with token ${tokenId.substring(0, 8)}...`);
    this.logger.log(`User ${userId} now has ${this.userConnections.get(userId)!.size} active connections`);
  }

  /**
   * 移除連線（基於Token ID）
   */
  removeConnection(tokenId: string): boolean {
    const socket = this.tokenConnections.get(tokenId);
    if (!socket) return false;

    return this.removeConnectionBySocket(socket);
  }

  /**
   * 移除連線（基於Socket）
   */
  removeConnectionBySocket(socket: AuthenticatedSocket): boolean {
    const { userId, tokenId } = socket;

    // 從用戶連線集合中移除
    const userSockets = this.userConnections.get(userId);
    if (userSockets) {
      userSockets.delete(socket);
      
      // 如果用戶沒有其他連線了，清理用戶記錄
      if (userSockets.size === 0) {
        this.userConnections.delete(userId);
      }
    }

    // 從其他映射表中移除
    this.tokenConnections.delete(tokenId);
    this.socketMap.delete(socket.id);

    this.logger.log(`Removed connection for user ${userId}, token ${tokenId.substring(0, 8)}...`);
    return true;
  }

  /**
   * 取得用戶的所有連線
   */
  getUserConnections(userId: string): Set<AuthenticatedSocket> {
    return this.userConnections.get(userId) || new Set();
  }

  /**
   * 根據Token ID取得連線
   */
  getConnectionByToken(tokenId: string): AuthenticatedSocket | undefined {
    return this.tokenConnections.get(tokenId);
  }

  /**
   * 根據Socket ID取得連線
   */
  getConnectionBySocketId(socketId: string): AuthenticatedSocket | undefined {
    return this.socketMap.get(socketId);
  }

  /**
   * 檢查用戶是否在線
   */
  isUserOnline(userId: string): boolean {
    const connections = this.userConnections.get(userId);
    return connections ? connections.size > 0 : false;
  }

  /**
   * 檢查用戶是否在特定房間
   */
  isUserInRoom(userId: string, roomId: string): boolean {
    const userConnections = this.userConnections.get(userId);
    if (!userConnections) return false;

    for (const socket of userConnections) {
      if (socket.rooms.has(roomId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 廣播訊息到用戶的所有連線
   */
  async broadcastToUser(userId: string, event: string, data: any): Promise<boolean> {
    const userConnections = this.userConnections.get(userId);
    if (!userConnections || userConnections.size === 0) {
      this.logger.debug(`No connections found for user ${userId}`);
      return false;
    }

    let sentCount = 0;
    const timestamp = new Date().toISOString();

    for (const socket of userConnections) {
      try {
        socket.emit(event, {
          ...data,
          tokenId: socket.tokenId,
          timestamp
        });
        sentCount++;
      } catch (error) {
        this.logger.error(`Failed to send ${event} to user ${userId} token ${socket.tokenId.substring(0, 8)}...:`, error);
        // 如果發送失敗，考慮移除這個壞的連線
        this.removeConnectionBySocket(socket);
      }
    }

    this.logger.debug(`Sent ${event} to ${sentCount}/${userConnections.size} connections for user ${userId}`);
    return sentCount > 0;
  }

  /**
   * 廣播訊息到多個用戶
   */
  async broadcastToUsers(userIds: string[], event: string, data: any): Promise<number> {
    let successCount = 0;
    
    const promises = userIds.map(async (userId) => {
      const success = await this.broadcastToUser(userId, event, data);
      if (success) successCount++;
    });

    await Promise.all(promises);
    return successCount;
  }

  /**
   * 強制斷開用戶的特定Token連線
   */
  async forceDisconnectUserToken(userId: string, tokenId: string, reason: string = 'admin_action'): Promise<boolean> {
    const socket = this.tokenConnections.get(tokenId);
    if (!socket || socket.userId !== userId) return false;

    socket.emit('force_disconnect', { reason });
    socket.disconnect(true);

    this.logger.log(`Force disconnected user ${userId} token ${tokenId.substring(0, 8)}...: ${reason}`);
    return true;
  }

  /**
   * 取得所有在線用戶列表
   */
  getOnlineUsers(): string[] {
    return Array.from(this.userConnections.keys());
  }

  /**
   * 取得用戶的所有Token ID
   */
  getUserTokens(userId: string): string[] {
    const userConnections = this.userConnections.get(userId);
    if (!userConnections) return [];

    return Array.from(userConnections).map(socket => socket.tokenId);
  }

  /**
   * 批量檢查用戶在線狀態
   */
  areUsersOnline(userIds: string[]): Record<string, boolean> {
    const result: Record<string, boolean> = {};
    userIds.forEach(userId => {
      result[userId] = this.isUserOnline(userId);
    });
    return result;
  }

  /**
   * 取得連線統計資訊
   */
  getConnectionStats(): {
    totalOnlineUsers: number;
    totalConnections: number;
    totalTokens: number;
    userConnectionCounts: Record<string, number>;
    platformStats: Record<string, number>;
  } {
    const userConnectionCounts: Record<string, number> = {};
    const platformStats: Record<string, number> = {};
    let totalConnections = 0;

    for (const [userId, connections] of this.userConnections) {
      userConnectionCounts[userId] = connections.size;
      totalConnections += connections.size;

      for (const socket of connections) {
        const platform = socket.deviceInfo.type;
        platformStats[platform] = (platformStats[platform] || 0) + 1;
      }
    }

    return {
      totalOnlineUsers: this.userConnections.size,
      totalConnections,
      totalTokens: this.tokenConnections.size,
      userConnectionCounts,
      platformStats
    };
  }

  /**
   * 廣播系統通知給所有在線用戶
   */
  async broadcastSystemNotification(notification: {
    type: 'system' | 'maintenance' | 'announcement';
    title: string;
    body: string;
    data?: any;
  }): Promise<number> {
    const onlineUsers = this.getOnlineUsers();
    return await this.broadcastToUsers(onlineUsers, 'systemNotification', notification);
  }

  /**
   * 清理所有連線（用於服務關閉時）
   */
  cleanup(): void {
    this.logger.log('Cleaning up all connections...');
    
    // 通知所有連線即將關閉
    for (const [userId, connections] of this.userConnections) {
      for (const socket of connections) {
        socket.emit('server_shutdown', { 
          message: 'Server is shutting down',
          timestamp: new Date().toISOString()
        });
        socket.disconnect(true);
      }
    }

    // 清空所有映射表
    this.userConnections.clear();
    this.tokenConnections.clear();
    this.socketMap.clear();
    
    this.logger.log('All connections cleaned up');
  }

  /**
   * 定期清理無效連線（可以被定時任務調用）
   */
  cleanupInvalidConnections(): number {
    let cleanedCount = 0;
    const invalidSockets: AuthenticatedSocket[] = [];

    // 檢查所有socket是否仍然連線
    for (const socket of this.tokenConnections.values()) {
      if (!socket.connected) {
        invalidSockets.push(socket);
      }
    }

    // 清理無效連線
    for (const socket of invalidSockets) {
      this.removeConnectionBySocket(socket);
      cleanedCount++;
    }

    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} invalid connections`);
    }

    return cleanedCount;
  }
}