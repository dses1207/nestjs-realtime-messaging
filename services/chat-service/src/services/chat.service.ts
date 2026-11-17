import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';
import { Message, MessageDocument } from '../schemas/message.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { SystemMessagePermission } from '../schemas/system-message-permission.schema';
import { ConversationState } from '../schemas/conversation-state.schema';
import { ConversationResponseDto, MessageResponseDto } from '../dto/conversation.dto';
import { ReadReceiptService } from './read-receipt.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(SystemMessagePermission.name) private systemMessagePermissionModel: Model<SystemMessagePermission>,
    @InjectModel(ConversationState.name) private conversationStateModel: Model<ConversationState>,
    private readReceiptService: ReadReceiptService,
  ) {}

  async getUserConversations(userId: string): Promise<ConversationResponseDto[]> {
    console.log('=== [Service] getUserConversations called ===');
    console.log('[Service] userId:', userId);

    try {
      const userObjectId = new Types.ObjectId(userId);
      console.log('[Service] userObjectId:', userObjectId.toString());

      // 查找用戶參與的所有對話（排除已刪除的）
      const conversations = await this.conversationModel
        .find({
          participants: userObjectId,
          isDeleted: { $ne: true }  // 過濾已刪除的對話（向後兼容沒有此欄位的文檔）
        })
        .populate('participants', 'username profilePicture')
        .sort({ lastMessageAt: -1 })
        .exec();

      console.log('[Service] Found conversations in DB:', conversations.length);

      // 批量查詢所有對話的未讀數（避免 N+1 查詢問題）
      const unreadCountsResult = await this.readReceiptService.getAllUnreadCounts(userId);
      console.log('[Service] Fetched unread counts for conversations');

      // 建立 conversationId -> unreadCount 的映射
      const unreadCountsMap = new Map<string, number>();
      unreadCountsResult.counts.forEach(item => {
        unreadCountsMap.set(item.conversationId, item.unreadCount);
      });

      // 批量查詢所有對話的 ConversationState 以獲取 lastReadMessageId
      const conversationIds = conversations.map(c => (c._id as Types.ObjectId).toString());
      const conversationStates = await this.conversationStateModel
        .find({
          user_id: userObjectId,
          conversation_id: { $in: conversationIds.map(id => new Types.ObjectId(id)) }
        })
        .exec();

      // 建立 conversationId -> lastReadMessageId 的映射
      const lastReadMessageIdMap = new Map<string, string>();
      conversationStates.forEach(state => {
        if (state.last_read_message_id) {
          lastReadMessageIdMap.set(
            state.conversation_id.toString(),
            state.last_read_message_id.toString()
          );
        }
      });

      const result: ConversationResponseDto[] = [];

      for (const conversation of conversations) {
        const conversationId = (conversation._id as Types.ObjectId).toString();

        // 獲取最後一條訊息
        const lastMessage = await this.messageModel
          .findOne({ conversationId: conversation._id })
          .populate('senderId', 'username')
          .sort({ timestamp: -1 })
          .exec();

        // 過濾掉已被刪除的用戶（null值）
        const validParticipants = conversation.participants.filter((p: any) => p !== null);

        // 從映射中獲取未讀數和最後已讀訊息
        const unreadCount = unreadCountsMap.get(conversationId) ?? 0;
        const lastReadMessageId = lastReadMessageIdMap.get(conversationId);

        const conversationDto: ConversationResponseDto = {
          id: conversationId,
          name: conversation.name,
          type: conversation.type,
          participants: validParticipants.map((p: any) => ({
            id: p._id.toString(),
            username: p.username || 'Unknown User',
            profilePicture: p.profilePicture || '',
          })),
          lastMessage: lastMessage ? {
            content: lastMessage.content,
            timestamp: lastMessage.timestamp,
            senderName: (lastMessage.senderId as any)?.username || 'Unknown User',
          } : undefined,
          lastMessageAt: conversation.lastMessageAt,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          group_picture: conversation.group_picture,
          unread_count: unreadCount,
          last_read_message_id: lastReadMessageId,
        };

        result.push(conversationDto);
      }

      console.log('[Service] Returning result array length:', result.length);
      return result;
    } catch (error) {
      console.error('=== [Service] getUserConversations error ===');
      console.error('[Service] Error:', error.message);
      console.error('[Service] Stack:', error.stack);
      throw error;
    }
  }

  async getConversationMessages(
    conversationId: string, 
    userId: string,
    limit: number = 50,
    before?: string,
    after?: string,
  ): Promise<MessageResponseDto[]> {
    const conversationObjectId = new Types.ObjectId(conversationId);
    const userObjectId = new Types.ObjectId(userId);

    // 驗證用戶是否參與該對話（排除已刪除的）
    const conversation = await this.conversationModel
      .findOne({
        _id: conversationObjectId,
        participants: userObjectId,
        isDeleted: { $ne: true }  // 過濾已刪除的對話（向後兼容沒有此欄位的文檔）
      })
      .exec();

    if (!conversation) {
      throw new Error('Conversation not found or user not authorized');
    }

    const query: any = { conversationId: conversationObjectId };
    let sortOptions: any = { _id: -1 }; 

    if (before) {
      query._id = { $lt: new Types.ObjectId(before) };
    }

    if (after) {
      query._id = { $gt: new Types.ObjectId(after) };
      sortOptions = { _id: 1 };
    }

    // 獲取對話中的訊息
    const messages = await this.messageModel
      .find(query)
      .populate('senderId', 'username profilePicture')
      .sort(sortOptions)
      .limit(limit)
      .exec();

    if (after) {
      messages.reverse();
    }

    return messages.map((message: any) => {
      const apiGatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:3050';

      // 基本訊息結構
      const messageDto: any = {
        id: (message._id as Types.ObjectId).toString(),
        content: message.content,
        conversationId: message.conversationId.toString(),
        senderId: (message.senderId as any)?._id?.toString() || 'unknown',
        senderName: (message.senderId as any)?.username || 'Unknown User',
        senderProfilePicture: (message.senderId as any)?.profilePicture || '',
        timestamp: message.timestamp,
        messageType: message.messageType || 'text',
        read_count: message.read_count || 0, // 已讀數量
      };

      // 如果是檔案訊息，添加檔案資訊和生成URL
      if (message.fileId && message.fileInfo) {
        messageDto.fileInfo = {
          fileId: message.fileId,
          originalName: message.fileInfo.originalName || 'Unknown File',
          fileSize: message.fileInfo.fileSize || 0,
          contentType: message.fileInfo.contentType || 'application/octet-stream',
          downloadUrl: `${apiGatewayUrl}/api/files/${message.fileId}/download`,
          previewUrl: `${apiGatewayUrl}/api/files/${message.fileId}/preview`,
        };

        // 對於檔案訊息，content 設為下載URL以保持向後兼容
        if (message.messageType !== 'text') {
          messageDto.content = messageDto.fileInfo.downloadUrl;
        }
      }

      return messageDto;
    });
  }

  async saveMessage(
    content: string,
    conversationId: string,
    senderId: string,
    messageType: string = 'text',
    fileId?: string,
    fileInfo?: { originalName?: string; fileSize?: number; contentType?: string }
  ): Promise<MessageDocument> {
    this.logger.log(`[saveMessage] 開始儲存訊息 - 對話: ${conversationId}, 發送者: ${senderId}, 類型: ${messageType}`);

    const conversationObjectId = new Types.ObjectId(conversationId);
    const senderObjectId = new Types.ObjectId(senderId);
    const apiGatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:3050';

    // 如果是檔案訊息，content 設為下載URL
    let finalContent = content;
    if (messageType !== 'text' && fileId) {
      finalContent = `${apiGatewayUrl}/api/files/${fileId}/download`;
    }

    // 創建新訊息
    const messageData: any = {
      content: finalContent,
      conversationId: conversationObjectId,
      senderId: senderObjectId,
      timestamp: new Date(),
      messageType,
    };

    // 如果有檔案相關資訊，添加到訊息中
    if (fileId) {
      messageData.fileId = fileId;
    }
    if (fileInfo) {
      messageData.fileInfo = fileInfo;
    }

    const newMessage = new this.messageModel(messageData);

    // 儲存訊息
    const savedMessage = await newMessage.save();
    this.logger.log(`[saveMessage] ✅ 訊息已儲存 - ID: ${savedMessage._id}`);

    // 更新對話的最後訊息時間
    await this.conversationModel.findByIdAndUpdate(
      conversationObjectId,
      {
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      }
    );
    this.logger.log(`[saveMessage] ✅ 對話時間已更新`);

    // 更新所有參與者的未讀數（除了發送者）
    try {
      this.logger.log(`[saveMessage] 準備調用 incrementUnreadCount`);
      await this.readReceiptService.incrementUnreadCount(
        conversationObjectId.toString(),
        senderObjectId.toString(),
      );
      this.logger.log(`[saveMessage] ✅ incrementUnreadCount 執行成功`);
    } catch (error) {
      // 記錄錯誤但不影響訊息儲存
      this.logger.error(
        `[saveMessage] ❌ incrementUnreadCount 失敗 - 對話: ${conversationId}, 錯誤: ${error.message}`,
        error.stack
      );
    }

    // 推播通知責任已轉移到 WebSocket Server
    // Chat Service 現在專注於純資料儲存

    this.logger.log(`[saveMessage] 完成 - 訊息ID: ${savedMessage._id}`);
    return savedMessage;
  }

  async getConversationParticipants(conversationId: string): Promise<string[]> {
    const conversationObjectId = new Types.ObjectId(conversationId);
    
    const conversation = await this.conversationModel
      .findById(conversationObjectId)
      .populate('participants')
      .exec();

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // 返回參與者的 ID 列表，過濾掉已被刪除的用戶
    return conversation.participants
      .filter((p: any) => p !== null)
      .map((p: any) => (p as any)._id.toString());
  }

  async getConversationDetails(conversationId: string): Promise<ConversationResponseDto> {
    const conversationObjectId = new Types.ObjectId(conversationId);
    
    const conversation = await this.conversationModel
      .findById(conversationObjectId)
      .populate('participants', 'username profilePicture')
      .exec();

    if (!conversation) {
      throw new Error('Conversation not found');
    }

    // 獲取最後一條訊息
    const lastMessage = await this.messageModel
      .findOne({ conversationId: conversation._id })
      .populate('senderId', 'username')
      .sort({ timestamp: -1 })
      .exec();

    // 過濾掉已被刪除的用戶（null值）
    const validParticipants = conversation.participants.filter((p: any) => p !== null);

    return {
      id: (conversation._id as Types.ObjectId).toString(),
      name: conversation.name,
      type: conversation.type,
      participants: validParticipants.map((p: any) => ({
        id: p._id.toString(),
        username: p.username || 'Unknown User',
        profilePicture: p.profilePicture || '',
      })),
      lastMessage: lastMessage ? {
        content: lastMessage.content,
        timestamp: lastMessage.timestamp,
        senderName: (lastMessage.senderId as any)?.username || 'Unknown User',
      } : undefined,
      lastMessageAt: conversation.lastMessageAt,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      group_picture: conversation.group_picture,
    };
  }

  async createChatRoom(memberIds: string[], name?: string, createdBy?: string): Promise<ConversationResponseDto> {
    // 將所有成員 ID 轉換為 ObjectId
    const memberObjectIds = memberIds.map(id => new Types.ObjectId(id));
    
    // 如果有創建者 ID，確保創建者也在成員列表中
    if (createdBy) {
      const createdByObjectId = new Types.ObjectId(createdBy);
      if (!memberObjectIds.some(id => id.equals(createdByObjectId))) {
        memberObjectIds.push(createdByObjectId);
      }
    }

    // 檢查是否為私訊（只有兩個成員且沒有指定名稱）
    const isPrivateChat = memberObjectIds.length === 2 && !name;
    
    if (isPrivateChat) {
      // 檢查是否已存在相同成員的私訊
      const existingConversation = await this.conversationModel
        .findOne({
          type: 'private',
          participants: { $all: memberObjectIds, $size: 2 }
        })
        .populate('participants', 'username profilePicture')
        .exec();

      if (existingConversation) {
        // 如果找到現有的，也一併查詢最後一則訊息
        const lastMessage = await this.messageModel
          .findOne({ conversationId: existingConversation._id })
          .populate('senderId', 'username')
          .sort({ timestamp: -1 })
          .exec();

        // 返回現有的私訊
        const validParticipants = existingConversation.participants.filter((p: any) => p !== null);
        return {
          id: (existingConversation._id as Types.ObjectId).toString(),
          name: existingConversation.name,
          type: existingConversation.type,
          participants: validParticipants.map((p: any) => ({
            id: p._id.toString(),
            username: p.username || 'Unknown User',
            profilePicture: p.profilePicture || '',
          })),
          lastMessage: lastMessage ? {
            content: lastMessage.content,
            timestamp: lastMessage.timestamp,
            senderName: (lastMessage.senderId as any)?.username || 'Unknown User',
          } : undefined,
          lastMessageAt: existingConversation.lastMessageAt,
          createdAt: existingConversation.createdAt,
          updatedAt: existingConversation.updatedAt,
          group_picture: existingConversation.group_picture,
        };
      }
    }

    // 驗證所有成員是否存在
    const existingUsers = await this.userModel
      .find({ _id: { $in: memberObjectIds } })
      .exec();

    if (existingUsers.length !== memberObjectIds.length) {
      throw new Error('Some users not found');
    }

    // 決定聊天室名稱和類型
    let chatRoomName: string;
    let chatRoomType: string;

    if (isPrivateChat) {
      // 私訊：名稱設為空字串
      chatRoomName = '';
      chatRoomType = 'private';
    } else {
      // 群聊：使用提供的名稱或預設名稱
      chatRoomName = name || `群組聊天 (${existingUsers.length} 人)`;
      chatRoomType = 'group';
    }

    // 創建新的聊天室
    const now = new Date();
    const newConversation = new this.conversationModel({
      name: chatRoomName,
      type: chatRoomType,
      participants: memberObjectIds,
      createdAt: now,
      lastMessageAt: now,
      updatedAt: now,
      group_picture: '',
    });

    const savedConversation = await newConversation.save();

    // 重新查詢並填充參與者資訊
    const populatedConversation = await this.conversationModel
      .findById(savedConversation._id)
      .populate('participants', 'username profilePicture')
      .exec();

    if (!populatedConversation) {
      throw new Error('Failed to create or find conversation');
    }

    const validParticipants = populatedConversation.participants.filter((p: any) => p !== null);

    return {
      id: (populatedConversation._id as Types.ObjectId).toString(),
      name: populatedConversation.name,
      type: populatedConversation.type,
      participants: validParticipants.map((p: any) => ({
        id: p._id.toString(),
        username: p.username || 'Unknown User',
        profilePicture: p.profilePicture || '',
      })),
      lastMessage: undefined,
      lastMessageAt: populatedConversation.lastMessageAt,
      createdAt: populatedConversation.createdAt,
      updatedAt: populatedConversation.updatedAt,
      group_picture: populatedConversation.group_picture,
    };
  }

  async checkUserInConversation(userId: string, conversationId: string): Promise<boolean> {
    try {
      console.log(`Checking user access: userId=${userId}, conversationId=${conversationId}`);
      
      // 驗證 ObjectId 格式
      if (!Types.ObjectId.isValid(userId)) {
        console.error(`Invalid userId format: ${userId}`);
        return false;
      }
      
      if (!Types.ObjectId.isValid(conversationId)) {
        console.error(`Invalid conversationId format: ${conversationId}`);
        return false;
      }

      const userObjectId = new Types.ObjectId(userId);
      const conversationObjectId = new Types.ObjectId(conversationId);

      console.log(`Looking for conversation with ObjectId: ${conversationObjectId} and user: ${userObjectId}`);

      // 查找對話並檢查用戶是否在參與者列表中（排除已刪除的）
      const conversation = await this.conversationModel
        .findOne({
          _id: conversationObjectId,
          participants: userObjectId,
          isDeleted: { $ne: true }  // 過濾已刪除的對話（向後兼容沒有此欄位的文檔）
        })
        .exec();

      const hasAccess = !!conversation;
      console.log(`Access check result: hasAccess=${hasAccess}, conversationFound=${!!conversation}`);

      return hasAccess;
    } catch (error) {
      console.error('Error checking user in conversation:', error);
      return false;
    }
  }

  // ========== 系統訊息權限管理方法 ==========

  /**
   * 檢查使用者是否有系統訊息權限
   */
  async checkSystemMessagePermission(userId: string): Promise<{
    hasPermission: boolean;
    username?: string;
  }> {
    try {
      const permission = await this.systemMessagePermissionModel.findOne({
        userId: new Types.ObjectId(userId),
        isActive: true
      });

      if (!permission) {
        return { hasPermission: false };
      }

      return {
        hasPermission: true,
        username: permission.username
      };
    } catch (error) {
      this.logger.error(`Error checking system message permission for user ${userId}:`, error);
      return { hasPermission: false };
    }
  }

  /**
   * 授予系統訊息權限
   */
  async grantSystemMessagePermission(params: {
    userId: string;
    username: string;
    grantedBy: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const existing = await this.systemMessagePermissionModel.findOne({
        userId: new Types.ObjectId(params.userId)
      });

      if (existing) {
        // 如果已存在，更新為 active
        existing.isActive = true;
        existing.grantedBy = params.grantedBy;
        existing.grantedAt = new Date();
        await existing.save();

        return {
          success: true,
          message: 'Permission updated successfully'
        };
      }

      // 建立新權限
      await this.systemMessagePermissionModel.create({
        userId: new Types.ObjectId(params.userId),
        username: params.username,
        isActive: true,
        grantedBy: params.grantedBy,
        grantedAt: new Date()
      });

      return {
        success: true,
        message: 'Permission granted successfully'
      };
    } catch (error) {
      this.logger.error('Error granting system message permission:', error);
      return {
        success: false,
        message: 'Failed to grant permission'
      };
    }
  }

  /**
   * 撤銷系統訊息權限
   */
  async revokeSystemMessagePermission(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      const result = await this.systemMessagePermissionModel.findOneAndUpdate(
        { userId: new Types.ObjectId(userId) },
        { isActive: false },
        { new: true }
      );

      if (!result) {
        return {
          success: false,
          message: 'Permission not found'
        };
      }

      return {
        success: true,
        message: 'Permission revoked successfully'
      };
    } catch (error) {
      this.logger.error('Error revoking system message permission:', error);
      return {
        success: false,
        message: 'Failed to revoke permission'
      };
    }
  }

  /**
   * 列出所有權限使用者
   */
  async listSystemMessagePermissions(activeOnly: boolean = true): Promise<{
    permissions: Array<{
      userId: string;
      username: string;
      isActive: boolean;
      grantedBy: string;
      grantedAt: Date;
    }>;
    totalCount: number;
  }> {
    try {
      const query = activeOnly ? { isActive: true } : {};
      const permissions = await this.systemMessagePermissionModel.find(query).exec();

      return {
        permissions: permissions.map(p => ({
          userId: p.userId.toString(),
          username: p.username,
          isActive: p.isActive,
          grantedBy: p.grantedBy,
          grantedAt: p.grantedAt
        })),
        totalCount: permissions.length
      };
    } catch (error) {
      this.logger.error('Error listing system message permissions:', error);
      return { permissions: [], totalCount: 0 };
    }
  }

  // ========== 系統訊息對話管理方法 ==========

  /**
   * 取得或建立私人對話
   */
  async getOrCreatePrivateConversation(params: {
    userId1: string;
    userId2: string;
  }): Promise<{
    conversationId: string;
    isNewConversation: boolean;
    conversation: any;
  }> {
    try {
      const user1ObjectId = new Types.ObjectId(params.userId1);
      const user2ObjectId = new Types.ObjectId(params.userId2);

      // 查詢現有對話（私人對話，恰好兩個參與者，排除已刪除的）
      let conversation = await this.conversationModel.findOne({
        type: 'private',
        participants: {
          $all: [user1ObjectId, user2ObjectId],
          $size: 2
        },
        isDeleted: { $ne: true }  // 過濾已刪除的對話（向後兼容沒有此欄位的文檔）
      }).populate('participants', 'username profilePicture');

      // 如果對話已存在，直接返回
      if (conversation) {
        this.logger.log(`Found existing conversation: ${conversation._id}`);
        return {
          conversationId: (conversation._id as Types.ObjectId).toString(),
          isNewConversation: false,
          conversation: {
            id: (conversation._id as Types.ObjectId).toString(),
            name: conversation.name,
            type: conversation.type,
            participants: (conversation.participants as any[]).map((p: any) => ({
              id: p._id.toString(),
              username: p.username,
              profilePicture: p.profilePicture
            })),
            createdAt: conversation.createdAt,
            lastMessageAt: conversation.lastMessageAt
          }
        };
      }

      // 建立新對話
      this.logger.log('Creating new private conversation');
      conversation = await this.conversationModel.create({
        type: 'private',
        participants: [user1ObjectId, user2ObjectId],
        name: '',
        lastMessageAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // 為兩個參與者建立 ConversationState
      await this.conversationStateModel.insertMany([
        {
          user_id: user1ObjectId,
          conversation_id: conversation._id,
          unread_count: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          user_id: user2ObjectId,
          conversation_id: conversation._id,
          unread_count: 0,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ]);

      // Populate participants
      await conversation.populate('participants', 'username profilePicture');

      this.logger.log(`Created new conversation: ${conversation._id}`);

      return {
        conversationId: (conversation._id as Types.ObjectId).toString(),
        isNewConversation: true,
        conversation: {
          id: (conversation._id as Types.ObjectId).toString(),
          name: conversation.name,
          type: conversation.type,
          participants: (conversation.participants as any[]).map((p: any) => ({
            id: p._id.toString(),
            username: p.username,
            profilePicture: p.profilePicture
          })),
          createdAt: conversation.createdAt,
          lastMessageAt: conversation.lastMessageAt
        }
      };
    } catch (error) {
      this.logger.error('Error in getOrCreatePrivateConversation:', error);
      throw error;
    }
  }

  /**
   * 將使用者加入對話（群組）
   */
  async addUserToConversation(params: {
    userId: string;
    conversationId: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      const userObjectId = new Types.ObjectId(params.userId);
      const conversationObjectId = new Types.ObjectId(params.conversationId);

      // 檢查對話是否存在
      const conversation = await this.conversationModel.findById(conversationObjectId);
      if (!conversation) {
        return {
          success: false,
          message: 'Conversation not found'
        };
      }

      // 檢查是否為群組對話
      if (conversation.type === 'private') {
        return {
          success: false,
          message: 'Cannot add user to private conversation'
        };
      }

      // 檢查使用者是否已在對話中
      const isAlreadyParticipant = conversation.participants.some(
        p => p.toString() === userObjectId.toString()
      );

      if (isAlreadyParticipant) {
        return {
          success: true,
          message: 'User is already in the conversation'
        };
      }

      // 將使用者加入參與者列表
      conversation.participants.push(userObjectId);
      await conversation.save();

      // 建立 ConversationState
      await this.conversationStateModel.create({
        user_id: userObjectId,
        conversation_id: conversationObjectId,
        unread_count: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      this.logger.log(`Added user ${params.userId} to conversation ${params.conversationId}`);

      return {
        success: true,
        message: 'User added to conversation successfully'
      };
    } catch (error) {
      this.logger.error('Error adding user to conversation:', error);
      return {
        success: false,
        message: 'Failed to add user to conversation'
      };
    }
  }

  // ========== 聊天室管理方法 ==========

  /**
   * 刪除聊天室（軟刪除）
   */
  async deleteConversation(params: {
    conversationId: string;
    operatorId: string;
  }): Promise<{ success: boolean; message: string; deletedAt?: string }> {
    try {
      const conversationObjectId = new Types.ObjectId(params.conversationId);
      const operatorObjectId = new Types.ObjectId(params.operatorId);

      // 查找對話（確保未被刪除）
      const conversation = await this.conversationModel.findOne({
        _id: conversationObjectId,
        isDeleted: { $ne: true }  // 向後兼容沒有此欄位的文檔
      });

      if (!conversation) {
        return {
          success: false,
          message: 'Conversation not found or already deleted'
        };
      }

      // 驗證操作者在聊天室中
      const isParticipant = conversation.participants.some(
        p => p.toString() === operatorObjectId.toString()
      );

      if (!isParticipant) {
        return {
          success: false,
          message: 'You are not a member of this conversation'
        };
      }

      // 標記為已刪除
      const now = new Date();
      conversation.isDeleted = true;
      conversation.deletedAt = now;
      conversation.deletedBy = operatorObjectId;
      conversation.updatedAt = now;
      await conversation.save();

      this.logger.log(`Conversation ${params.conversationId} deleted by user ${params.operatorId}`);

      return {
        success: true,
        message: 'Conversation deleted successfully',
        deletedAt: now.toISOString()
      };
    } catch (error) {
      this.logger.error('Error deleting conversation:', error);
      return {
        success: false,
        message: 'Failed to delete conversation'
      };
    }
  }

  /**
   * 更改聊天室名稱
   */
  async updateConversationName(params: {
    conversationId: string;
    name: string;
    operatorId: string;
  }): Promise<{ success: boolean; message: string; newName?: string }> {
    try {
      const conversationObjectId = new Types.ObjectId(params.conversationId);
      const operatorObjectId = new Types.ObjectId(params.operatorId);

      // 驗證名稱格式
      const trimmedName = params.name.trim();
      if (trimmedName.length === 0 || trimmedName.length > 50) {
        return {
          success: false,
          message: 'Name length must be between 1-50 characters'
        };
      }

      // 查找對話（確保未被刪除）
      const conversation = await this.conversationModel.findOne({
        _id: conversationObjectId,
        isDeleted: { $ne: true }  // 向後兼容沒有此欄位的文檔
      });

      if (!conversation) {
        return {
          success: false,
          message: 'Conversation not found'
        };
      }

      // 驗證是群聊
      if (conversation.type !== 'group') {
        return {
          success: false,
          message: 'Cannot rename private conversations'
        };
      }

      // 驗證操作者在聊天室中
      const isParticipant = conversation.participants.some(
        p => p.toString() === operatorObjectId.toString()
      );

      if (!isParticipant) {
        return {
          success: false,
          message: 'You are not a member of this conversation'
        };
      }

      // 更新名稱
      conversation.name = trimmedName;
      conversation.updatedAt = new Date();
      await conversation.save();

      this.logger.log(`Conversation ${params.conversationId} renamed to "${trimmedName}" by user ${params.operatorId}`);

      return {
        success: true,
        message: 'Conversation name updated successfully',
        newName: trimmedName
      };
    } catch (error) {
      this.logger.error('Error updating conversation name:', error);
      return {
        success: false,
        message: 'Failed to update conversation name'
      };
    }
  }

  /**
   * 批次新增成員到聊天室
   */
  async addUsersToConversation(params: {
    conversationId: string;
    userIds: string[];
    operatorId: string;
  }): Promise<{ success: boolean; message: string; addedUserIds?: string[]; addedCount?: number }> {
    try {
      const conversationObjectId = new Types.ObjectId(params.conversationId);
      const operatorObjectId = new Types.ObjectId(params.operatorId);

      // 查找對話（確保未被刪除）
      const conversation = await this.conversationModel.findOne({
        _id: conversationObjectId,
        isDeleted: { $ne: true }  // 向後兼容沒有此欄位的文檔
      });

      if (!conversation) {
        return {
          success: false,
          message: 'Conversation not found'
        };
      }

      // 驗證是群聊
      if (conversation.type !== 'group') {
        return {
          success: false,
          message: 'Cannot add members to private conversations'
        };
      }

      // 驗證操作者在聊天室中
      const isParticipant = conversation.participants.some(
        p => p.toString() === operatorObjectId.toString()
      );

      if (!isParticipant) {
        return {
          success: false,
          message: 'You are not a member of this conversation'
        };
      }

      // 過濾已存在的成員
      const newUserIds = params.userIds.filter(userId => {
        const userObjectId = new Types.ObjectId(userId);
        return !conversation.participants.some(p => p.toString() === userObjectId.toString());
      });

      if (newUserIds.length === 0) {
        return {
          success: true,
          message: 'All users are already in the conversation',
          addedUserIds: [],
          addedCount: 0
        };
      }

      // 將新成員加入 participants
      const newUserObjectIds = newUserIds.map(id => new Types.ObjectId(id));
      conversation.participants.push(...newUserObjectIds);
      conversation.updatedAt = new Date();
      await conversation.save();

      // 為每個新成員建立 ConversationState
      const now = new Date();
      await this.conversationStateModel.insertMany(
        newUserObjectIds.map(userId => ({
          user_id: userId,
          conversation_id: conversationObjectId,
          unread_count: 0,
          createdAt: now,
          updatedAt: now
        }))
      );

      this.logger.log(`Added ${newUserIds.length} users to conversation ${params.conversationId}`);

      return {
        success: true,
        message: `Successfully added ${newUserIds.length} user(s) to conversation`,
        addedUserIds: newUserIds,
        addedCount: newUserIds.length
      };
    } catch (error) {
      this.logger.error('Error adding users to conversation:', error);
      return {
        success: false,
        message: 'Failed to add users to conversation'
      };
    }
  }

  /**
   * 移除聊天室成員
   */
  async removeUserFromConversation(params: {
    conversationId: string;
    userIdToRemove: string;
    operatorId: string;
  }): Promise<{ success: boolean; message: string; removedUserId?: string; conversationDeleted?: boolean }> {
    try {
      const conversationObjectId = new Types.ObjectId(params.conversationId);
      const userToRemoveObjectId = new Types.ObjectId(params.userIdToRemove);
      const operatorObjectId = new Types.ObjectId(params.operatorId);

      // 查找對話（確保未被刪除）
      const conversation = await this.conversationModel.findOne({
        _id: conversationObjectId,
        isDeleted: { $ne: true }  // 向後兼容沒有此欄位的文檔
      });

      if (!conversation) {
        return {
          success: false,
          message: 'Conversation not found'
        };
      }

      // 驗證是群聊
      if (conversation.type !== 'group') {
        return {
          success: false,
          message: 'Cannot remove members from private conversations'
        };
      }

      // 驗證操作者在聊天室中
      const isOperatorParticipant = conversation.participants.some(
        p => p.toString() === operatorObjectId.toString()
      );

      if (!isOperatorParticipant) {
        return {
          success: false,
          message: 'You are not a member of this conversation'
        };
      }

      // 驗證目標用戶在聊天室中
      const isTargetParticipant = conversation.participants.some(
        p => p.toString() === userToRemoveObjectId.toString()
      );

      if (!isTargetParticipant) {
        return {
          success: false,
          message: 'User is not in this conversation'
        };
      }

      // 從 participants 陣列移除
      conversation.participants = conversation.participants.filter(
        p => p.toString() !== userToRemoveObjectId.toString()
      );

      // 檢查是否是最後一個成員退出
      let conversationDeleted = false;
      const now = new Date();

      if (conversation.participants.length === 0) {
        // 最後一個成員退出，自動軟刪除聊天室
        conversation.isDeleted = true;
        conversation.deletedAt = now;
        conversation.deletedBy = operatorObjectId;
        conversationDeleted = true;
        this.logger.log(`Last member removed, conversation ${params.conversationId} auto-deleted`);
      }

      conversation.updatedAt = now;
      await conversation.save();

      // 清理被移除者的 ConversationState
      await this.conversationStateModel.deleteOne({
        user_id: userToRemoveObjectId,
        conversation_id: conversationObjectId
      });

      this.logger.log(`User ${params.userIdToRemove} removed from conversation ${params.conversationId} by ${params.operatorId}`);

      return {
        success: true,
        message: conversationDeleted
          ? 'User removed and conversation deleted (last member)'
          : 'User removed from conversation successfully',
        removedUserId: params.userIdToRemove,
        conversationDeleted
      };
    } catch (error) {
      this.logger.error('Error removing user from conversation:', error);
      return {
        success: false,
        message: 'Failed to remove user from conversation'
      };
    }
  }
} 