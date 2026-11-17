import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CallRecordDocument = CallRecord & Document;

// 參與者角色
export enum ParticipantRole {
  CALLER = 'caller',
  CALLEE = 'callee',
  JOINED = 'joined',
}

// 通話類型
export enum CallType {
  AUDIO = 'audio',
  VIDEO = 'video',
}

// 通話狀態
export enum CallStatus {
  INITIATING = 'initiating',
  RINGING = 'ringing',
  CONNECTED = 'connected',
  ENDED = 'ended',
  FAILED = 'failed',
  REJECTED = 'rejected',
  NO_ANSWER = 'no_answer',
}

// 通話結束原因
export enum CallEndReason {
  NORMAL = 'normal',
  REJECTED = 'rejected',
  NO_ANSWER = 'no_answer',
  BUSY = 'busy',
  CANCELLED = 'cancelled',
  NETWORK_ERROR = 'network_error',
  KICKED = 'kicked',
}

// 通話參與者
export class CallParticipant {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  username: string;

  @Prop({ type: String, enum: ParticipantRole, required: true })
  role: ParticipantRole;

  @Prop({ type: Date, required: true })
  joinedAt: Date;

  @Prop({ type: Date })
  leftAt?: Date;

  @Prop({ type: Number })
  durationSeconds?: number;
}

// 通話品質統計
export class CallQuality {
  @Prop({ type: Number })
  avgLatency?: number;

  @Prop({ type: Number })
  avgPacketLoss?: number;

  @Prop({ type: Number })
  avgJitter?: number;
}

// 通話元數據
export class CallMetadata {
  @Prop({ type: CallQuality })
  quality?: CallQuality;

  @Prop({ type: String })
  recordingUrl?: string;

  @Prop({ type: String })
  recordingSid?: string;
}

@Schema({ timestamps: true, collection: 'calls' })
export class CallRecord {
  @Prop({ required: true, unique: true })
  callId: string;

  @Prop({ required: true, index: true })
  conversationId: string;

  @Prop({ required: true })
  roomName: string;

  @Prop({ type: String, enum: CallType, required: true })
  callType: CallType;

  @Prop({ type: String, enum: CallStatus, required: true, index: true })
  status: CallStatus;

  @Prop({ type: [CallParticipant], required: true })
  participants: CallParticipant[];

  @Prop({ required: true })
  initiatedBy: string;

  @Prop({ type: Date, required: true })
  startedAt: Date;

  @Prop({ type: Date })
  endedAt?: Date;

  @Prop({ type: Number })
  durationSeconds?: number;

  @Prop({ type: String, enum: CallEndReason })
  endReason?: CallEndReason;

  @Prop({ type: CallMetadata })
  metadata?: CallMetadata;

  // timestamps: true 會自動添加 createdAt 和 updatedAt
}

export const CallRecordSchema = SchemaFactory.createForClass(CallRecord);

// 創建索引
CallRecordSchema.index({ callId: 1 }, { unique: true });
CallRecordSchema.index({ conversationId: 1, createdAt: -1 });
CallRecordSchema.index({ 'participants.userId': 1, createdAt: -1 });
CallRecordSchema.index({ status: 1, startedAt: -1 });
