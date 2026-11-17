import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CallRecord,
  CallRecordDocument,
  CallStatus,
  CallType,
  CallEndReason,
  ParticipantRole,
  CallParticipant,
} from './schemas/call-record.schema';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class CallRecordService {
  private readonly logger = new Logger(CallRecordService.name);

  constructor(
    @InjectModel(CallRecord.name)
    private callRecordModel: Model<CallRecordDocument>,
  ) {}

  /**
   * 創建通話記錄
   */
  async createCallRecord(
    conversationId: string,
    roomName: string,
    callType: CallType,
    initiatedBy: string,
    participantIds: string[],
    participantNames: Map<string, string>,
  ): Promise<CallRecord> {
    const callId = uuidv4();
    const now = new Date();

    const participants: CallParticipant[] = participantIds.map((userId) => {
      const isInitiator = userId === initiatedBy;
      return {
        userId,
        username: participantNames.get(userId) || 'Unknown',
        role: isInitiator ? ParticipantRole.CALLER : ParticipantRole.CALLEE,
        joinedAt: now, // 所有參與者都設定為 now，避免 null 問題
        // leftAt 和 durationSeconds 保持 undefined（不設定）
      };
    });

    const callRecord = new this.callRecordModel({
      callId,
      conversationId,
      roomName,
      callType,
      status: CallStatus.INITIATING,
      participants,
      initiatedBy,
      startedAt: now,
    });

    await callRecord.save();
    this.logger.log(`✅ Call record created: ${callId}`);

    return callRecord.toObject();
  }

  /**
   * 更新通話狀態
   */
  async updateCallStatus(
    callId: string,
    status: CallStatus,
  ): Promise<CallRecord> {
    const callRecord = await this.callRecordModel
      .findOneAndUpdate({ callId }, { status }, { new: true })
      .exec();

    if (!callRecord) {
      throw new Error(`Call record not found: ${callId}`);
    }

    this.logger.log(`✅ Call ${callId} status updated to ${status}`);
    return callRecord.toObject();
  }

  /**
   * 標記參與者加入
   */
  async markParticipantJoined(
    callId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date();
    await this.callRecordModel
      .updateOne(
        { callId, 'participants.userId': userId },
        {
          $set: {
            'participants.$.joinedAt': now,
          },
        },
      )
      .exec();

    this.logger.log(`✅ Participant ${userId} joined call ${callId}`);
  }

  /**
   * 標記參與者離開
   */
  async markParticipantLeft(
    callId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date();

    const callRecord = await this.callRecordModel
      .findOne({ callId })
      .exec();

    if (!callRecord) return;

    const participant = callRecord.participants.find(p => p.userId === userId);
    if (!participant || !participant.joinedAt) return;

    const duration = Math.floor(
      (now.getTime() - participant.joinedAt.getTime()) / 1000,
    );

    await this.callRecordModel
      .updateOne(
        { callId, 'participants.userId': userId },
        {
          $set: {
            'participants.$.leftAt': now,
            'participants.$.durationSeconds': duration,
          },
        },
      )
      .exec();

    this.logger.log(`✅ Participant ${userId} left call ${callId} (duration: ${duration}s)`);
  }

  /**
   * 結束通話
   */
  async endCall(
    callId: string,
    endReason: CallEndReason,
    durationSeconds?: number,
  ): Promise<CallRecord> {
    const now = new Date();
    const callRecord = await this.callRecordModel.findOne({ callId }).exec();

    if (!callRecord) {
      throw new Error(`Call record not found: ${callId}`);
    }

    // 計算總時長（如果沒有提供）
    const totalDuration =
      durationSeconds ||
      Math.floor((now.getTime() - callRecord.startedAt.getTime()) / 1000);

    const updated = await this.callRecordModel
      .findOneAndUpdate(
        { callId },
        {
          status: CallStatus.ENDED,
          endedAt: now,
          durationSeconds: totalDuration,
          endReason,
        },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new Error(`Call record not found: ${callId}`);
    }

    this.logger.log(`✅ Call ${callId} ended (duration: ${totalDuration}s, reason: ${endReason})`);
    return updated.toObject();
  }

  /**
   * 獲取通話記錄
   */
  async getCallRecord(callId: string): Promise<CallRecord | null> {
    const callRecord = await this.callRecordModel.findOne({ callId }).exec();
    return callRecord ? callRecord.toObject() : null;
  }

  /**
   * 獲取用戶通話歷史
   */
  async getCallHistory(
    userId: string,
    conversationId?: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{ calls: CallRecord[]; totalCount: number }> {
    const query: any = {
      'participants.userId': userId,
    };

    if (conversationId) {
      query.conversationId = conversationId;
    }

    const [calls, totalCount] = await Promise.all([
      this.callRecordModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .exec(),
      this.callRecordModel.countDocuments(query).exec(),
    ]);

    return {
      calls: calls.map((call) => call.toObject()),
      totalCount,
    };
  }

  /**
   * 獲取對話的通話記錄
   */
  async getConversationCalls(
    conversationId: string,
    limit: number = 20,
  ): Promise<CallRecord[]> {
    const calls = await this.callRecordModel
      .find({ conversationId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();

    return calls.map((call) => call.toObject());
  }

  /**
   * 獲取活躍通話
   */
  async getActiveCalls(): Promise<CallRecord[]> {
    const calls = await this.callRecordModel
      .find({
        status: { $in: [CallStatus.INITIATING, CallStatus.RINGING, CallStatus.CONNECTED] },
      })
      .exec();

    return calls.map((call) => call.toObject());
  }
}
