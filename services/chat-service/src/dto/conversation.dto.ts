export interface ConversationResponseDto {
  id: string;
  name: string;
  type: string;
  participants: {
    id: string;
    username: string;
    profilePicture?: string;
  }[];
  lastMessage?: {
    content: string;
    timestamp: Date;
    senderName: string;
  };
  lastMessageAt: Date;
  createdAt: Date;
  updatedAt: Date;
  group_picture?: string;

  // 已讀系統欄位
  unread_count?: number;              // 未讀訊息數
  last_read_message_id?: string;      // 最後已讀訊息 ID（客戶端用來判斷）
}

export interface MessageResponseDto {
  id: string;
  content: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderProfilePicture?: string;
  timestamp: Date;

  // 新增欄位：訊息類型
  messageType: string;

  // 新增欄位：檔案相關資訊 (僅檔案訊息時存在)
  fileInfo?: {
    fileId: string;
    originalName: string;
    fileSize: number;
    contentType: string;
    downloadUrl: string;    // 統一代理URL: /api/files/{fileId}/download
    previewUrl?: string;    // 預覽URL: /api/files/{fileId}/preview
  };

  // 已讀系統欄位
  read_count: number;         // 已讀數量
}

export interface ReadReceiptDto {
  user_id: string;
  username: string;
  profile_picture?: string;
  read_at: Date;
} 