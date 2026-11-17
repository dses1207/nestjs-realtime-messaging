import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  Inject,
  Request,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SystemMessagePermissionGuard } from '../guards/system-message-permission.guard';
import { SendSystemMessagesDto } from '../dto/send-system-messages.dto';
import { JoinGroupDto } from '../dto/join-group.dto';
import { firstValueFrom } from 'rxjs';

interface ChatServiceClient {
  getOrCreatePrivateConversation(data: any): any;
  saveMessage(data: any): any;
  addUserToConversation(data: any): any;
  checkUserInConversation(data: any): any;
}

interface UserServiceClient {
  getAllUsers(): any;
  getUserByUsername(data: { username: string }): any;
}

@Controller('api/system')
@UseGuards(JwtAuthGuard, SystemMessagePermissionGuard)
export class SystemMessageController {
  private readonly logger = new Logger(SystemMessageController.name);
  private chatService: ChatServiceClient;
  private userService: UserServiceClient;

  constructor(
    @Inject('CHAT_SERVICE') private chatClient: ClientGrpc,
    @Inject('USER_SERVICE') private userClient: ClientGrpc,
    private configService: ConfigService,
  ) {}

  onModuleInit() {
    this.chatService = this.chatClient.getService<ChatServiceClient>('ChatService');
    this.userService = this.userClient.getService<UserServiceClient>('UserService');
  }

  @Post('send-messages')
  async sendSystemMessages(
    @Body() dto: SendSystemMessagesDto,
    @Request() req: any
  ) {
    this.logger.log(`User ${req.user.username} is sending system messages`);

    try {
      // 取得 System User ID
      const systemUserId = await this.getSystemUserId();

      // 1. 決定目標對話列表
      let targetConversationIds: string[] = dto.conversationIds || [];

      // 如果沒有指定對話，取得所有使用者的 System 私訊對話
      if (targetConversationIds.length === 0) {
        this.logger.log('No conversationIds provided, broadcasting to all users');
        targetConversationIds = await this.getAllUserSystemConversations(systemUserId);
        this.logger.log(`Total conversations to send: ${targetConversationIds.length}`);
      } else {
        this.logger.log(`Sending to ${targetConversationIds.length} specified conversations`);
      }

      // 2. 批量發送訊息
      const results = [];
      let succeededCount = 0;
      let failedCount = 0;

      for (const conversationId of targetConversationIds) {
        try {
          // 檢查 System 是否在該對話中
          const checkResult = await firstValueFrom(
            this.chatService.checkUserInConversation({
              userId: systemUserId,
              conversationId: conversationId
            })
          ) as {
            hasAccess: boolean;
          };

          if (!checkResult.hasAccess) {
            this.logger.warn(`System user not in conversation ${conversationId}, skipping`);
            failedCount++;
            results.push({
              conversationId,
              success: false,
              error: 'System user not in conversation'
            });
            continue;
          }

          // 儲存訊息
          const messageResponse = await firstValueFrom(
            this.chatService.saveMessage({
              conversationId: conversationId,
              senderId: systemUserId,
              content: dto.content,
              messageType: dto.messageType || 'text',
              fileId: dto.fileId || '',
            })
          ) as {
            message: {
              id: string;
            };
          };

          succeededCount++;
          results.push({
            conversationId,
            success: true,
            messageId: messageResponse.message.id,
          });

        } catch (error) {
          failedCount++;
          this.logger.error(`Failed to send to conversation ${conversationId}:`, error.message);
          results.push({
            conversationId,
            success: false,
            error: error.message
          });
        }
      }

      this.logger.log(`Send completed by ${req.user.username}: ${succeededCount} succeeded, ${failedCount} failed`);

      return {
        success: true,
        sentBy: req.user.username,
        totalTargets: targetConversationIds.length,
        succeeded: succeededCount,
        failed: failedCount,
        results: results,
      };

    } catch (error) {
      this.logger.error('Error in sendSystemMessages:', error);
      throw new HttpException(
        error.message || 'Failed to send system messages',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('join-group')
  async joinGroup(
    @Body() dto: JoinGroupDto,
    @Request() req: any
  ) {
    this.logger.log(`User ${req.user.username} is adding System to group ${dto.conversationId}`);

    try {
      // 取得 System User ID
      const systemUserId = await this.getSystemUserId();

      // 呼叫 Chat Service 將 System 加入群組
      const result = await firstValueFrom(
        this.chatService.addUserToConversation({
          userId: systemUserId,
          conversationId: dto.conversationId
        })
      ) as {
        success: boolean;
        message: string;
      };

      if (!result.success) {
        throw new HttpException(result.message, HttpStatus.BAD_REQUEST);
      }

      this.logger.log(`Successfully added System to conversation ${dto.conversationId}`);

      return {
        success: true,
        message: result.message
      };

    } catch (error) {
      this.logger.error('Error in joinGroup:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to join group',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * 取得 System User ID
   */
  private async getSystemUserId(): Promise<string> {
    // 優先從環境變數取得
    let systemUserId = this.configService.get<string>('SYSTEM_USER_ID');

    if (systemUserId) {
      return systemUserId;
    }

    // 如果沒有設定，查詢 username 為 "system" 的使用者
    try {
      const systemUserResponse = await firstValueFrom(
        this.userService.getUserByUsername({ username: 'system' })
      ) as {
        found: boolean;
        user: {
          id: string;
        };
      };

      if (!systemUserResponse.found) {
        throw new Error('System user not found. Please create a user with username "system"');
      }

      systemUserId = systemUserResponse.user.id;
      this.logger.log(`System user ID resolved: ${systemUserId}`);
      return systemUserId;

    } catch (error) {
      this.logger.error('Failed to get system user:', error);
      throw new Error('System user not configured');
    }
  }

  /**
   * 取得所有使用者與 System 的對話 ID
   */
  private async getAllUserSystemConversations(systemUserId: string): Promise<string[]> {
    try {
      // 取得所有使用者
      const usersResponse = await firstValueFrom(
        this.userService.getAllUsers()
      ) as {
        users: Array<{
          id: string;
        }>;
      };

      const conversationIds: string[] = [];

      // 為每個使用者取得或建立與 System 的對話
      for (const user of usersResponse.users) {
        // 跳過 system 自己
        if (user.id === systemUserId) {
          continue;
        }

        try {
          const conversationResponse = await firstValueFrom(
            this.chatService.getOrCreatePrivateConversation({
              userId1: systemUserId,
              userId2: user.id
            })
          ) as {
            conversationId: string;
          };

          conversationIds.push(conversationResponse.conversationId);

        } catch (error) {
          this.logger.error(`Failed to get conversation for user ${user.id}:`, error.message);
        }
      }

      return conversationIds;

    } catch (error) {
      this.logger.error('Failed to get all user conversations:', error);
      throw error;
    }
  }
}
