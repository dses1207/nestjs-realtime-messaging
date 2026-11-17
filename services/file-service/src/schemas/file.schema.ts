import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FileDocument = HydratedDocument<FileRecord>;

@Schema({ timestamps: true })
export class FileRecord {
  @Prop({ required: true })
  fileId: string; // UUID - 前端使用的安全檔案 ID

  @Prop({ required: true })
  minioObjectName: string; // MinIO 實際物件名稱

  @Prop({ required: true })
  originalName: string; // 原始檔案名稱

  @Prop({ required: true })
  contentType: string; // MIME type

  @Prop({ required: true })
  fileSize: number; // 檔案大小

  @Prop({ required: true })
  uploaderId: string; // 上傳者用戶 ID

  @Prop({ required: false })
  messageId: string; // 關聯的訊息 ID (可選)

  @Prop({ required: false })
  conversationId: string; // 關聯的對話 ID (可選)

  @Prop({ default: true })
  isActive: boolean; // 檔案是否有效

  @Prop({ default: 'general' })
  category: string; // 檔案類別: 'message', 'avatar', 'general'

  @Prop({ default: 'completed' })
  status: string; // 檔案狀態: 'pending', 'completed', 'failed'
}

export const FileSchema = SchemaFactory.createForClass(FileRecord);

// 建立索引以優化查詢
FileSchema.index({ fileId: 1 }, { unique: true });
FileSchema.index({ uploaderId: 1 });
FileSchema.index({ conversationId: 1 });
FileSchema.index({ messageId: 1 });