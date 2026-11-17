export interface SendNotificationDto {
  userId: string;
  type: 'new_message' | 'group_invite' | 'group_message';
  title: string;
  body: string;
  messageType?: 'text' | 'file' | 'image' | 'document' | 'audio' | 'video';
  data?: Record<string, string>;
}

export interface RegisterDeviceTokenDto {
  userId: string;
  token: string;
  platform: 'fcm' | 'apns';
  deviceId: string;  // 必填欄位
  appVersion?: string;
  environment?: 'development' | 'production';
}

export interface UpdateNotificationSettingsDto {
  userId: string;
  newMessage?: boolean;
  groupInvite?: boolean;
  groupMessage?: boolean;
}

export interface NotificationResponseDto {
  success: boolean;
  message: string;
  data?: any;
}