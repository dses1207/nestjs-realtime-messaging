import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  RoomServiceClient,
  AccessToken,
  Room,
  ParticipantInfo as LiveKitParticipantInfo,
} from 'livekit-server-sdk';

export interface TokenPermissions {
  canPublish?: boolean;
  canSubscribe?: boolean;
  canPublishData?: boolean;
  hidden?: boolean;
}

@Injectable()
export class LiveKitService implements OnModuleInit {
  private readonly logger = new Logger(LiveKitService.name);
  private roomService: RoomServiceClient;
  private apiKey: string;
  private apiSecret: string;
  private livekitUrl: string;
  private livekitPublicUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('LIVEKIT_API_KEY') || '';
    this.apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET') || '';
    this.livekitUrl = this.configService.get<string>('LIVEKIT_URL') || '';
    // 如果沒設定 LIVEKIT_PUBLIC_URL，則使用 LIVEKIT_URL（向後兼容）
    this.livekitPublicUrl = this.configService.get<string>('LIVEKIT_PUBLIC_URL') || this.livekitUrl;
  }

  onModuleInit() {
    if (!this.apiKey || !this.apiSecret || !this.livekitUrl) {
      this.logger.error('❌ LiveKit configuration is missing!');
      throw new Error('LiveKit configuration incomplete');
    }

    this.roomService = new RoomServiceClient(
      this.livekitUrl,
      this.apiKey,
      this.apiSecret,
    );

    this.logger.log('✅ LiveKit Service initialized with SDK v2.14.1');
    this.logger.log(`   LiveKit URL: ${this.livekitUrl}`);
  }

  /**
   * 創建房間
   */
  async createRoom(
    roomName: string,
    maxParticipants: number = 20,
  ): Promise<Room> {
    try {
      const room = await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: 5 * 60, // 5 分鐘無人自動關閉
        maxParticipants,
      });

      this.logger.log(`✅ Room created: ${roomName}`);
      return room;
    } catch (error) {
      this.logger.error(`❌ Failed to create room ${roomName}:`, error.message);
      throw error;
    }
  }

  /**
   * 刪除房間
   */
  async deleteRoom(roomName: string): Promise<void> {
    try {
      await this.roomService.deleteRoom(roomName);
      this.logger.log(`✅ Room deleted: ${roomName}`);
    } catch (error) {
      this.logger.error(`❌ Failed to delete room ${roomName}:`, error.message);
      // 不拋出錯誤，因為房間可能已經不存在
    }
  }

  /**
   * 列出所有活躍房間
   */
  async listRooms(): Promise<Room[]> {
    try {
      const rooms = await this.roomService.listRooms();
      this.logger.log(`📋 Listed ${rooms.length} active rooms`);
      return rooms;
    } catch (error) {
      this.logger.error('❌ Failed to list rooms:', error.message);
      throw error;
    }
  }

  /**
   * 生成 Access Token (v2.x - 異步方法)
   * ⚠️ 重要：toJwt() 在 v2.x 是異步的，必須 await
   */
  async generateToken(
    roomName: string,
    participantIdentity: string,
    participantName: string,
    permissions?: TokenPermissions,
  ): Promise<string> {
    try {
      const at = new AccessToken(this.apiKey, this.apiSecret, {
        identity: participantIdentity,
        name: participantName,
        ttl: '10m', // Token 10 分鐘過期
      });

      at.addGrant({
        roomJoin: true,
        room: roomName,
        canPublish: permissions?.canPublish ?? true,
        canSubscribe: permissions?.canSubscribe ?? true,
        canPublishData: permissions?.canPublishData ?? true,
        hidden: permissions?.hidden ?? false,
      });

      // ⚠️ v2.x 重要變更：toJwt() 現在是異步方法
      const token = await at.toJwt(); // ✅ 必須 await

      this.logger.log(
        `✅ Token generated for ${participantName} (${participantIdentity}) in room ${roomName}`,
      );

      return token;
    } catch (error) {
      this.logger.error(
        `❌ Failed to generate token for ${participantIdentity}:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 獲取房間參與者
   */
  async getParticipants(roomName: string): Promise<LiveKitParticipantInfo[]> {
    try {
      const participants = await this.roomService.listParticipants(roomName);
      this.logger.log(
        `👥 Room ${roomName} has ${participants.length} participants`,
      );
      return participants;
    } catch (error) {
      this.logger.error(
        `❌ Failed to get participants for room ${roomName}:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 踢出參與者
   */
  async removeParticipant(
    roomName: string,
    participantIdentity: string,
  ): Promise<void> {
    try {
      await this.roomService.removeParticipant(roomName, participantIdentity);
      this.logger.log(
        `✅ Participant ${participantIdentity} removed from room ${roomName}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Failed to remove participant ${participantIdentity} from room ${roomName}:`,
        error.message,
      );
      throw error;
    }
  }

  /**
   * 獲取房間資訊
   */
  async getRoom(roomName: string): Promise<Room | null> {
    try {
      const rooms = await this.roomService.listRooms([roomName]);
      return rooms.length > 0 ? rooms[0] : null;
    } catch (error) {
      this.logger.error(`❌ Failed to get room ${roomName}:`, error.message);
      return null;
    }
  }

  /**
   * 獲取 LiveKit URL（內部使用，後端連接 LiveKit）
   */
  getLiveKitUrl(): string {
    return this.livekitUrl;
  }

  /**
   * 獲取公開 LiveKit URL（返回給前端，供瀏覽器連接）
   */
  getPublicLiveKitUrl(): string {
    return this.livekitPublicUrl;
  }
}
