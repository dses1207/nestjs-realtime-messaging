import { Injectable, Logger } from '@nestjs/common';
import { LiveKitService } from '../livekit/livekit.service';
import { CallRecordService } from '../call-record/call-record.service';
import { ChatClientService } from '../grpc-clients/chat-client.service';
import { UserClientService } from '../grpc-clients/user-client.service';
import { NotificationClientService } from '../grpc-clients/notification-client.service';
import {
  CallType,
  CallStatus,
  CallEndReason,
  ParticipantRole,
  CallRecord,
} from '../call-record/schemas/call-record.schema';

@Injectable()
export class RtcService {
  private readonly logger = new Logger(RtcService.name);

  constructor(
    private livekitService: LiveKitService,
    private callRecordService: CallRecordService,
    private chatClientService: ChatClientService,
    private userClientService: UserClientService,
    private notificationClientService: NotificationClientService,
  ) {}

  /**
   * 發起通話
   */
  async startCall(
    conversationId: string,
    callerId: string,
    calleeIds: string[],
    callType: CallType,
  ): Promise<{
    success: boolean;
    callId: string;
    roomName: string;
    message: string;
  }> {
    try {
      // 1. 生成房間名稱
      const roomName = `room-${conversationId}-${Date.now()}`;

      // 2. 創建 LiveKit 房間
      const maxParticipants = calleeIds.length + 1; // 發起者 + 接聽者
      await this.livekitService.createRoom(roomName, Math.max(maxParticipants, 20));

      // 3. 獲取用戶名稱
      const allUserIds = [callerId, ...calleeIds];
      const userNames = await this.userClientService.batchGetUsers(allUserIds);

      // 4. 創建通話記錄
      const callRecord = await this.callRecordService.createCallRecord(
        conversationId,
        roomName,
        callType,
        callerId,
        allUserIds,
        userNames,
      );

      // 5. (可選) 保存通話開始訊息到對話
      try {
        await this.chatClientService.saveCallMessage(
          conversationId,
          callerId,
          `${callType === CallType.VIDEO ? '視訊' : '語音'}通話已發起`,
          'call_start',
          callRecord.callId,
        );
      } catch (error) {
        this.logger.warn('Failed to save call message to chat:', error.message);
        // 不影響通話流程
      }

      this.logger.log(
        `✅ Call ${callRecord.callId} started by ${callerId} in conversation ${conversationId}`,
      );

      return {
        success: true,
        callId: callRecord.callId,
        roomName,
        message: '通話已創建',
      };
    } catch (error) {
      this.logger.error('❌ Failed to start call:', error.message);
      throw error;
    }
  }

  /**
   * 生成加入 Token
   */
  async generateToken(
    roomName: string,
    userId: string,
    username: string,
    permissions?: {
      canPublish?: boolean;
      canSubscribe?: boolean;
      canPublishData?: boolean;
      hidden?: boolean;
    },
  ): Promise<{
    success: boolean;
    token: string;
    livekitUrl: string;
    expiresAt: number;
  }> {
    try {
      const token = await this.livekitService.generateToken(
        roomName,
        userId,
        username,
        permissions,
      );

      const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60; // 10 分鐘後過期

      return {
        success: true,
        token,
        livekitUrl: this.livekitService.getPublicLiveKitUrl(),
        expiresAt,
      };
    } catch (error) {
      this.logger.error('❌ Failed to generate token:', error.message);
      throw error;
    }
  }

  /**
   * 結束通話
   */
  async endCall(
    callId: string,
    userId: string,
    durationSeconds?: number,
    endReason?: CallEndReason,
  ): Promise<{
    success: boolean;
    message: string;
    callRecord: CallRecord;
  }> {
    try {
      // 1. 獲取通話記錄
      const callRecord = await this.callRecordService.getCallRecord(callId);
      if (!callRecord) {
        throw new Error(`Call record not found: ${callId}`);
      }

      // 2. 刪除 LiveKit 房間
      await this.livekitService.deleteRoom(callRecord.roomName);

      // 3. 更新通話記錄
      const updatedRecord = await this.callRecordService.endCall(
        callId,
        endReason || CallEndReason.NORMAL,
        durationSeconds,
      );

      // 4. (可選) 保存通話結束訊息到對話
      try {
        const durationText = this.formatDuration(updatedRecord.durationSeconds || 0);
        await this.chatClientService.saveCallMessage(
          updatedRecord.conversationId,
          userId,
          `通話已結束，時長 ${durationText}`,
          'call_end',
          callId,
        );
      } catch (error) {
        this.logger.warn('Failed to save call end message:', error.message);
      }

      this.logger.log(`✅ Call ${callId} ended by ${userId}`);

      return {
        success: true,
        message: '通話已結束',
        callRecord: updatedRecord,
      };
    } catch (error) {
      this.logger.error('❌ Failed to end call:', error.message);
      throw error;
    }
  }

  /**
   * 獲取通話狀態
   */
  async getCallStatus(callId: string): Promise<{
    active: boolean;
    status: CallStatus;
    participantCount: number;
    startedAt: number;
    durationSeconds?: number;
    roomName: string;
  }> {
    const callRecord = await this.callRecordService.getCallRecord(callId);
    if (!callRecord) {
      throw new Error(`Call record not found: ${callId}`);
    }

    const active = [
      CallStatus.INITIATING,
      CallStatus.RINGING,
      CallStatus.CONNECTED,
    ].includes(callRecord.status);

    const durationSeconds = callRecord.durationSeconds ||
      (active
        ? Math.floor((Date.now() - callRecord.startedAt.getTime()) / 1000)
        : 0);

    return {
      active,
      status: callRecord.status,
      participantCount: callRecord.participants.length,
      startedAt: Math.floor(callRecord.startedAt.getTime() / 1000),
      durationSeconds,
      roomName: callRecord.roomName,
    };
  }

  /**
   * 獲取通話記錄
   */
  async getCallHistory(
    userId: string,
    conversationId?: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ calls: CallRecord[]; totalCount: number }> {
    return this.callRecordService.getCallHistory(
      userId,
      conversationId,
      limit,
      offset,
    );
  }

  /**
   * 獲取通話詳情
   */
  async getCallDetails(callId: string): Promise<{
    success: boolean;
    call: CallRecord | null;
    message: string;
  }> {
    const call = await this.callRecordService.getCallRecord(callId);

    if (!call) {
      return {
        success: false,
        call: null,
        message: '通話記錄不存在',
      };
    }

    return {
      success: true,
      call,
      message: '查詢成功',
    };
  }

  /**
   * 獲取房間參與者
   */
  async getRoomParticipants(roomName: string): Promise<{
    participants: any[];
    count: number;
  }> {
    const participants = await this.livekitService.getParticipants(roomName);

    return {
      participants: participants.map((p) => ({
        identity: p.identity,
        name: p.name,
        sid: p.sid,
        isPublisher: p.permission?.canPublish || false,
        joinedAt: p.joinedAt,
        metadata: p.metadata,
      })),
      count: participants.length,
    };
  }

  /**
   * 踢出參與者
   */
  async kickParticipant(
    roomName: string,
    participantIdentity: string,
    operatorId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.livekitService.removeParticipant(roomName, participantIdentity);

      this.logger.log(
        `✅ Participant ${participantIdentity} kicked from room ${roomName} by ${operatorId}`,
      );

      return {
        success: true,
        message: '參與者已被移除',
      };
    } catch (error) {
      this.logger.error('❌ Failed to kick participant:', error.message);
      throw error;
    }
  }

  /**
   * 列出活躍房間
   */
  async listActiveRooms(limit?: number, offset?: number): Promise<{
    rooms: any[];
    totalCount: number;
  }> {
    const allRooms = await this.livekitService.listRooms();

    const start = offset || 0;
    const end = limit ? start + limit : allRooms.length;
    const rooms = allRooms.slice(start, end);

    return {
      rooms: rooms.map((room) => ({
        name: room.name,
        sid: room.sid,
        numParticipants: room.numParticipants,
        creationTime: room.creationTime,
        maxParticipants: room.maxParticipants,
      })),
      totalCount: allRooms.length,
    };
  }

  /**
   * 格式化通話時長
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours} 小時 ${minutes} 分 ${secs} 秒`;
    } else if (minutes > 0) {
      return `${minutes} 分 ${secs} 秒`;
    } else {
      return `${secs} 秒`;
    }
  }
}
