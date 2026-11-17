import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ConversationDocument = Conversation & Document;

@Schema({ timestamps: true })
export class Conversation {
  @Prop({ type: Date, required: true })
  createdAt: Date;

  @Prop({ type: Date, required: true })
  lastMessageAt: Date;      // 最後訊息時間

  @Prop({ type: String, required: false })
  name: string;             // 對話名稱

  @Prop({ type: [Types.ObjectId], ref: 'User', required: true })
  participants: Types.ObjectId[];  // 參與者 ID 陣列

  @Prop({ type: String, required: true })
  type: string;             // 對話類型（private/group）

  @Prop({ type: String, required: false })
  group_picture: string;    // 群組頭貼URL

  @Prop({ type: Date, required: true })
  updatedAt: Date;

  // 軟刪除相關欄位
  @Prop({ type: Boolean, default: false, index: true })
  isDeleted: boolean;       // 是否已刪除

  @Prop({ type: Date, required: false })
  deletedAt?: Date;         // 刪除時間

  @Prop({ type: Types.ObjectId, ref: 'User', required: false })
  deletedBy?: Types.ObjectId; // 刪除者 ID
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

// 建立複合索引，優化軟刪除過濾查詢
ConversationSchema.index({ isDeleted: 1, lastMessageAt: -1 });
ConversationSchema.index({ participants: 1, isDeleted: 1 }); 