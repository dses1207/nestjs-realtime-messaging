import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationHistoryDocument = NotificationHistory & Document;

@Schema({
  collection: 'notification_history',
  timestamps: true,
})
export class NotificationHistory {
  @Prop({ type: Types.ObjectId, required: true, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ 
    type: String, 
    required: true, 
    enum: ['new_message', 'group_invite', 'group_message']
  })
  type: 'new_message' | 'group_invite' | 'group_message';

  @Prop({ type: String, required: true })
  title: string;

  @Prop({ type: String, required: true })
  body: string;

  @Prop({ type: Object, default: {} })
  data: Record<string, any>;

  @Prop({ 
    type: String, 
    required: true, 
    enum: ['fcm', 'apns']
  })
  platform: 'fcm' | 'apns';

  @Prop({ 
    type: String, 
    required: true, 
    enum: ['pending', 'sent', 'failed'],
    default: 'pending'
  })
  status: 'pending' | 'sent' | 'failed';

  @Prop({ type: String, required: false })
  errorMessage: string;

  @Prop({ type: String, required: false })
  messageId: string;

  @Prop({ type: Date, default: Date.now })
  sentAt: Date;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;
}

export const NotificationHistorySchema = SchemaFactory.createForClass(NotificationHistory);

NotificationHistorySchema.index({ userId: 1, createdAt: -1 });
NotificationHistorySchema.index({ status: 1 });