import { Socket } from 'socket.io';

export interface MessagePayload {
  content: string;
  conversationId: string;
  senderId?: string;
  senderName?: string;
  senderProfilePicture?: string;
  timestamp?: string;
  messageType?: string;
  fileInfo?: {
    fileId: string;
    originalName: string;
    fileSize: number;
    contentType: string;
    downloadUrl: string;
    previewUrl?: string;
  };
}

export interface BroadcastMessagePayload extends MessagePayload {
  messageId: string;
  senderId: string;
  read_count: number;  // 已讀數量
}

// Token-based WebSocket連線介面
export interface AuthenticatedSocket extends Socket {
  userId: string;
  tokenId: string;  // JWT的jti (unique identifier)
  deviceInfo: DeviceInfo;
  authenticatedAt: Date;
}

export interface DeviceInfo {
  type: 'web' | 'ios' | 'android' | 'unknown';
  userAgent?: string;
  ipAddress?: string;
  fcmToken?: string;  // 用於推播通知
}

export interface JWTPayload {
  sub: string;     // userId
  jti: string;     // token unique identifier
  aud: string;     // audience
  exp: number;     // expiration
  iat: number;     // issued at
  device?: {       // 可選設備資訊
    type: 'web' | 'ios' | 'android';
    userAgent?: string;
    fcmToken?: string;  // 用於推播
  };
} 