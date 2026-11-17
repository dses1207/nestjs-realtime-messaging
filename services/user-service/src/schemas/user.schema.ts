import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, index: true })
  email: string;
  
  @Prop({ required: true })
  name: string;
  
  @Prop({ required: true, unique: true, index: true })
  username: string;

  @Prop({ required: true })
  password: string;

  @Prop({ required: false })
  department?: string;

  @Prop({ default: '' })
  profilePicture: string;
  
  @Prop({ default: 'online' })
  status: string;
  
  // timestamps: true auto-adds createdAt and updatedAt
  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User); 