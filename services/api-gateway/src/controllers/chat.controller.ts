import { Controller, Get, Post, Delete, Patch, Param, Body, Request, HttpException, HttpStatus, UseGuards, Query } from '@nestjs/common';
import { GrpcClientService } from '../services/grpc-client.service';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ApiResponse, ApiResponseHelper } from '../dto/api-response.dto';
import { AddMembersDto } from '../dto/add-members.dto';
import { UpdateRoomNameDto } from '../dto/update-room-name.dto';
import { WebSocketProxyGateway } from '../websocket/websocket-proxy.gateway';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(
    private readonly grpcClient: GrpcClientService,
    private readonly wsGateway: WebSocketProxyGateway,
  ) {}

  @Get('conversations')
  async getUserConversations(@Request() req: any): Promise<ApiResponse> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      const result = await firstValueFrom(this.grpcClient.getUserConversations({ userId }));

      // 防禦性處理:確保至少返回空數組
      const conversations = result?.conversations ?? [];

      return ApiResponseHelper.success(conversations, '取得對話列表成功');
    } catch (error) {
      console.error('=== Error getting conversations ===');
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      console.error('Error details:', JSON.stringify(error, null, 2));
      this.handleGrpcError(error);
    }
  }

  @Get('conversations/:conversationId/messages')
  async getConversationMessages(
    @Param('conversationId') conversationId: string,
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
  ): Promise<ApiResponse> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      const limitNumber = limit ? parseInt(limit, 10) : undefined;

      const result = await firstValueFrom(this.grpcClient.getConversationMessages({ conversationId, userId, limit: limitNumber, before, after }));
      return ApiResponseHelper.success(result.messages, '取得對話訊息成功');
    } catch (error) {
      console.error('Error getting messages:', error);
      this.handleGrpcError(error);
    }
  }

  @Post('messages')
  async saveMessage(@Body() messageData: { content: string; conversationId: string; senderId: string }): Promise<ApiResponse> {
    try {
      const result = await firstValueFrom(this.grpcClient.saveMessage(messageData));
      return ApiResponseHelper.success(result.message, '訊息發送成功');
    } catch (error) {
      this.handleGrpcError(error);
    }
  }

  @Post('rooms')
  async createChatRoom(
    @Body() roomData: { memberIds: string[]; name?: string },
    @Request() req: any,
  ): Promise<ApiResponse> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      // 驗證必要欄位
      if (!roomData.memberIds || !Array.isArray(roomData.memberIds) || roomData.memberIds.length === 0) {
        throw new HttpException(ApiResponseHelper.error('成員列表不能為空'), HttpStatus.BAD_REQUEST);
      }

      const result = await firstValueFrom(this.grpcClient.createChatRoom({
        memberIds: roomData.memberIds,
        name: roomData.name,
        createdBy: userId,
      }));

      // 判斷是否為新建聊天室 (createdAt 與當前時間相差小於 5 秒)
      const conversationCreatedAt = new Date(result.conversation.createdAt);
      const now = new Date();
      const timeDiff = Math.abs(now.getTime() - conversationCreatedAt.getTime());
      const isNewConversation = timeDiff < 5000; // 5秒內視為新建

      // 如果是新建聊天室,發送 Socket 通知給其他成員
      if (isNewConversation) {
        // 準備需要通知的成員列表 (排除創建者)
        const membersToNotify = roomData.memberIds.filter(memberId => memberId !== userId);

        if (membersToNotify.length > 0) {
          // 準備通知數據
          const notificationData = {
            conversation: result.conversation,
            createdBy: userId,
            timestamp: new Date().toISOString(),
          };

          // 向每個成員發送通知
          membersToNotify.forEach(memberId => {
            try {
              this.wsGateway.server.to(memberId).emit('newConversationCreated', notificationData);
            } catch (wsError) {
              // WebSocket 通知失敗不影響主流程
              console.warn(`Failed to send WebSocket notification to user ${memberId}:`, wsError);
            }
          });

          console.log(`Socket notifications sent to ${membersToNotify.length} member(s) for new conversation ${result.conversation.id}`);
        }
      }

      return ApiResponseHelper.success(result.conversation, '聊天室建立成功');
    } catch (error) {
      console.error('Error creating chat room:', error);
      this.handleGrpcError(error);
    }
  }

  // ========== 聊天室管理 HTTP Endpoints ==========

  @Delete('rooms/:conversationId/members/:userId')
  async removeMember(
    @Param('conversationId') conversationId: string,
    @Param('userId') userIdToRemove: string,
    @Request() req: any,
  ): Promise<ApiResponse> {
    try {
      const operatorId = req.user?.userId;
      if (!operatorId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      const result = await firstValueFrom(
        this.grpcClient.removeUserFromConversation({
          conversationId,
          userIdToRemove,
          operatorId,
        }),
      ) as {
        success: boolean;
        message: string;
        removedUserId: string;
        conversationDeleted: boolean;
      };

      return ApiResponseHelper.success(
        {
          removedUserId: result.removedUserId,
          conversationDeleted: result.conversationDeleted,
        },
        result.message,
      );
    } catch (error) {
      console.error('Error removing member:', error);
      this.handleGrpcError(error);
    }
  }

  @Post('rooms/:conversationId/members')
  async addMembers(
    @Param('conversationId') conversationId: string,
    @Body() body: AddMembersDto,
    @Request() req: any,
  ): Promise<ApiResponse> {
    try {
      const operatorId = req.user?.userId;
      if (!operatorId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      const result = await firstValueFrom(
        this.grpcClient.addUsersToConversation({
          conversationId,
          userIds: body.userIds,
          operatorId,
        }),
      ) as {
        success: boolean;
        message: string;
        addedUserIds: string[];
        addedCount: number;
      };

      return ApiResponseHelper.success(
        {
          addedUserIds: result.addedUserIds,
          addedCount: result.addedCount,
        },
        result.message,
      );
    } catch (error) {
      console.error('Error adding members:', error);
      this.handleGrpcError(error);
    }
  }

  @Delete('rooms/:conversationId')
  async deleteRoom(
    @Param('conversationId') conversationId: string,
    @Request() req: any,
  ): Promise<ApiResponse> {
    try {
      const operatorId = req.user?.userId;
      if (!operatorId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      const result = await firstValueFrom(
        this.grpcClient.deleteConversation({
          conversationId,
          operatorId,
        }),
      ) as {
        success: boolean;
        message: string;
        deletedAt: string;
      };

      return ApiResponseHelper.success(
        {
          deletedAt: result.deletedAt,
        },
        result.message,
      );
    } catch (error) {
      console.error('Error deleting room:', error);
      this.handleGrpcError(error);
    }
  }

  @Patch('rooms/:conversationId/name')
  async updateRoomName(
    @Param('conversationId') conversationId: string,
    @Body() body: UpdateRoomNameDto,
    @Request() req: any,
  ): Promise<ApiResponse> {
    try {
      const operatorId = req.user?.userId;
      if (!operatorId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      const result = await firstValueFrom(
        this.grpcClient.updateConversationName({
          conversationId,
          name: body.name,
          operatorId,
        }),
      ) as {
        success: boolean;
        message: string;
        newName: string;
      };

      return ApiResponseHelper.success(
        {
          newName: result.newName,
        },
        result.message,
      );
    } catch (error) {
      console.error('Error updating room name:', error);
      this.handleGrpcError(error);
    }
  }

  private handleGrpcError(error: any): never {
    const grpcCode = error.code;
    const message = error.details || error.message || '服務暫時不可用';

    switch (grpcCode) {
      case 3: // INVALID_ARGUMENT
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.BAD_REQUEST);
      case 16: // UNAUTHENTICATED
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.UNAUTHORIZED);
      case 6: // ALREADY_EXISTS
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.CONFLICT);
      case 5: // NOT_FOUND
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.NOT_FOUND);
      case 13: // INTERNAL
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.INTERNAL_SERVER_ERROR);
      default:
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
} 