import { Controller, Get, Param, UseGuards, Request, Query } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { Types } from 'mongoose';
import { ChatService } from '../services/chat.service';
import { ConversationResponseDto, MessageResponseDto } from '../dto/conversation.dto';
import { ReadReceiptService } from '../services/read-receipt.service';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly readReceiptService: ReadReceiptService,
  ) {}

  // HTTP endpoints (for testing)
  @Get('conversations')
  async getUserConversations(@Request() req: any): Promise<ConversationResponseDto[]> {
    // For testing - assume user id is passed as query param
    const userId = req.query?.userId || req.user?.userId;
    return this.chatService.getUserConversations(userId);
  }

  @Get('conversations/:conversationId/messages')
  async getConversationMessages(
    @Param('conversationId') conversationId: string,
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
    @Query('after') after?: string,
  ): Promise<MessageResponseDto[]> {
    const userId = req.query?.userId || req.user?.userId;
    const limitNumber = limit ? parseInt(limit, 10) : 50;
    return this.chatService.getConversationMessages(conversationId, userId, limitNumber, before, after);
  }

  // gRPC methods
  @GrpcMethod('ChatService', 'GetUserConversations')
  async grpcGetUserConversations(data: { userId: string }) {
    try {
      console.log('=== [gRPC] GetUserConversations called ===');
      console.log('[gRPC] userId:', data.userId);
      console.log('[gRPC] userId type:', typeof data.userId);

      const conversations = await this.chatService.getUserConversations(data.userId);
      console.log('[gRPC] Found conversations count:', conversations.length);

      const response = {
        conversations: conversations.map(conv => ({
          id: conv.id,
          name: conv.name,
          type: conv.type,
          participants: conv.participants.map(p => ({
            id: p.id,
            username: p.username || 'Unknown User',
            profilePicture: p.profilePicture || ''
          })),
          lastMessage: conv.lastMessage ? {
            content: conv.lastMessage.content,
            timestamp: conv.lastMessage.timestamp.toISOString(),
            senderName: conv.lastMessage.senderName || 'Unknown User'
          } : undefined,
          lastMessageAt: conv.lastMessageAt.toISOString(),
          createdAt: conv.createdAt.toISOString(),
          updatedAt: conv.updatedAt.toISOString(),
          groupPicture: conv.group_picture || '',
          unreadCount: conv.unread_count ?? 0,
          lastReadMessageId: conv.last_read_message_id || ''
        }))
      };

      console.log('[gRPC] Returning response with conversations.length:', response.conversations.length);
      return response;
    } catch (error) {
      console.error('=== [gRPC] GetUserConversations error ===');
      console.error('[gRPC] Error message:', error.message);
      console.error('[gRPC] Error stack:', error.stack);
      throw new RpcException({
        code: 5, // NOT_FOUND
        message: error.message || '取得對話列表失敗'
      });
    }
  }

  @GrpcMethod('ChatService', 'GetConversationMessages')
  async grpcGetConversationMessages(data: { conversationId: string; userId: string; limit?: number; before?: string; after?: string; }) {
    try {
      const messages = await this.chatService.getConversationMessages(data.conversationId, data.userId, data.limit, data.before, data.after);

      return {
        messages: messages.map(msg => {
          const responseMsg: any = {
            id: msg.id,
            content: msg.content,
            conversationId: msg.conversationId,
            senderId: msg.senderId || 'unknown',
            senderName: msg.senderName || 'Unknown User',
            senderProfilePicture: msg.senderProfilePicture || '',
            timestamp: msg.timestamp.toISOString(),
            messageType: msg.messageType || 'text',
            readCount: msg.read_count || 0,
          };

          // 如果有檔案資訊，添加到回應中
          if (msg.fileInfo) {
            responseMsg.fileInfo = msg.fileInfo;
          }

          return responseMsg;
        })
      };
    } catch (error) {
      throw new RpcException({
        code: 5, // NOT_FOUND
        message: error.message || '取得對話訊息失敗'
      });
    }
  }

  @GrpcMethod('ChatService', 'SaveMessage')
  async grpcSaveMessage(data: { 
    content: string; 
    conversationId: string; 
    senderId: string;
    messageType?: string;
    fileId?: string;
    fileInfo?: { originalName?: string; fileSize?: number; contentType?: string };
  }) {
    try {
      const savedMessage = await this.chatService.saveMessage(
        data.content, 
        data.conversationId, 
        data.senderId,
        data.messageType || 'text',
        data.fileId,
        data.fileInfo
      );

      const apiGatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:3050';
      
      // 構建回應訊息
      const responseMessage: any = {
        id: (savedMessage._id as any).toString(),
        content: savedMessage.content,
        conversationId: savedMessage.conversationId.toString(),
        senderId: savedMessage.senderId.toString(),
        timestamp: savedMessage.timestamp.toISOString(),
        messageType: savedMessage.messageType || 'text',
        readCount: savedMessage.read_count || 0,
      };

      // 如果是檔案訊息，添加檔案資訊
      if (savedMessage.fileId && savedMessage.fileInfo) {
        responseMessage.fileInfo = {
          fileId: savedMessage.fileId,
          originalName: savedMessage.fileInfo.originalName || 'Unknown File',
          fileSize: savedMessage.fileInfo.fileSize || 0,
          contentType: savedMessage.fileInfo.contentType || 'application/octet-stream',
          downloadUrl: `${apiGatewayUrl}/api/files/${savedMessage.fileId}/download`,
          previewUrl: `${apiGatewayUrl}/api/files/${savedMessage.fileId}/preview`,
        };
      }

      return { message: responseMessage };
    } catch (error) {
      throw new RpcException({
        code: 3, // INVALID_ARGUMENT
        message: error.message || '儲存訊息失敗'
      });
    }
  }

  @GrpcMethod('ChatService', 'GetConversationParticipants')
  async grpcGetConversationParticipants(data: { conversationId: string }) {
    try {
      const participantIds = await this.chatService.getConversationParticipants(data.conversationId);
      return {
        participantIds
      };
    } catch (error) {
      throw new RpcException({
        code: 5, // NOT_FOUND
        message: error.message || '取得聊天室成員失敗'
      });
    }
  }

  @GrpcMethod('ChatService', 'GetConversationDetails')
  async grpcGetConversationDetails(data: { conversationId: string }) {
    try {
      const conversation = await this.chatService.getConversationDetails(data.conversationId);
      return {
        conversation: {
          id: conversation.id,
          name: conversation.name,
          type: conversation.type,
          participants: conversation.participants.map(p => ({
            id: p.id,
            username: p.username || 'Unknown User',
            profilePicture: p.profilePicture || ''
          })),
          lastMessage: conversation.lastMessage ? {
            content: conversation.lastMessage.content,
            timestamp: conversation.lastMessage.timestamp.toISOString(),
            senderName: conversation.lastMessage.senderName || 'Unknown User'
          } : undefined,
          lastMessageAt: conversation.lastMessageAt.toISOString(),
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
          groupPicture: conversation.group_picture || ''
        }
      };
    } catch (error) {
      throw new RpcException({
        code: 5, // NOT_FOUND
        message: error.message || '取得聊天室詳細資訊失敗'
      });
    }
  }

  @GrpcMethod('ChatService', 'CreateChatRoom')
  async grpcCreateChatRoom(data: { memberIds: string[]; name?: string; createdBy: string }) {
    try {
      const conversation = await this.chatService.createChatRoom(data.memberIds, data.name, data.createdBy);
      return {
        conversation: {
          id: conversation.id,
          name: conversation.name,
          type: conversation.type,
          participants: conversation.participants.map(p => ({
            id: p.id,
            username: p.username || 'Unknown User',
            profilePicture: p.profilePicture || ''
          })),
          lastMessage: conversation.lastMessage ? {
            content: conversation.lastMessage.content,
            timestamp: conversation.lastMessage.timestamp.toISOString(),
            senderName: conversation.lastMessage.senderName || 'Unknown User'
          } : undefined,
          lastMessageAt: conversation.lastMessageAt.toISOString(),
          createdAt: conversation.createdAt.toISOString(),
          updatedAt: conversation.updatedAt.toISOString(),
          groupPicture: conversation.group_picture || ''
        }
      };
    } catch (error) {
      throw new RpcException({
        code: 3, // INVALID_ARGUMENT
        message: error.message || '建立聊天室失敗'
      });
    }
  }

  @GrpcMethod('ChatService', 'CheckUserInConversation')
  async grpcCheckUserInConversation(data: { userId: string; conversationId: string }) {
    try {
      console.log(`gRPC CheckUserInConversation called with:`, data);

      const hasAccess = await this.chatService.checkUserInConversation(data.userId, data.conversationId);

      const response = {
        success: true,
        hasAccess: hasAccess,
        message: hasAccess ? 'User has access to conversation' : 'User does not have access to conversation'
      };

      console.log(`gRPC CheckUserInConversation response:`, response);
      return response;
    } catch (error) {
      console.error('gRPC CheckUserInConversation error:', error);
      const errorResponse = {
        success: false,
        hasAccess: false,
        message: error.message || '檢查用戶權限失敗'
      };
      console.log(`gRPC CheckUserInConversation error response:`, errorResponse);
      return errorResponse;
    }
  }

  // ========== 已讀系統 gRPC 方法 ==========

  @GrpcMethod('ChatService', 'MarkMessagesAsRead')
  async grpcMarkMessagesAsRead(data: {
    userId: string;
    conversationId: string;
    lastReadMessageId: string;
  }) {
    try {
      // 驗證 ObjectId 格式
      if (!Types.ObjectId.isValid(data.userId)) {
        console.error(`[gRPC] Invalid userId format: ${data.userId}`);
        throw new RpcException({
          code: 3, // INVALID_ARGUMENT
          message: `無效的用戶 ID 格式: ${data.userId}`,
        });
      }

      if (!Types.ObjectId.isValid(data.conversationId)) {
        console.error(`[gRPC] Invalid conversationId format: ${data.conversationId}`);
        throw new RpcException({
          code: 3, // INVALID_ARGUMENT
          message: `無效的對話 ID 格式: ${data.conversationId}`,
        });
      }

      if (!Types.ObjectId.isValid(data.lastReadMessageId)) {
        console.error(`[gRPC] Invalid lastReadMessageId format: ${data.lastReadMessageId}`);
        throw new RpcException({
          code: 3, // INVALID_ARGUMENT
          message: `無效的訊息 ID 格式: ${data.lastReadMessageId}`,
        });
      }

      const result = await this.readReceiptService.markMessagesAsRead(
        data.userId,
        data.conversationId,
        data.lastReadMessageId,
      );

      return {
        success: result.success,
        affectedMessageIds: result.affectedMessageIds,
        newlyReadCount: result.newlyReadCount,
      };
    } catch (error) {
      // 記錄詳細錯誤
      console.error('[gRPC] MarkMessagesAsRead error:', {
        error: error.message,
        userId: data.userId,
        conversationId: data.conversationId,
        lastReadMessageId: data.lastReadMessageId,
      });

      throw new RpcException({
        code: 3, // INVALID_ARGUMENT
        message: error.message || '標記已讀失敗',
      });
    }
  }

  @GrpcMethod('ChatService', 'GetReadReceipts')
  async grpcGetReadReceipts(data: { messageId: string; limit?: number; offset?: number }) {
    try {
      const result = await this.readReceiptService.getReadReceipts(
        data.messageId,
        data.limit || 20,
        data.offset || 0,
      );

      return {
        receipts: result.receipts.map((r) => ({
          userId: r.user_id,
          username: r.username,
          profilePicture: r.profile_picture || '',
          readAt: r.read_at.toISOString(),
        })),
        totalCount: result.totalCount,
      };
    } catch (error) {
      throw new RpcException({
        code: 5, // NOT_FOUND
        message: error.message || '查詢已讀列表失敗',
      });
    }
  }

  @GrpcMethod('ChatService', 'GetConversationState')
  async grpcGetConversationState(data: { userId: string; conversationId: string }) {
    try {
      const state = await this.readReceiptService.getConversationState(
        data.userId,
        data.conversationId,
      );

      return {
        unreadCount: state.unreadCount,
        lastReadMessageId: state.lastReadMessageId || '',
        lastReadAt: state.lastReadAt ? state.lastReadAt.toISOString() : '',
      };
    } catch (error) {
      throw new RpcException({
        code: 5, // NOT_FOUND
        message: error.message || '查詢對話狀態失敗',
      });
    }
  }

  // ========== 系統訊息權限管理 gRPC Handlers ==========

  @GrpcMethod('ChatService', 'CheckSystemMessagePermission')
  async grpcCheckSystemMessagePermission(data: { userId: string }) {
    try {
      const result = await this.chatService.checkSystemMessagePermission(data.userId);
      return {
        hasPermission: result.hasPermission,
        username: result.username || '',
        description: ''  // 保持 proto 相容性，返回空字串
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '檢查權限失敗',
      });
    }
  }

  @GrpcMethod('ChatService', 'GrantSystemMessagePermission')
  async grpcGrantSystemMessagePermission(data: {
    userId: string;
    username: string;
    grantedBy: string;
  }) {
    try {
      const result = await this.chatService.grantSystemMessagePermission(data);
      return {
        success: result.success,
        message: result.message
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '授予權限失敗',
      });
    }
  }

  @GrpcMethod('ChatService', 'RevokeSystemMessagePermission')
  async grpcRevokeSystemMessagePermission(data: { userId: string }) {
    try {
      const result = await this.chatService.revokeSystemMessagePermission(data.userId);
      return {
        success: result.success,
        message: result.message
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '撤銷權限失敗',
      });
    }
  }

  @GrpcMethod('ChatService', 'ListSystemMessagePermissions')
  async grpcListSystemMessagePermissions(data: { activeOnly?: boolean }) {
    try {
      const result = await this.chatService.listSystemMessagePermissions(
        data.activeOnly !== undefined ? data.activeOnly : true
      );
      return {
        permissions: result.permissions.map(p => ({
          userId: p.userId,
          username: p.username,
          isActive: p.isActive,
          grantedBy: p.grantedBy,
          grantedAt: p.grantedAt.toISOString()
        })),
        totalCount: result.totalCount
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '列出權限失敗',
      });
    }
  }

  // ========== 系統訊息對話管理 gRPC Handlers ==========

  @GrpcMethod('ChatService', 'GetOrCreatePrivateConversation')
  async grpcGetOrCreatePrivateConversation(data: { userId1: string; userId2: string }) {
    try {
      const result = await this.chatService.getOrCreatePrivateConversation(data);
      return {
        conversationId: result.conversationId,
        isNewConversation: result.isNewConversation,
        conversation: result.conversation
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '建立對話失敗',
      });
    }
  }

  @GrpcMethod('ChatService', 'AddUserToConversation')
  async grpcAddUserToConversation(data: { userId: string; conversationId: string }) {
    try {
      const result = await this.chatService.addUserToConversation(data);
      return {
        success: result.success,
        message: result.message
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '加入對話失敗',
      });
    }
  }

  // ========== 聊天室管理 gRPC Handlers ==========

  @GrpcMethod('ChatService', 'RemoveUserFromConversation')
  async grpcRemoveUserFromConversation(data: {
    conversationId: string;
    userIdToRemove: string;
    operatorId: string;
  }) {
    try {
      const result = await this.chatService.removeUserFromConversation(data);
      return {
        success: result.success,
        message: result.message,
        removedUserId: result.removedUserId || '',
        conversationDeleted: result.conversationDeleted || false
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '移除成員失敗',
      });
    }
  }

  @GrpcMethod('ChatService', 'AddUsersToConversation')
  async grpcAddUsersToConversation(data: {
    conversationId: string;
    userIds: string[];
    operatorId: string;
  }) {
    try {
      const result = await this.chatService.addUsersToConversation(data);
      return {
        success: result.success,
        message: result.message,
        addedUserIds: result.addedUserIds || [],
        addedCount: result.addedCount || 0
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '新增成員失敗',
      });
    }
  }

  @GrpcMethod('ChatService', 'DeleteConversation')
  async grpcDeleteConversation(data: {
    conversationId: string;
    operatorId: string;
  }) {
    try {
      const result = await this.chatService.deleteConversation(data);
      return {
        success: result.success,
        message: result.message,
        deletedAt: result.deletedAt || ''
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '刪除聊天室失敗',
      });
    }
  }

  @GrpcMethod('ChatService', 'UpdateConversationName')
  async grpcUpdateConversationName(data: {
    conversationId: string;
    name: string;
    operatorId: string;
  }) {
    try {
      const result = await this.chatService.updateConversationName(data);
      return {
        success: result.success,
        message: result.message,
        newName: result.newName || ''
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || '更改聊天室名稱失敗',
      });
    }
  }
} 