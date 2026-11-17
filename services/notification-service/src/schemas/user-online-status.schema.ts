import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type UserOnlineStatusDocument = UserOnlineStatus & Document;

@Schema({ 
  timestamps: true,
  collection: 'useronlinestatus' 
})
export class UserOnlineStatus {
  @Prop({ type: Types.ObjectId, required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ default: false })
  isOnline: boolean;

  @Prop({ type: Date, default: Date.now })
  lastActiveAt: Date;

  @Prop({ type: [String], default: [] })
  connectedSockets: string[];

  @Prop({ type: String })
  userAgent?: string;

  @Prop({ type: String })
  ipAddress?: string;

  @Prop({ type: Date, default: Date.now })
  lastHeartbeat: Date;
}

export const UserOnlineStatusSchema = SchemaFactory.createForClass(UserOnlineStatus);

// 建立索引
UserOnlineStatusSchema.index({ userId: 1 }, { unique: true });
UserOnlineStatusSchema.index({ isOnline: 1, lastActiveAt: -1 });
UserOnlineStatusSchema.index({ lastHeartbeat: 1 });