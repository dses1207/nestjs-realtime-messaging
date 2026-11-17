import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ConversationStateDocument = ConversationState & Document;

/**
 * ConversationState Schema - 使用者狀態層 (User State Layer)
 *
 * 職責：
 * - 追蹤每個用戶在每個對話中的閱讀狀態
 * - 快速計算對話列表中的未讀訊息數（紅色標記/badge）
 * - 記錄用戶的閱讀進度點（last_read_message_id）
 *
 * 使用場景：
 * - 對話列表顯示：「工作群組 (3)」← 括號中的未讀數
 * - App Icon Badge：顯示總未讀訊息數
 * - 判斷哪些訊息是「新訊息」需要標記為已讀
 *
 * 設計特點：
 * - 每個用戶在每個對話中只有一筆記錄（唯一索引）
 * - 透過 unread_count 快速渲染對話列表
 * - 透過 last_read_message_id 精確追蹤閱讀進度
 */
@Schema({ timestamps: true, collection: 'conversation_states' })
export class ConversationState {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  user_id: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Conversation', required: true, index: true })
  conversation_id: Types.ObjectId;

  @Prop({ type: Number, required: true, default: 0, min: 0 })
  unread_count: number;

  @Prop({ type: Types.ObjectId, ref: 'Message', required: false })
  last_read_message_id?: Types.ObjectId | null;   // 還沒讀過任何訊息時為 null

  @Prop({ type: Date, required: false })
  last_read_at?: Date | null;

  @Prop({ type: Date, required: true })
  createdAt: Date;

  @Prop({ type: Date, required: true })
  updatedAt: Date;
}

export const ConversationStateSchema = SchemaFactory.createForClass(ConversationState);

// 唯一複合索引：確保每個用戶在每個對話中只有一筆狀態記錄
ConversationStateSchema.index({ user_id: 1, conversation_id: 1 }, { unique: true });

// 查詢索引：快速獲取用戶的所有對話狀態（用於對話列表渲染）
ConversationStateSchema.index({ user_id: 1, unread_count: -1 });

// 查詢索引：快速查詢特定對話的所有用戶狀態（用於群組已讀狀態統計）
ConversationStateSchema.index({ conversation_id: 1, user_id: 1 });
