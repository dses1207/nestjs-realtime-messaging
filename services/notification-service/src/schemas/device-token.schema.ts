import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DeviceTokenDocument = DeviceToken & Document;

@Schema({
  collection: 'device_tokens',
  timestamps: true,
})
export class DeviceToken {
  @Prop({ type: Types.ObjectId, required: true, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ type: String, required: true })
  token: string;

  @Prop({ 
    type: String, 
    required: true, 
    enum: ['fcm', 'apns'],
    default: 'fcm'
  })
  platform: 'fcm' | 'apns';

  @Prop({ type: String, required: true })
  deviceId: string;

  @Prop({ type: String, required: false })
  appVersion: string;

  @Prop({
    type: String,
    required: false,
    enum: ['development', 'production'],
    default: 'production'
  })
  environment: 'development' | 'production';

  @Prop({ type: Date, default: Date.now })
  lastUsed: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);

// 唯一索引：確保一個設備 ID 在整個系統中只能有一個註冊記錄
// 無論是哪個用戶或哪個平台，一個 deviceId 只能對應一筆 token
DeviceTokenSchema.index(
  { deviceId: 1 },
  { unique: true, name: 'unique_device_id' }
);
// 單獨索引用於查詢優化
DeviceTokenSchema.index({ token: 1 });
DeviceTokenSchema.index({ userId: 1 });