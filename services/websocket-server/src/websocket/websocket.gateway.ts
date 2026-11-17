import {
  WebSocketGateway as NestWebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ChatClientService } from '../chat-client/chat-client.service';
import { NotificationClientService } from '../notification-client/notification-client.service';
import { 
  MessagePayload, 
  BroadcastMessagePayload, 
  AuthenticatedSocket, 
  JWTPayload,
  DeviceInfo 
} from '../interfaces/message.interface';
import { JwtService } from '@nestjs/jwt';
import { ConnectionManagerService } from './connection-manager.service';
import { RtcClientService } from '../rtc-client/rtc-client.service';

interface ConnectionStats {
  totalConnections: number;
  totalUsers: number;
  totalTokens: number;
  serverUptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  platformStats: Record<string, number>;
}

@Injectable()
@NestWebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  }
  // namespace: '/chat',
})
export class WebSocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WebSocketGateway.name);
  
  // 心跳配置
  private readonly HEARTBEAT_INTERVAL = 30000; // 30秒
  private readonly HEARTBEAT_TIMEOUT = 60000;  // 60秒超時
  private readonly MAX_CONNECTIONS_PER_USER = 5;
  
  // 心跳定時器管理
  private heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private chatClientService: ChatClientService,
    private notificationClientService: NotificationClientService,
    private jwtService: JwtService,
    private connectionManager: ConnectionManagerService,
    private rtcClientService: RtcClientService,
  ) {}

  async handleConnection(client: Socket) {
    this.logger.log(`[Connection Attempt] New client trying to connect from: ${client.handshake.address}`);
    this.logger.log(`[Connection Attempt] Transport: ${client.conn.transport.name}`);
    
    const token = client.handshake.auth.token as string;
    if (!token) {
      this.logger.warn('Client connected without token. Disconnecting.');
      client.disconnect();
      return;
    }

    try {
      // 1. Token驗證與解析
      const payload: JWTPayload = this.jwtService.verify(token, {
        audience: 'websocket',
      });
      
      const { sub: userId, jti: tokenId } = payload;

      if (!userId || !tokenId) {
        this.logger.warn('Invalid token: userId or tokenId is missing');
        client.disconnect();
        return;
      }

      // 2. 檢查連線數限制
      await this.enforceConnectionLimit(userId);

      // 3. 建立設備資訊
      const deviceInfo: DeviceInfo = {
        type: this.detectPlatform(client.handshake.headers['user-agent']),
        userAgent: client.handshake.headers['user-agent'],
        ipAddress: client.handshake.address,
        fcmToken: payload.device?.fcmToken,
      };

      // 4. 建立認證Socket
      const authenticatedSocket = this.createAuthenticatedSocket(client, payload, deviceInfo);

      // 5. 透過ConnectionManager新增連線
      this.connectionManager.addConnection(authenticatedSocket);

      // 6. 監聽傳輸升級事件
      client.conn.on('upgrade', () => {
        this.logger.log(`[Transport Upgrade] User ${userId} upgraded to: ${client.conn.transport.name}`);
        client.emit('transportUpgraded', {
          transport: client.conn.transport.name,
          timestamp: new Date().toISOString()
        });
      });

      client.conn.on('upgradeError', (error) => {
        this.logger.warn(`[Transport Upgrade Failed] User ${userId}: ${error.message}`);
        client.emit('transportUpgradeError', {
          error: error.message,
          timestamp: new Date().toISOString()
        });
      });

      // 7. 開始心跳監控
      this.startHeartbeatMonitoring(authenticatedSocket);

      // 8. 發送連線確認
      client.emit('authenticated', {
        userId,
        tokenId: tokenId.substring(0, 8) + '...',  // 只顯示部分tokenId用於調試
        platform: deviceInfo.type,
        serverTime: new Date().toISOString(),
        connectionId: client.id,
        initialTransport: client.conn.transport.name
      });

      const stats = this.connectionManager.getConnectionStats();
      this.logger.log(`User ${userId} authenticated successfully via ${client.conn.transport.name}`);
      this.logger.log(`Connection stats: ${stats.totalConnections} total, ${stats.totalOnlineUsers} users, ${stats.totalTokens} tokens`);
      
    } catch (error) {
      this.logger.warn(`Token verification failed: ${error.message}. Disconnecting.`);
      client.disconnect();
    }
  }

  /**
   * 建立AuthenticatedSocket
   */
  private createAuthenticatedSocket(
    client: Socket, 
    payload: JWTPayload, 
    deviceInfo: DeviceInfo
  ): AuthenticatedSocket {
    const authenticatedSocket = client as AuthenticatedSocket;
    
    // 設定認證資訊
    authenticatedSocket.userId = payload.sub;
    authenticatedSocket.tokenId = payload.jti;
    authenticatedSocket.deviceInfo = deviceInfo;
    authenticatedSocket.authenticatedAt = new Date();
    
    // 保持向後相容
    client.data.userId = payload.sub;
    client.data.tokenId = payload.jti;
    
    return authenticatedSocket;
  }

  handleDisconnect(client: Socket) {
    const authenticatedSocket = this.connectionManager.getConnectionBySocketId(client.id);
    if (!authenticatedSocket) {
      this.logger.debug(`No authenticated connection found for disconnecting client: ${client.id}`);
      return;
    }

    const { userId, tokenId } = authenticatedSocket;

    // 清理心跳監控
    this.stopHeartbeatMonitoring(authenticatedSocket);

    // 透過ConnectionManager移除連線
    this.connectionManager.removeConnectionBySocket(authenticatedSocket);

    const isUserStillOnline = this.connectionManager.isUserOnline(userId);
    const stats = this.connectionManager.getConnectionStats();
    
    this.logger.log(`User ${userId} disconnected (token: ${tokenId.substring(0, 8)}...)`);
    this.logger.log(`Connection stats: ${stats.totalConnections} total, ${stats.totalOnlineUsers} users, ${stats.totalTokens} tokens`);
    
    if (!isUserStillOnline) {
      this.logger.log(`User ${userId} is now completely offline`);
    }
  }

  @SubscribeMessage('sendMessage')
  async handleMessage(
    @MessageBody() data: MessagePayload,
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const senderId = client.data.userId;
      
      if (!senderId) {
        client.emit('error', { message: '未授權的用戶' });
        return;
      }

      // 驗證訊息內容
      if (!data.content || !data.conversationId) {
        client.emit('error', { message: '訊息內容或聊天室 ID 不能為空' });
        return;
      }

      // 1. 透過 gRPC 儲存訊息到資料庫
      const savedMessage = await this.chatClientService.saveMessage(
        data.content,
        data.conversationId,
        senderId,
        data.messageType || 'text',
        data.fileInfo?.fileId,
        data.fileInfo ? {
          originalName: data.fileInfo.originalName,
          fileSize: data.fileInfo.fileSize,
          contentType: data.fileInfo.contentType
        } : undefined
      );

      // 2. 根據conversationID取得聊天室其他成員ID
      const participantIds = await this.chatClientService.getConversationParticipants(
        data.conversationId,
      );

      // 3. 取得聊天室詳細資訊
      const conversationDetails = await this.chatClientService.getConversationDetails(
        data.conversationId,
      );

      // 4. 準備廣播的訊息
      const broadcastMessage: BroadcastMessagePayload = {
        messageId: savedMessage.message.id,
        content: savedMessage.message.content, // 使用Chat Service回傳的內容（檔案訊息已是URL）
        conversationId: data.conversationId,
        senderId,
        senderName: data.senderName,
        senderProfilePicture: data.senderProfilePicture,
        timestamp: savedMessage.message.timestamp,
        messageType: savedMessage.message.messageType || 'text',
        fileInfo: savedMessage.message.fileInfo || data.fileInfo, // 使用完整的檔案資訊
        read_count: 0, // 新訊息的已讀數為 0
      };

      // 5. 準備通知資料
      let notificationContent = savedMessage.message.content;
      
      // 針對檔案訊息提供更友好的通知內容
      if (savedMessage.message.messageType !== 'text' && savedMessage.message.fileInfo) {
        const fileType = savedMessage.message.messageType;
        const fileName = savedMessage.message.fileInfo.originalName || 'Unknown File';
        switch (fileType) {
          case 'image':
            notificationContent = `📷 傳送了圖片: ${fileName}`;
            break;
          case 'document':
            notificationContent = `📄 傳送了文件: ${fileName}`;
            break;
          case 'file':
          default:
            notificationContent = `📎 傳送了檔案: ${fileName}`;
            break;
        }
      }

      const notificationData = {
        conversationId: data.conversationId,
        senderId,
        senderName: data.senderName || 'Unknown User',
        content: notificationContent,
        messageId: savedMessage.message.id,
        timestamp: savedMessage.message.timestamp,
        conversationName: conversationDetails.name,
        isGroupMessage: conversationDetails.type === 'group',
        messageType: savedMessage.message.messageType || 'text'
      };

      this.logger.log(`📨 Notification prepared: ${savedMessage.message.messageType || 'text'} from ${data.senderName}`);

      // 6. 新的一對多廣播邏輯：用userID找到維護映射表的所有socket連線
      const receiverIds = participantIds.filter(id => id !== senderId);
      
      for (const receiverId of receiverIds) {
        const isOnline = this.connectionManager.isUserOnline(receiverId);
        const isInRoom = isOnline && this.connectionManager.isUserInRoom(receiverId, data.conversationId);
        
        if (isInRoom) {
          // 情況1: 在線且在房間 → 會通過房間廣播收到訊息，無需額外處理
          this.logger.debug(`User ${receiverId} is online and in room, will receive via room broadcast`);
        } else if (isOnline) {
          // 情況2: 在線但不在房間 → 發送到該userID的所有socket連線
          const success = await this.connectionManager.broadcastToUser(receiverId, 'globalNotification', {
            type: 'new_message',
            title: notificationData.senderName,
            body: notificationData.content,
            data: {
              conversationId: notificationData.conversationId,
              senderId: notificationData.senderId,
              messageId: notificationData.messageId,
              timestamp: notificationData.timestamp
            }
          });
          this.logger.log(`Global notification ${success ? 'sent' : 'failed'} to online user ${receiverId} (all devices)`);
        } else {
          // 情況3: 離線用戶 → 調用 Notification Service 推播
          const success = await this.sendPushNotification(receiverId, notificationData);
          this.logger.log(`Push notification ${success ? 'sent' : 'failed'} for offline user ${receiverId}`);
        }
      }

      // 7. 房間廣播（給房間內的用戶）
      this.server.to(data.conversationId).emit('newMessage', broadcastMessage);

      const onlineCount = receiverIds.filter(id => this.connectionManager.isUserOnline(id)).length;
      this.logger.log(`Message from ${senderId} distributed to ${conversationDetails.type} conversation ${data.conversationId}`);
      this.logger.log(`Recipients: ${onlineCount}/${receiverIds.length} online users`);

    } catch (error) {
      this.logger.error('Error handling message:', error.message);
      client.emit('error', { message: '發送訊息失敗' });
    }
  }

  /**
   * 發送推播通知給離線用戶
   */
  private async sendPushNotification(userId: string, notificationData: any): Promise<boolean> {
    try {
      return await this.notificationClientService.sendPushNotification(userId, {
        conversationId: notificationData.conversationId,
        senderId: notificationData.senderId,
        senderName: notificationData.senderName,
        content: notificationData.content,
        messageId: notificationData.messageId,
        timestamp: notificationData.timestamp,
        conversationName: notificationData.conversationName,
        isGroupMessage: notificationData.isGroupMessage,
        messageType: notificationData.messageType
      });
    } catch (error) {
      this.logger.error(`Failed to send push notification to user ${userId}:`, error.message);
      return false;
    }
  }

  // 用戶加入聊天室房間（用於群組聊天和私人聊天）
  @SubscribeMessage('joinRoom')
  handleJoinRoom(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;
    
    if (!userId) {
      client.emit('error', { message: '未授權的用戶' });
      return;
    }

    if (!data.conversationId) {
      client.emit('error', { message: '聊天室 ID 不能為空' });
      return;
    }

    // 加入房間（無論是群組聊天或私人聊天都使用相同邏輯）
    client.join(data.conversationId);
    
    this.logger.log(`User ${userId} joined room ${data.conversationId}`);
    
    // 向客戶端確認已加入房間
    client.emit('joinedRoom', {
      success: true,
      conversationId: data.conversationId,
    });
  }

  // 用戶離開聊天室房間（用於群組聊天和私人聊天）
  @SubscribeMessage('leaveRoom')
  handleLeaveRoom(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    const userId = client.data.userId;

    if (!userId) {
      client.emit('error', { message: '未授權的用戶' });
      return;
    }

    if (!data.conversationId) {
      client.emit('error', { message: '聊天室 ID 不能為空' });
      return;
    }

    // 離開房間（無論是群組聊天或私人聊天都使用相同邏輯）
    client.leave(data.conversationId);

    this.logger.log(`User ${userId} left room ${data.conversationId}`);

    // 向客戶端確認已離開房間
    client.emit('leftRoom', {
      success: true,
      conversationId: data.conversationId,
    });
  }

  // ================================
  // 已讀系統
  // ================================

  @SubscribeMessage('markAsRead')
  async handleMarkAsRead(
    @MessageBody() data: { conversationId: string; lastReadMessageId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.userId;

      if (!userId) {
        client.emit('error', { message: '未授權的用戶' });
        return;
      }

      if (!data.conversationId || !data.lastReadMessageId) {
        client.emit('error', { message: '對話 ID 或訊息 ID 不能為空' });
        return;
      }

      this.logger.log(
        `[MarkAsRead] 📥 收到請求 - User: ${userId}, Conversation: ${data.conversationId}, ` +
        `LastReadMessageId: ${data.lastReadMessageId}`,
      );

      // 1. 呼叫 Chat Service 標記已讀
      const result = await this.chatClientService.markMessagesAsRead(
        userId,
        data.conversationId,
        data.lastReadMessageId,
      );

      this.logger.log(
        `[MarkAsRead] 📨 gRPC 返回結果 - success: ${result.success}, ` +
        `affectedMessageIds: [${result.affectedMessageIds.join(', ')}], ` +
        `newlyReadCount: ${result.newlyReadCount}`,
      );

      // 2. 廣播已讀計數更新（給房間內所有人）
      const broadcastPayload = {
        conversationId: data.conversationId,
        messageIds: result.affectedMessageIds,
        incrementBy: 1,
      };

      this.logger.log(
        `[MarkAsRead] 📢 準備廣播 readCountUpdated - ` +
        `conversationId: ${broadcastPayload.conversationId}, ` +
        `messageIds: [${broadcastPayload.messageIds.join(', ')}], ` +
        `incrementBy: ${broadcastPayload.incrementBy}`,
      );

      this.server.to(data.conversationId).emit('readCountUpdated', broadcastPayload);

      // 3. 確認已讀成功（回覆給操作者）
      const successPayload = {
        success: true,
        conversationId: data.conversationId,
        newlyReadCount: result.newlyReadCount,
        unreadCount: 0, // 標記後未讀數歸零
      };

      client.emit('markAsReadSuccess', successPayload);

      this.logger.log(
        `[MarkAsRead] ✅ 完成 - User ${userId} 標記了 ${result.newlyReadCount} 則訊息，` +
        `對話 ${data.conversationId} 未讀數歸零`,
      );
    } catch (error) {
      // 記錄完整的錯誤資訊
      this.logger.error('Error marking messages as read:', {
        error: error.message,
        stack: error.stack,
        userId: client.data.userId,
        conversationId: data.conversationId,
        lastReadMessageId: data.lastReadMessageId,
      });

      // 返回更具體的錯誤訊息
      client.emit('error', {
        message: error.message || '標記已讀失敗',
        code: 'MARK_AS_READ_FAILED',
        details: {
          conversationId: data.conversationId,
          lastReadMessageId: data.lastReadMessageId,
        },
      });
    }
  }

  @SubscribeMessage('getReadReceipts')
  async handleGetReadReceipts(
    @MessageBody() data: { messageId: string; limit?: number; offset?: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      if (!data.messageId) {
        client.emit('error', { message: '訊息 ID 不能為空' });
        return;
      }

      const receipts = await this.chatClientService.getReadReceipts(
        data.messageId,
        data.limit || 20,
        data.offset || 0,
      );

      client.emit('readReceipts', receipts);
    } catch (error) {
      this.logger.error('Error fetching read receipts:', error.message);
      client.emit('error', { message: '查詢已讀列表失敗' });
    }
  }

  @SubscribeMessage('getConversationState')
  async handleGetConversationState(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.userId;

      if (!userId) {
        client.emit('error', { message: '未授權的用戶' });
        return;
      }

      if (!data.conversationId) {
        client.emit('error', { message: '對話 ID 不能為空' });
        return;
      }

      const state = await this.chatClientService.getConversationState(userId, data.conversationId);

      client.emit('conversationState', {
        conversationId: data.conversationId,
        unreadCount: state.unreadCount,
        lastReadMessageId: state.lastReadMessageId,
        lastReadAt: state.lastReadAt,
      });
    } catch (error) {
      this.logger.error('Error fetching conversation state:', error.message);
      client.emit('error', { message: '查詢對話狀態失敗' });
    }
  }

  // ================================
  // 心跳機制
  // ================================
  
  private startHeartbeatMonitoring(socket: AuthenticatedSocket) {
    const timerId = setInterval(() => {
      this.sendHeartbeatPing(socket);
    }, this.HEARTBEAT_INTERVAL);
    
    this.heartbeatTimers.set(socket.id, timerId);
  }
  
  private stopHeartbeatMonitoring(socket: AuthenticatedSocket) {
    const timerId = this.heartbeatTimers.get(socket.id);
    if (timerId) {
      clearInterval(timerId);
      this.heartbeatTimers.delete(socket.id);
    }
  }
  
  private sendHeartbeatPing(socket: AuthenticatedSocket) {
    const now = new Date();
    socket.emit('heartbeat_ping', { 
      timestamp: now.getTime(),
      serverTime: now.toISOString(),
      tokenId: socket.tokenId.substring(0, 8) + '...'
    });
  }
  
  @SubscribeMessage('heartbeat_pong')
  handleHeartbeatPong(
    @MessageBody() data: { timestamp: number },
    @ConnectedSocket() client: Socket
  ) {
    const authenticatedSocket = this.connectionManager.getConnectionBySocketId(client.id);
    if (!authenticatedSocket) return;
    
    const now = new Date();
    
    // 計算延遲
    const latency = now.getTime() - data.timestamp;
    
    client.emit('heartbeat_ack', {
      latency,
      serverTime: now.toISOString(),
      tokenId: authenticatedSocket.tokenId.substring(0, 8) + '...'
    });
    
    this.logger.debug(`Heartbeat from ${authenticatedSocket.userId} (token: ${authenticatedSocket.tokenId.substring(0, 8)}...), latency: ${latency}ms`);
  }
  
  // 定期清理過期連線（每分鐘執行）
  @Cron('0 * * * * *')
  async cleanupStaleConnections() {
    // 使用ConnectionManager的清理功能
    const cleanedCount = this.connectionManager.cleanupInvalidConnections();
    
    if (cleanedCount > 0) {
      this.logger.log(`Cleaned up ${cleanedCount} invalid connections`);
    }
  }
  
  // ================================
  // 連線管理方法
  // ================================
  
  private detectPlatform(userAgent?: string): 'web' | 'ios' | 'android' | 'unknown' {
    if (!userAgent) return 'unknown';
    
    const ua = userAgent.toLowerCase();
    if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'ios';
    if (ua.includes('android')) return 'android';
    if (ua.includes('mozilla') || ua.includes('chrome') || ua.includes('safari')) return 'web';
    
    return 'unknown';
  }
  
  private async enforceConnectionLimit(userId: string) {
    const userConnections = this.connectionManager.getUserConnections(userId);
    
    if (userConnections.size >= this.MAX_CONNECTIONS_PER_USER) {
      // 找到最舊的連線並斷開
      let oldestSocket: AuthenticatedSocket | null = null;
      let oldestTime = Date.now();
      
      for (const socket of userConnections) {
        if (socket.authenticatedAt.getTime() < oldestTime) {
          oldestTime = socket.authenticatedAt.getTime();
          oldestSocket = socket;
        }
      }
      
      if (oldestSocket) {
        this.logger.warn(`User ${userId} exceeded connection limit, disconnecting oldest token: ${oldestSocket.tokenId.substring(0, 8)}...`);
        oldestSocket.emit('force_disconnect', { reason: 'connection_limit_exceeded' });
        oldestSocket.disconnect(true);
      }
    }
  }
  
  // ================================
  // 統計和監控
  // ================================
  
  @SubscribeMessage('getConnectionStats')
  handleGetConnectionStats(@ConnectedSocket() client: Socket) {
    const connectionStats = this.connectionManager.getConnectionStats();
    const stats: ConnectionStats = {
      totalConnections: connectionStats.totalConnections,
      totalUsers: connectionStats.totalOnlineUsers,
      totalTokens: connectionStats.totalTokens,
      serverUptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      platformStats: connectionStats.platformStats,
    };
    
    client.emit('connectionStats', {
      ...stats,
      timestamp: new Date().toISOString()
    });
  }
  
  @SubscribeMessage('getUserConnections')
  handleGetUserConnections(@ConnectedSocket() client: Socket) {
    const userId = client.data.userId;
    if (!userId) {
      client.emit('error', { message: '未授權的用戶' });
      return;
    }
    
    const userConnections = this.connectionManager.getUserConnections(userId);
    const connections = [];
    
    for (const socket of userConnections) {
      connections.push({
        tokenId: socket.tokenId.substring(0, 8) + '...',
        platform: socket.deviceInfo.type,
        connectedAt: socket.authenticatedAt.toISOString(),
        userAgent: socket.deviceInfo.userAgent,
        ipAddress: socket.deviceInfo.ipAddress,
        isCurrent: socket.id === client.id
      });
    }
    
    client.emit('userConnections', {
      userId,
      connections,
      totalConnections: connections.length
    });
  }
  
  @SubscribeMessage('isUserOnline')
  async handleIsUserOnline(
    @MessageBody() data: { userId: string },
    @ConnectedSocket() client: Socket
  ) {
    if (!data.userId) {
      client.emit('error', { message: '用戶ID不能為空' });
      return;
    }
    
    const isOnline = this.connectionManager.isUserOnline(data.userId);
    const userConnections = this.connectionManager.getUserConnections(data.userId);
    const connectionCount = userConnections.size;
    
    client.emit('userOnlineStatus', {
      userId: data.userId,
      isOnline,
      connectionCount,
      timestamp: new Date().toISOString()
    });
  }
  
  // ================================
  // API方法 - 使用ConnectionManager
  // ================================
  
  /**
   * 取得所有在線用戶列表
   */
  getOnlineUsers(): string[] {
    return this.connectionManager.getOnlineUsers();
  }
  
  /**
   * 取得用戶的所有Token ID
   */
  getUserTokens(userId: string): string[] {
    return this.connectionManager.getUserTokens(userId);
  }
  
  /**
   * 批量檢查用戶在線狀態
   */
  areUsersOnline(userIds: string[]): Record<string, boolean> {
    return this.connectionManager.areUsersOnline(userIds);
  }
  
  /**
   * 強制斷開用戶的特定Token連線
   */
  async forceDisconnectUserToken(userId: string, tokenId: string, reason: string = 'admin_action'): Promise<boolean> {
    return await this.connectionManager.forceDisconnectUserToken(userId, tokenId, reason);
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
    return await this.connectionManager.broadcastSystemNotification(notification);
  }

  // ================================
  // 通話相關事件處理
  // ================================

  /**
   * 發起通話
   */
  @SubscribeMessage('startCall')
  async handleStartCall(
    @MessageBody()
    data: {
      conversationId: string;
      calleeIds: string[];
      callType: 'audio' | 'video';
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const callerId = client.data.userId;
      const callerName = client.data.username || 'Unknown User';

      if (!callerId) {
        client.emit('error', { message: '未授權的用戶' });
        return;
      }

      if (!data.conversationId || !data.calleeIds || data.calleeIds.length === 0) {
        client.emit('error', { message: '參數錯誤：缺少對話 ID 或接聽者' });
        return;
      }

      this.logger.log(
        `📞 User ${callerId} starting ${data.callType} call in conversation ${data.conversationId}`,
      );

      // 1. 呼叫 RTC Service 創建通話
      const callResponse = await this.rtcClientService.startCall({
        conversationId: data.conversationId,
        callerId: callerId,
        calleeIds: data.calleeIds,
        callType: data.callType === 'video' ? 1 : 0,
      });

      if (!callResponse.success) {
        client.emit('callFailed', { message: callResponse.message });
        return;
      }

      // gRPC 使用 keepCase: false，使用 camelCase
      const roomName = callResponse.roomName;
      const callId = callResponse.callId;

      // 2. 生成發起者的 Token
      const callerToken = await this.rtcClientService.generateToken({
        roomName: roomName,
        userId: callerId,
        username: callerName,
        permissions: {
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
          hidden: false,
        },
      });

      // 3. 回應發起者
      client.emit('callStarted', {
        callId: callId,
        roomName: roomName,
        token: callerToken.token,
        livekitUrl: callerToken.livekitUrl,
        callType: data.callType,
      });

      // 4. 通知所有被呼叫者
      // 判斷是否為私人通話（1對1），只有私人通話才發送來電推播
      const isPrivateCall = data.calleeIds.length === 1;

      for (const calleeId of data.calleeIds) {
        const isOnline = this.connectionManager.isUserOnline(calleeId);

        if (isOnline) {
          // 在線用戶：通過 WebSocket 發送來電通知
          await this.connectionManager.broadcastToUser(calleeId, 'incomingCall', {
            callId: callId,
            roomName: roomName,
            callerId,
            callerName,
            conversationId: data.conversationId,
            callType: data.callType,
            timestamp: new Date().toISOString(),
          });
          this.logger.log(`📲 Incoming call notification sent to online user ${calleeId}`);
        } else if (isPrivateCall) {
          // 離線用戶 + 私人通話：發送來電推播通知（強制喚醒裝置）
          this.logger.log(`📱 User ${calleeId} is offline (private call), sending call push notification`);

          try {
            const pushResult = await this.notificationClientService.sendCallNotification({
              userId: calleeId,
              callId: callId,
              callerId: callerId,
              callerName: callerName,
              callType: data.callType,
              conversationId: data.conversationId,
            });

            if (pushResult) {
              this.logger.log(`✅ Call push notification sent successfully to ${calleeId}`);
            } else {
              this.logger.warn(`⚠️ Call push notification failed for ${calleeId}`);
            }
          } catch (error) {
            this.logger.error(`❌ Error sending call push notification to ${calleeId}:`, error.message);
          }
        } else {
          // 離線用戶 + 群組通話：不發送來電推播（依據用戶需求）
          this.logger.log(`📱 User ${calleeId} is offline (group call), skip call push notification`);
        }
      }

      this.logger.log(
        `✅ Call ${callId} started successfully`,
      );
    } catch (error) {
      this.logger.error('❌ Error starting call:', error.message);
      client.emit('error', { message: '發起通話失敗' });
    }
  }

  /**
   * 接聽通話
   */
  @SubscribeMessage('acceptCall')
  async handleAcceptCall(
    @MessageBody()
    data: {
      callId: string;
      roomName: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.userId;
      const username = client.data.username || 'Unknown User';

      if (!userId) {
        client.emit('error', { message: '未授權的用戶' });
        return;
      }

      this.logger.log(`✅ User ${userId} accepting call ${data.callId}`);

      // 1. 生成參與者的 Token
      const tokenResponse = await this.rtcClientService.generateToken({
        roomName: data.roomName,
        userId: userId,
        username,
        permissions: {
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
          hidden: false,
        },
      });

      // 2. 回應接聽者
      client.emit('callAccepted', {
        callId: data.callId,
        roomName: data.roomName,
        token: tokenResponse.token,
        livekitUrl: tokenResponse.livekitUrl,
      });

      // 3. 通知房間內其他人（有人加入）
      this.server.to(data.roomName).emit('participantJoined', {
        callId: data.callId,
        userId,
        username,
        timestamp: new Date().toISOString(),
      });

      this.logger.log(`✅ User ${userId} accepted call ${data.callId}`);
    } catch (error) {
      this.logger.error('❌ Error accepting call:', error.message);
      client.emit('error', { message: '接聽通話失敗' });
    }
  }

  /**
   * 拒絕通話
   */
  @SubscribeMessage('rejectCall')
  async handleRejectCall(
    @MessageBody()
    data: {
      callId: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.userId;

      if (!userId) {
        client.emit('error', { message: '未授權的用戶' });
        return;
      }

      this.logger.log(`❌ User ${userId} rejected call ${data.callId}`);

      // TODO: 通知發起者被拒絕（需要知道發起者是誰）
      // 可以從 RTC Service 獲取通話詳情

      client.emit('callRejected', {
        callId: data.callId,
        success: true,
      });
    } catch (error) {
      this.logger.error('❌ Error rejecting call:', error.message);
      client.emit('error', { message: '拒絕通話失敗' });
    }
  }

  /**
   * 取消通話（發起者在無人接聽時取消）
   */
  @SubscribeMessage('cancelCall')
  async handleCancelCall(
    @MessageBody()
    data: {
      callId: string;
      roomName: string;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.userId;

      if (!userId) {
        client.emit('error', { message: '未授權的用戶' });
        return;
      }

      this.logger.log(`🚫 User ${userId} cancelling call ${data.callId}`);

      // 1. 獲取通話詳情
      let callDetails;
      try {
        callDetails = await this.rtcClientService.getCallDetails({
          callId: data.callId,
        });

        // 驗證只有發起者可以取消通話
        if (callDetails?.call?.initiatedBy !== userId) {
          client.emit('error', { message: '只有發起者可以取消通話' });
          return;
        }
      } catch (error) {
        this.logger.error(`Failed to get call details: ${error.message}`);
        client.emit('error', { message: '無法取消通話' });
        return;
      }

      // 2. 呼叫 RTC Service 結束通話（原因：CANCELLED）
      const endResponse = await this.rtcClientService.endCall({
        callId: data.callId,
        userId: userId,
        durationSeconds: 0,
        endReason: 4, // CANCELLED
      });

      // 3. 通知所有未接聽的 callees
      if (callDetails?.call?.participants) {
        // 找出所有被呼叫者且尚未加入
        const unansweredCallees = callDetails.call.participants.filter(
          (p) =>
            p.role === 1 && // CALLEE
            p.userId !== userId &&
            (!p.leftAt || p.leftAt === '0')
        );

        this.logger.log(`📞 Notifying ${unansweredCallees.length} unanswered callees about cancellation`);

        // 對每個未接聽者發送取消通知
        for (const callee of unansweredCallees) {
          const isOnline = this.connectionManager.isUserOnline(callee.userId);

          if (isOnline) {
            await this.connectionManager.broadcastToUser(callee.userId, 'callCancelled', {
              callId: data.callId,
              cancelledBy: userId,
              timestamp: new Date().toISOString(),
            });
            this.logger.log(`📲 Call cancelled notification sent to ${callee.userId}`);
          }
        }
      }

      // 4. 確認取消成功
      client.emit('callCancelledSuccess', {
        callId: data.callId,
        success: true,
      });

      this.logger.log(`✅ Call ${data.callId} cancelled by ${userId}`);
    } catch (error) {
      this.logger.error('❌ Error cancelling call:', error.message);
      client.emit('error', { message: '取消通話失敗' });
    }
  }

  /**
   * 結束通話
   */
  @SubscribeMessage('endCall')
  async handleEndCall(
    @MessageBody()
    data: {
      callId: string;
      roomName: string;
      durationSeconds?: number;
    },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const userId = client.data.userId;

      if (!userId) {
        client.emit('error', { message: '未授權的用戶' });
        return;
      }

      this.logger.log(`📴 User ${userId} ending call ${data.callId}`);

      // 1. 先獲取通話詳情，判斷是「取消」還是「正常掛斷」
      let callDetails;
      try {
        callDetails = await this.rtcClientService.getCallDetails({
          callId: data.callId,
        });
      } catch (error) {
        this.logger.warn(`Failed to get call details: ${error.message}`);
      }

      // 判斷是否為發起者在無人接聽時取消通話
      const isCancelledByInitiator =
        callDetails?.call?.initiatedBy === userId &&
        (!data.durationSeconds || data.durationSeconds === 0);

      // 2. 呼叫 RTC Service 結束通話
      const endResponse = await this.rtcClientService.endCall({
        callId: data.callId,
        userId: userId,
        durationSeconds: data.durationSeconds,
        endReason: isCancelledByInitiator ? 4 : 0, // 4 = CANCELLED, 0 = NORMAL
      });

      // 3. 廣播給房間內所有人（已接聽的參與者）
      this.server.to(data.roomName).emit('callEnded', {
        callId: data.callId,
        endedBy: userId,
        endReason: isCancelledByInitiator ? 'cancelled' : 'normal',
        timestamp: new Date().toISOString(),
        callRecord: endResponse.callRecord,
      });

      // 4. 如果是取消通話，需要通知所有未接聽的 callees
      if (isCancelledByInitiator && callDetails?.call?.participants) {
        this.logger.log(`📞 Call ${data.callId} was cancelled before being answered, notifying callees`);

        // 找出所有被呼叫者（role = CALLEE）且尚未加入（leftAt 為空或 joinedAt 為空）
        const unansweredCallees = callDetails.call.participants.filter(
          (p) =>
            p.role === 1 && // 1 = CALLEE (from proto enum)
            p.userId !== userId && // 排除發起者自己
            (!p.leftAt || p.leftAt === '0') // 尚未離開（表示從未加入）
        );

        // 對每個未接聽者發送取消通知
        for (const callee of unansweredCallees) {
          const isOnline = this.connectionManager.isUserOnline(callee.userId);

          if (isOnline) {
            // 在線用戶：透過 WebSocket 發送取消通知
            await this.connectionManager.broadcastToUser(callee.userId, 'callCancelled', {
              callId: data.callId,
              cancelledBy: userId,
              timestamp: new Date().toISOString(),
            });
            this.logger.log(`📲 Call cancelled notification sent to online user ${callee.userId}`);
          } else {
            // 離線用戶：理論上不需處理（因為他們可能還沒收到來電推播，或已經看到了）
            this.logger.log(`📱 User ${callee.userId} is offline, skip cancel notification`);
          }
        }
      }

      // 5. 確認結束
      client.emit('callEndedSuccess', {
        callId: data.callId,
        success: true,
      });

      this.logger.log(`✅ Call ${data.callId} ended by ${userId}`);
    } catch (error) {
      this.logger.error('❌ Error ending call:', error.message);
      client.emit('error', { message: '結束通話失敗' });
    }
  }
} 