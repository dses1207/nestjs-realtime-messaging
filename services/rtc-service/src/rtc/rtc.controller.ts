import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { RtcService } from './rtc.service';
import { CallType, CallEndReason, CallStatus } from '../call-record/schemas/call-record.schema';
import { LiveKitService } from '../livekit/livekit.service';

@Controller()
export class RtcController {
  private readonly logger = new Logger(RtcController.name);

  constructor(
    private readonly rtcService: RtcService,
    private readonly livekitService: LiveKitService,
  ) {}

  /**
   * 發起通話
   */
  @GrpcMethod('RTCService', 'StartCall')
  async startCall(data: any) {
    // 加入詳細日誌以診斷問題
    this.logger.log(`📞 StartCall raw data: ${JSON.stringify(data)}`);

    // gRPC Server 預設使用 camelCase
    const { conversationId, callerId, calleeIds, callType } = data;

    // 驗證必要參數
    if (!conversationId || !callerId || !calleeIds || !Array.isArray(calleeIds) || calleeIds.length === 0) {
      this.logger.error('❌ StartCall 參數錯誤', {
        conversationId,
        callerId,
        calleeIds,
        callType,
      });
      return {
        success: false,
        callId: '',
        roomName: '',
        message: '參數錯誤：缺少對話 ID、發起者 ID 或接聽者 ID',
      };
    }

    this.logger.log(`📞 StartCall request from ${callerId} to ${calleeIds.join(', ')}`);

    const mappedCallType = callType === 1 ? CallType.VIDEO : CallType.AUDIO;

    const result = await this.rtcService.startCall(
      conversationId,
      callerId,
      calleeIds,
      mappedCallType,
    );

    const response = {
      success: result.success,
      callId: result.callId,
      roomName: result.roomName,
      message: result.message,
    };

    this.logger.log(`📤 StartCall response: ${JSON.stringify(response)}`);

    return response;
  }

  /**
   * 生成 Token
   */
  @GrpcMethod('RTCService', 'GenerateToken')
  async generateToken(data: any) {
    // 加入詳細日誌以診斷問題
    this.logger.log(`🎫 GenerateToken raw data: ${JSON.stringify(data)}`);

    // gRPC Server 預設使用 camelCase
    const { roomName, userId, username, permissions } = data;

    // 驗證必要參數
    if (!roomName || !userId || !username) {
      this.logger.error('❌ GenerateToken 參數錯誤', {
        roomName,
        userId,
        username,
      });
      return {
        success: false,
        token: '',
        livekitUrl: '',
        expiresAt: '0',
        message: '參數錯誤：缺少房間名稱、用戶 ID 或用戶名稱',
      };
    }

    this.logger.log(`🎫 GenerateToken request for ${username} (${userId}) in room ${roomName}`);

    const result = await this.rtcService.generateToken(
      roomName,
      userId,
      username,
      permissions
        ? {
            canPublish: permissions.canPublish,
            canSubscribe: permissions.canSubscribe,
            canPublishData: permissions.canPublishData,
            hidden: permissions.hidden,
          }
        : undefined,
    );

    return {
      success: result.success,
      token: result.token,
      livekitUrl: result.livekitUrl,
      expiresAt: result.expiresAt.toString(),
      message: 'Token 生成成功',
    };
  }

  /**
   * 結束通話
   */
  @GrpcMethod('RTCService', 'EndCall')
  async endCall(data: {
    callId: string;
    userId: string;
    durationSeconds?: number;
    endReason?: number;
  }) {
    this.logger.log(`📴 EndCall request for ${data.callId} by ${data.userId}`);

    const endReason = this.mapEndReason(data.endReason);

    const result = await this.rtcService.endCall(
      data.callId,
      data.userId,
      data.durationSeconds,
      endReason,
    );

    return {
      success: result.success,
      message: result.message,
      callRecord: this.mapCallRecordToProto(result.callRecord),
    };
  }

  /**
   * 獲取通話狀態
   */
  @GrpcMethod('RTCService', 'GetCallStatus')
  async getCallStatus(data: { callId: string }) {
    this.logger.log(`📊 GetCallStatus request for ${data.callId}`);

    const result = await this.rtcService.getCallStatus(data.callId);

    return {
      active: result.active,
      status: this.mapStatusToProto(result.status),
      participantCount: result.participantCount,
      startedAt: result.startedAt.toString(),
      durationSeconds: result.durationSeconds,
      roomName: result.roomName,
    };
  }

  /**
   * 獲取通話記錄
   */
  @GrpcMethod('RTCService', 'GetCallHistory')
  async getCallHistory(data: {
    userId: string;
    conversationId?: string;
    limit: number;
    offset: number;
  }) {
    this.logger.log(`📋 GetCallHistory request for user ${data.userId}`);

    const result = await this.rtcService.getCallHistory(
      data.userId,
      data.conversationId,
      data.limit || 20,
      data.offset || 0,
    );

    return {
      calls: result.calls.map((call) => this.mapCallRecordToProto(call)),
      totalCount: result.totalCount,
    };
  }

  /**
   * 獲取通話詳情
   */
  @GrpcMethod('RTCService', 'GetCallDetails')
  async getCallDetails(data: { callId: string }) {
    this.logger.log(`🔍 GetCallDetails request for ${data.callId}`);

    const result = await this.rtcService.getCallDetails(data.callId);

    return {
      success: result.success,
      call: result.call ? this.mapCallRecordToProto(result.call) : null,
      message: result.message,
    };
  }

  /**
   * 獲取房間參與者
   */
  @GrpcMethod('RTCService', 'GetRoomParticipants')
  async getRoomParticipants(data: { roomName: string }) {
    this.logger.log(`👥 GetRoomParticipants request for room ${data.roomName}`);

    const result = await this.rtcService.getRoomParticipants(data.roomName);

    return {
      participants: result.participants,
      count: result.count,
    };
  }

  /**
   * 踢出參與者
   */
  @GrpcMethod('RTCService', 'KickParticipant')
  async kickParticipant(data: {
    roomName: string;
    participantIdentity: string;
    operatorId: string;
  }) {
    this.logger.log(
      `⛔ KickParticipant request: ${data.participantIdentity} from ${data.roomName} by ${data.operatorId}`,
    );

    const result = await this.rtcService.kickParticipant(
      data.roomName,
      data.participantIdentity,
      data.operatorId,
    );

    return result;
  }

  /**
   * 列出活躍房間
   */
  @GrpcMethod('RTCService', 'ListActiveRooms')
  async listActiveRooms(data: { limit?: number; offset?: number }) {
    this.logger.log('📋 ListActiveRooms request');

    const result = await this.rtcService.listActiveRooms(data.limit, data.offset);

    return {
      rooms: result.rooms,
      totalCount: result.totalCount,
    };
  }

  /**
   * 創建房間（直接創建，不創建通話記錄）
   */
  @GrpcMethod('RTCService', 'CreateRoom')
  async createRoom(data: {
    conversationId: string;
    participantIds: string[];
    callType: number;
    maxParticipants: number;
  }) {
    this.logger.log(`🏗️ CreateRoom request for conversation ${data.conversationId}`);

    const roomName = `room-${data.conversationId}-${Date.now()}`;
    const maxParticipants = data.maxParticipants || 20;

    await this.livekitService.createRoom(roomName, maxParticipants);

    return {
      success: true,
      roomId: roomName,
      roomName: roomName,
      callId: '', // 不創建 call record
      message: '房間已創建',
    };
  }

  /**
   * 刪除房間
   */
  @GrpcMethod('RTCService', 'DeleteRoom')
  async deleteRoom(data: { roomName: string }) {
    this.logger.log(`🗑️ DeleteRoom request for ${data.roomName}`);

    await this.livekitService.deleteRoom(data.roomName);

    return {
      success: true,
      message: '房間已刪除',
    };
  }

  // ========== Helper Methods ==========

  /**
   * 將 CallRecord 映射到 Proto 格式
   */
  private mapCallRecordToProto(call: any) {
    return {
      id: call.callId,
      conversationId: call.conversationId,
      roomName: call.roomName,
      callType: call.callType === CallType.VIDEO ? 1 : 0,
      status: this.mapStatusToProto(call.status),
      participants: call.participants.map((p: any) => ({
        userId: p.userId,
        username: p.username,
        joinedAt: p.joinedAt ? Math.floor(p.joinedAt.getTime() / 1000).toString() : '0',
        leftAt: p.leftAt ? Math.floor(p.leftAt.getTime() / 1000).toString() : null,
        durationSeconds: p.durationSeconds || 0,
        role: this.mapRoleToProto(p.role),
      })),
      startedAt: Math.floor(call.startedAt.getTime() / 1000).toString(),
      endedAt: call.endedAt ? Math.floor(call.endedAt.getTime() / 1000).toString() : null,
      durationSeconds: call.durationSeconds || 0,
      endReason: call.endReason ? this.mapEndReasonToProto(call.endReason) : 0,
      initiatedBy: call.initiatedBy,
      createdAt: Math.floor(call.createdAt.getTime() / 1000).toString(),
      updatedAt: Math.floor(call.updatedAt.getTime() / 1000).toString(),
    };
  }

  private mapStatusToProto(status: CallStatus): number {
    const map = {
      [CallStatus.INITIATING]: 0,
      [CallStatus.RINGING]: 1,
      [CallStatus.CONNECTED]: 2,
      [CallStatus.ENDED]: 3,
      [CallStatus.FAILED]: 4,
      [CallStatus.REJECTED]: 5,
      [CallStatus.NO_ANSWER]: 6,
    };
    return map[status] || 0;
  }

  private mapRoleToProto(role: string): number {
    const map = {
      caller: 0,
      callee: 1,
      joined: 2,
    };
    return map[role] || 0;
  }

  private mapEndReasonToProto(reason: CallEndReason): number {
    const map = {
      [CallEndReason.NORMAL]: 0,
      [CallEndReason.REJECTED]: 1,
      [CallEndReason.NO_ANSWER]: 2,
      [CallEndReason.BUSY]: 3,
      [CallEndReason.CANCELLED]: 4,
      [CallEndReason.NETWORK_ERROR]: 5,
      [CallEndReason.KICKED]: 6,
    };
    return map[reason] || 0;
  }

  private mapEndReason(protoReason?: number): CallEndReason {
    const map = {
      0: CallEndReason.NORMAL,
      1: CallEndReason.REJECTED,
      2: CallEndReason.NO_ANSWER,
      3: CallEndReason.BUSY,
      4: CallEndReason.CANCELLED,
      5: CallEndReason.NETWORK_ERROR,
      6: CallEndReason.KICKED,
    };
    return map[protoReason || 0] || CallEndReason.NORMAL;
  }
}
