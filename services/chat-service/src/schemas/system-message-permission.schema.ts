import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

@Schema({ collection: 'system_message_permissions', timestamps: true })
export class SystemMessagePermission extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId: Types.ObjectId;

  @Prop({ required: true })
  username: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  grantedBy: string;

  @Prop()
  grantedAt: Date;
}

export const SystemMessagePermissionSchema = SchemaFactory.createForClass(SystemMessagePermission);

// 建立索引
SystemMessagePermissionSchema.index({ userId: 1 }, { unique: true });
SystemMessagePermissionSchema.index({ username: 1 });
