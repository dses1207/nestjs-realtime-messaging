export interface NotificationPayload {
  title: string;
  body: string;
  messageType?: 'text' | 'file' | 'image' | 'document' | 'audio' | 'video';
  data?: Record<string, string>;

  // ===== 通知分組 =====
  threadId?: string;               // iOS thread ID (通知分組，僅分組不替換)

  // ===== iOS 15+ 新特性 (2021年引入) =====
  interruptionLevel?: 'passive' | 'active' | 'time-sensitive' | 'critical'; // 中斷等級
  relevanceScore?: number;         // 0.0-1.0，通知摘要排序分數
  mutableContent?: boolean;        // 允許 Notification Service Extension 修改內容

  // ===== 通知生命週期控制 =====
  expirationTimestamp?: number;    // Unix timestamp，通知過期時間

  // ===== iOS 16.1+ Live Activities =====
  targetContentId?: string;        // Live Activity 更新目標
  dismissalDate?: number;          // 自動關閉時間 (Unix timestamp)

  // ===== 進階功能 =====
  category?: string;               // 通知類別（快速回覆、自訂動作等）
  urlArgs?: string[];              // Safari 推播參數
}

export interface FCMResponse {
  messageId?: string;
  error?: any;
  token?: string; // 對應的設備 token，用於識別失效的 token
}

export interface APNsResponse {
  sent: boolean;
  messageId?: string;
  error?: {
    code?: string;
    message?: string;
    status?: number;       // APNs HTTP 狀態碼 (400, 410, 等)
    reason?: string;       // APNs 錯誤原因 (BadDeviceToken, Unregistered, 等)
  };
  token?: string;          // 對應的設備 token，用於識別失效的 token

  // ===== 傳送詳情 (用於日誌和追蹤) =====
  timestamp?: string;      // 傳送時間
  interruptionLevel?: string;  // 實際使用的中斷等級
  relevanceScore?: number; // 實際使用的相關性分數
  priority?: number;       // 實際使用的優先級 (5 或 10)
  environment?: 'development' | 'production'; // 實際使用的環境（用於追蹤和除錯）
}