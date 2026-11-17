import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatController } from './controllers/chat.controller';
import { ChatService } from './services/chat.service';
import { NotificationClientService } from './services/notification-client.service';
import { ReadReceiptService } from './services/read-receipt.service';
import { User, UserSchema } from './schemas/user.schema';
import { Message, MessageSchema } from './schemas/message.schema';
import { Conversation, ConversationSchema } from './schemas/conversation.schema';
import { ReadReceipt, ReadReceiptSchema } from './schemas/read-receipt.schema';
import { ConversationState, ConversationStateSchema } from './schemas/conversation-state.schema';
import { SystemMessagePermission, SystemMessagePermissionSchema } from './schemas/system-message-permission.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Message.name, schema: MessageSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: ReadReceipt.name, schema: ReadReceiptSchema },
      { name: ConversationState.name, schema: ConversationStateSchema },
      { name: SystemMessagePermission.name, schema: SystemMessagePermissionSchema },
    ]),
  ],
  controllers: [ChatController],
  providers: [ChatService, NotificationClientService, ReadReceiptService],
})
export class AppModule {}
