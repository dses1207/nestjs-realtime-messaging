import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema()
export class Message {
  @Prop({ type: String, required: true })
  content: string;

  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true })
  conversationId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  senderId: Types.ObjectId;

  @Prop({ type: Date, required: true })
  timestamp: Date;

  // 新增欄位：訊息類型
  @Prop({ type: String, required: true, default: 'text', enum: ['text', 'file', 'image', 'document', 'video'] })
  messageType: string;

  // 新增欄位：檔案ID (可選)
  @Prop({ type: String, required: false })
  fileId?: string;

  // 新增欄位：檔案資訊 (可選)
  @Prop({
    type: {
      originalName: { type: String, required: false },
      fileSize: { type: Number, required: false },
      contentType: { type: String, required: false },
    },
    required: false
  })
  fileInfo?: {
    originalName?: string;
    fileSize?: number;
    contentType?: string;
  };

  // 快取層欄位：已讀計數 (Read Performance Cache Layer)
  // 用於 UI 直接顯示「已讀 5」，無需額外查詢
  @Prop({ type: Number, required: true, default: 0, min: 0 })
  read_count: number;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

// 索引優化：支援高效的對話訊息查詢
MessageSchema.index({ conversationId: 1, timestamp: -1 });
MessageSchema.index({ conversationId: 1, _id: -1 }); 