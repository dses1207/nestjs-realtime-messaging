import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ReadReceiptDocument = ReadReceipt & Document;

/**
 * ReadReceipt Schema - 事實來源層 (Source of Truth Layer)
 *
 * 職責：
 * - 記錄每一次的已讀事件（append-only）
 * - 用於精確查詢已讀成員列表（當用戶點擊「已讀 5」時）
 * - 支援無限擴展的已讀記錄儲存
 *
 * 設計優勢：
 * - 高效寫入：僅附加式 INSERT，無文件鎖定爭用
 * - 可擴展性：每個事件獨立存儲，易於分片
 * - 資料完整性：永久記錄所有已讀歷史
 */
@Schema({ timestamps: { createdAt: 'read_at', updatedAt: false } })
export class ReadReceipt {
  @Prop({ type: Types.ObjectId, ref: 'Message', required: true, index: true })
  message_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user_id: Types.ObjectId;

  @Prop({ type: Date, required: true })
  read_at: Date;
}

export const ReadReceiptSchema = SchemaFactory.createForClass(ReadReceipt);

// 複合索引：快速查詢特定訊息的所有已讀記錄（用於顯示已讀列表）
ReadReceiptSchema.index({ message_id: 1, read_at: -1 });

// 唯一索引：防止同一用戶對同一訊息重複記錄
ReadReceiptSchema.index({ message_id: 1, user_id: 1 }, { unique: true });

// 查詢索引：快速查詢特定用戶的已讀記錄
ReadReceiptSchema.index({ user_id: 1, read_at: -1 });
