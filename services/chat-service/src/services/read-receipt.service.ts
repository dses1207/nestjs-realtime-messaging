import { Injectable, Logger } from '@nestjs/common';
import { InjectModel, InjectConnection } from '@nestjs/mongoose';
import { Model, Types, Connection } from 'mongoose';
import { ReadReceipt, ReadReceiptDocument } from '../schemas/read-receipt.schema';
import { ConversationState, ConversationStateDocument } from '../schemas/conversation-state.schema';
import { Message, MessageDocument } from '../schemas/message.schema';
import { User, UserDocument } from '../schemas/user.schema';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';

export interface ReadReceiptDto {
  user_id: string;
  username: string;
  profile_picture?: string;
  read_at: Date;
}

@Injectable()
export class ReadReceiptService {
  private readonly logger = new Logger(ReadReceiptService.name);

  constructor(
    @InjectModel(ReadReceipt.name) private readReceiptModel: Model<ReadReceiptDocument>,
    @InjectModel(ConversationState.name) private conversationStateModel: Model<ConversationStateDocument>,
    @InjectModel(Message.name) private messageModel: Model<MessageDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Conversation.name) private conversationModel: Model<ConversationDocument>,
    @InjectConnection() private connection: Connection,
  ) {}

  /**
   * 標記訊息為已讀（核心方法）
   *
   * 工作流程：
   * 1. 查詢 conversation_states 找出上次進度
   * 2. 找出新讀的訊息範圍
   * 3. 批次更新 messages.read_count ($inc +1)
   * 4. 批次 INSERT read_receipts
   * 5. 更新 conversation_states (unread_count = 0, last_read_message_id)
   */
  async markMessagesAsRead(
    userId: string,
    conversationId: string,
    lastReadMessageId: string,
  ): Promise<{
    success: boolean;
    affectedMessageIds: string[];
    newlyReadCount: number;
  }> {
    // 驗證 ObjectId 格式
    if (!Types.ObjectId.isValid(userId)) {
      this.logger.error(`Invalid userId format: ${userId}`);
      throw new Error(`無效的用戶 ID 格式: ${userId}`);
    }

    if (!Types.ObjectId.isValid(conversationId)) {
      this.logger.error(`Invalid conversationId format: ${conversationId}`);
      throw new Error(`無效的對話 ID 格式: ${conversationId}`);
    }

    if (!Types.ObjectId.isValid(lastReadMessageId)) {
      this.logger.error(`Invalid lastReadMessageId format: ${lastReadMessageId}`);
      throw new Error(`無效的訊息 ID 格式: ${lastReadMessageId}`);
    }

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const userObjectId = new Types.ObjectId(userId);
      const conversationObjectId = new Types.ObjectId(conversationId);
      const lastReadObjectId = new Types.ObjectId(lastReadMessageId);

      // 記錄詳細資訊
      this.logger.log(
        `[markMessagesAsRead] 📥 收到標記已讀請求 - User: ${userId}, Conversation: ${conversationId}, LastMessage: ${lastReadMessageId}`,
      );

      // 1. 查詢 conversation_states 找出上次進度
      const state = await this.conversationStateModel
        .findOne({
          user_id: userObjectId,
          conversation_id: conversationObjectId,
        })
        .session(session);

      const previousLastReadId = state?.last_read_message_id;

      this.logger.log(
        `[markMessagesAsRead] 📍 查詢進度 - previousLastReadId: ${previousLastReadId || 'null (第一次標記)'}, ` +
        `lastReadMessageId: ${lastReadMessageId}`,
      );

      // 檢查請求是否過期（樂觀鎖）
      if (previousLastReadId && previousLastReadId >= lastReadObjectId) {
        this.logger.warn(
          `[markMessagesAsRead] ⚠️  忽略過期請求 (樂觀鎖) - 當前進度: ${previousLastReadId}, 請求進度: ${lastReadObjectId}`,
        );
        await session.abortTransaction();
        return { success: true, affectedMessageIds: [], newlyReadCount: 0 };
      }

      // 2. 找出新讀的訊息範圍
      const query: any = {
        conversationId: conversationObjectId,
        senderId: { $ne: userObjectId }, // 排除自己發送的訊息
      };

      if (previousLastReadId) {
        // 只標記 previousLastReadId 之後的訊息
        query._id = {
          $gt: previousLastReadId,
          $lte: lastReadObjectId,
        };
        this.logger.log(
          `[markMessagesAsRead] 🔍 查詢條件 (增量式): ${previousLastReadId} < _id <= ${lastReadMessageId}`,
        );
      } else {
        // 第一次讀取，標記所有到 lastReadMessageId 的訊息
        query._id = { $lte: lastReadObjectId };
        this.logger.log(
          `[markMessagesAsRead] 🔍 查詢條件 (第一次): _id <= ${lastReadMessageId}`,
        );
      }

      const newlyReadMessages = await this.messageModel
        .find(query)
        .session(session)
        .exec();

      this.logger.log(
        `[markMessagesAsRead] 📨 查到 ${newlyReadMessages.length} 則新訊息`,
      );

      if (newlyReadMessages.length === 0) {
        this.logger.log(
          `[markMessagesAsRead] ℹ️  沒有新訊息需要標記，返回空結果`,
        );
        await session.commitTransaction();
        return { success: true, affectedMessageIds: [], newlyReadCount: 0 };
      }

      // 3. 批次更新 messages.read_count ($inc +1)
      const messageIds = newlyReadMessages.map((m) => m._id);
      await this.messageModel
        .updateMany({ _id: { $in: messageIds } }, { $inc: { read_count: 1 } })
        .session(session);

      // 4. 批次 INSERT read_receipts（先查詢已存在的記錄,避免唯一索引衝突）
      // 查詢已存在的 read_receipts
      const existingReceipts = await this.readReceiptModel
        .find({
          message_id: { $in: messageIds },
          user_id: userObjectId,
        })
        .session(session)
        .select('message_id')
        .lean();

      const existingMessageIds = new Set(
        existingReceipts.map((r) => r.message_id.toString()),
      );

      // 只插入不存在的記錄
      const newReadReceipts = messageIds
        .filter((msgId: Types.ObjectId) => !existingMessageIds.has(msgId.toString()))
        .map((msgId: Types.ObjectId) => ({
          message_id: msgId,
          user_id: userObjectId,
          read_at: new Date(),
        }));

      if (newReadReceipts.length > 0) {
        await this.readReceiptModel.insertMany(newReadReceipts, { session });
      }

      // 5. 更新 conversation_states
      await this.conversationStateModel
        .findOneAndUpdate(
          { user_id: userObjectId, conversation_id: conversationObjectId },
          {
            $set: {
              unread_count: 0,
              last_read_message_id: lastReadObjectId,
              last_read_at: new Date(),
            },
          },
          { upsert: true, session },
        )
        .exec();

      await session.commitTransaction();

      const affectedMessageIdStrings = messageIds.map((id) => (id as Types.ObjectId).toString());
      const result = {
        success: true,
        affectedMessageIds: affectedMessageIdStrings,
        newlyReadCount: messageIds.length,
      };

      this.logger.log(
        `[markMessagesAsRead] ✅ 標記成功 - 共 ${result.newlyReadCount} 則訊息`,
      );
      this.logger.log(
        `[markMessagesAsRead] 📋 affectedMessageIds: [${affectedMessageIdStrings.slice(0, 10).join(', ')}${affectedMessageIdStrings.length > 10 ? '...' : ''}]`,
      );

      return result;
    } catch (error) {
      await session.abortTransaction();

      // 記錄詳細錯誤資訊
      this.logger.error('Failed to mark messages as read:', {
        error: error.message,
        stack: error.stack,
        userId,
        conversationId,
        lastReadMessageId,
      });

      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * 查詢已讀列表（點擊「已讀 5」時使用）
   */
  async getReadReceipts(
    messageId: string,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{
    receipts: ReadReceiptDto[];
    totalCount: number;
  }> {
    const messageObjectId = new Types.ObjectId(messageId);

    const [receipts, totalCount] = await Promise.all([
      this.readReceiptModel
        .find({ message_id: messageObjectId })
        .sort({ read_at: -1 })
        .skip(offset)
        .limit(limit)
        .populate('user_id', 'username profilePicture')
        .exec(),
      this.readReceiptModel.countDocuments({ message_id: messageObjectId }),
    ]);

    return {
      receipts: receipts.map((receipt) => {
        const user = receipt.user_id as any;
        return {
          user_id: user._id.toString(),
          username: user.username || 'Unknown User',
          profile_picture: user.profilePicture || '',
          read_at: receipt.read_at,
        };
      }),
      totalCount,
    };
  }

  /**
   * 查詢單一對話的未讀數
   */
  async getUnreadCount(userId: string, conversationId: string): Promise<number> {
    const userObjectId = new Types.ObjectId(userId);
    const conversationObjectId = new Types.ObjectId(conversationId);

    const state = await this.conversationStateModel
      .findOne({
        user_id: userObjectId,
        conversation_id: conversationObjectId,
      })
      .exec();

    return state?.unread_count || 0;
  }

  /**
   * 批量查詢所有對話的未讀數（對話列表使用）
   */
  async getAllUnreadCounts(userId: string): Promise<{
    counts: Array<{ conversationId: string; unreadCount: number }>;
    totalUnread: number;
  }> {
    const userObjectId = new Types.ObjectId(userId);

    const states = await this.conversationStateModel
      .find({ user_id: userObjectId })
      .exec();

    const counts = states.map((state) => ({
      conversationId: state.conversation_id.toString(),
      unreadCount: state.unread_count,
    }));

    const totalUnread = states.reduce((sum, state) => sum + state.unread_count, 0);

    return { counts, totalUnread };
  }

  /**
   * 新訊息到達時更新未讀數（內部方法）
   *
   * 當有新訊息時，更新所有參與者（除了發送者）的未讀數
   * 使用 upsert 確保即使 conversation_state 不存在也能自動創建
   */
  async incrementUnreadCount(conversationId: string, excludeUserId: string): Promise<void> {
    try {
      this.logger.log(`[incrementUnreadCount] 開始處理 - 對話: ${conversationId}, 排除用戶: ${excludeUserId}`);

      const conversationObjectId = new Types.ObjectId(conversationId);
      const excludeUserObjectId = new Types.ObjectId(excludeUserId);

      // 查詢對話的所有參與者
      const conversation = await this.conversationModel
        .findById(conversationObjectId)
        .select('participants')
        .lean()
        .exec();

      if (!conversation) {
        this.logger.error(`[incrementUnreadCount] 找不到對話: ${conversationId}`);
        throw new Error(`找不到對話: ${conversationId}`);
      }

      if (!conversation.participants || conversation.participants.length === 0) {
        this.logger.error(`[incrementUnreadCount] 對話 ${conversationId} 沒有參與者`);
        throw new Error(`對話 ${conversationId} 沒有參與者`);
      }

      this.logger.log(`[incrementUnreadCount] 找到 ${conversation.participants.length} 個參與者`);

      // 為每個參與者（除了發送者）更新或創建 conversation_state
      const bulkOps = conversation.participants
        .filter(participantId => {
          const isExcluded = participantId.toString() === excludeUserId;
          this.logger.log(`[incrementUnreadCount] 參與者 ${participantId}: ${isExcluded ? '跳過(發送者)' : '處理'}`);
          return !isExcluded;
        })
        .map(participantId => {
          // 確保 participantId 正確轉換為 ObjectId（先轉字串再轉 ObjectId）
          const participantObjectId = new Types.ObjectId(
            typeof participantId === 'string' ? participantId : participantId.toString()
          );

          return {
            updateOne: {
              filter: {
                conversation_id: conversationObjectId,
                user_id: participantObjectId,
              },
              update: {
                $inc: { unread_count: 1 },
                $setOnInsert: {
                  conversation_id: conversationObjectId,
                  user_id: participantObjectId,
                  last_read_message_id: null,
                  last_read_at: null,
                },
              },
              upsert: true,
            },
          };
        });

      if (bulkOps.length === 0) {
        this.logger.warn(`[incrementUnreadCount] 沒有需要更新的參與者 (可能對話只有發送者)`);
        return;
      }

      this.logger.log(`[incrementUnreadCount] 準備更新 ${bulkOps.length} 個參與者的未讀數`);

      const result = await this.conversationStateModel.bulkWrite(bulkOps);

      this.logger.log(
        `[incrementUnreadCount] ✅ 完成 - 匹配: ${result.matchedCount}, ` +
        `修改: ${result.modifiedCount}, 插入: ${result.upsertedCount}`
      );
    } catch (error) {
      this.logger.error(
        `[incrementUnreadCount] ❌ 失敗 - 對話: ${conversationId}, 錯誤: ${error.message}`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * 取得對話狀態（包含未讀數和最後已讀訊息 ID）
   */
  async getConversationState(
    userId: string,
    conversationId: string,
  ): Promise<{
    unreadCount: number;
    lastReadMessageId: string | null;
    lastReadAt: Date | null;
  }> {
    const userObjectId = new Types.ObjectId(userId);
    const conversationObjectId = new Types.ObjectId(conversationId);

    const state = await this.conversationStateModel
      .findOne({
        user_id: userObjectId,
        conversation_id: conversationObjectId,
      })
      .exec();

    return {
      unreadCount: state?.unread_count || 0,
      lastReadMessageId: state?.last_read_message_id?.toString() || null,
      lastReadAt: state?.last_read_at || null,
    };
  }
}
