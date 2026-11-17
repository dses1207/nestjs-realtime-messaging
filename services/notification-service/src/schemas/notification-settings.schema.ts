import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationSettingsDocument = NotificationSettings & Document;

@Schema({
  collection: 'notification_settings',
  timestamps: true,
})
export class NotificationSettings {
  @Prop({ type: Types.ObjectId, required: true, unique: true, ref: 'User' })
  userId: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  newMessage: boolean;

  @Prop({ type: Boolean, default: true })
  groupInvite: boolean;

  @Prop({ type: Boolean, default: true })
  groupMessage: boolean;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Date, default: Date.now })
  updatedAt: Date;
}

export const NotificationSettingsSchema = SchemaFactory.createForClass(NotificationSettings);