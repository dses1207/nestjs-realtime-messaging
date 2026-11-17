import { Injectable, OnModuleInit } from '@nestjs/common';
import { ClientGrpc, Client, Transport } from '@nestjs/microservices';
import { Observable } from 'rxjs';

// User Service Interface
interface UserService {
  register(data: { email: string; username: string; password: string; name?: string }): Observable<any>;
  login(data: { emailOrUsername: string; password: string }): Observable<any>;
  validateToken(data: { token: string }): Observable<any>;
  getAllUsers(data: {}): Observable<any>;
  getAllUsernames(data: {}): Observable<any>;
  getUserByUsername(data: { username: string }): Observable<any>;
  getUserById(data: { userId: string }): Observable<any>;
  updateUser(data: { userId: string; email?: string; name?: string; username?: string; profilePicture?: string; status?: string }): Observable<any>;
}

// Chat Service Interface
interface ChatService {
  getUserConversations(data: { userId: string }): Observable<any>;
  getConversationMessages(data: { conversationId: string; userId: string; limit?: number; before?: string; after?: string; }): Observable<any>;
  saveMessage(data: {
    content: string;
    conversationId: string;
    senderId: string;
    messageType?: string;
    fileId?: string;
    fileInfo?: { originalName?: string; fileSize?: number; contentType?: string };
  }): Observable<any>;
  createChatRoom(data: { memberIds: string[]; name?: string; createdBy: string }): Observable<any>;

  // 聊天室管理方法
  removeUserFromConversation(data: {
    conversationId: string;
    userIdToRemove: string;
    operatorId: string;
  }): Observable<any>;
  addUsersToConversation(data: {
    conversationId: string;
    userIds: string[];
    operatorId: string;
  }): Observable<any>;
  deleteConversation(data: {
    conversationId: string;
    operatorId: string;
  }): Observable<any>;
  updateConversationName(data: {
    conversationId: string;
    name: string;
    operatorId: string;
  }): Observable<any>;
}

// File Service Interface
interface FileService {
  // 統一預簽名 URL 檔案上傳 API
  requestUpload(data: {
    filename: string;
    fileSize: number;
    contentType: string;
    uploaderId: string;
    conversationId?: string;
    messageId?: string;
    category?: string;
  }): Observable<any>;
  confirmUpload(data: {
    fileId: string;
    uploaderId: string;
  }): Observable<any>;
  
  // 保留向後相容
  uploadSecureFile(data: {
    filename: string;
    data: Buffer;
    contentType: string;
    uploaderId: string;
    conversationId?: string;
    messageId?: string;
    category?: string;
  }): Observable<any>;
  getSecureFile(data: {
    fileId: string;
    userId: string;
  }): Observable<any>;
  checkFilePermission(data: {
    fileId: string;
    userId: string;
  }): Observable<any>;
  getFileInfo(data: {
    fileId: string;
  }): Observable<any>;
  
  // 新增：代理下載 API
  downloadFile(data: {
    fileId: string;
    userId: string;
    preview?: boolean;
  }): Observable<any>;
  
  // 保留向後相容 API
  updateProfilePicture(data: { username: string; imageUrl: string }): Observable<any>;
  getPhoto(data: { filename: string }): Observable<any>;
  getImage(data: { filename: string }): Observable<any>;
}

// Notification Service Interface
interface NotificationService {
  sendNotification(data: { userId: string; type: string; title: string; body: string; data?: string }): Observable<any>;
  registerDeviceToken(data: { userId: string; token: string; platform: string; deviceId: string; appVersion: string; environment?: string }): Observable<any>;
  updateNotificationSettings(data: { userId: string; newMessage?: boolean; groupInvite?: boolean; groupMessage?: boolean }): Observable<any>;
  getNotificationSettings(data: { userId: string }): Observable<any>;
  removeDeviceToken(data: { userId: string; token: string }): Observable<any>;
  getNotificationHistory(data: {
    userId: string;
    limit?: number;
    offset?: number;
    type?: string;
    startDate?: string;
    endDate?: string;
  }): Observable<any>;
}

@Injectable()
export class GrpcClientService implements OnModuleInit {
  @Client({
    transport: Transport.GRPC,
    options: {
      package: 'user',
      protoPath: '/app/protos/user.proto',
      url: 'user-service:50052',
    },
  })
  private userClient: ClientGrpc;

  @Client({
    transport: Transport.GRPC,
    options: {
      package: 'chat',
      protoPath: '/app/protos/chat.proto',
      url: 'chat-service:50053',
    },
  })
  private chatClient: ClientGrpc;

  @Client({
    transport: Transport.GRPC,
    options: {
      package: 'file',
      protoPath: '/app/protos/file.proto',
      url: 'file-service:50055',
      channelOptions: {
        'grpc.max_send_message_length': 200 * 1024 * 1024,
        'grpc.max_receive_message_length': 200 * 1024 * 1024,
      },
    },
  })
  private fileClient: ClientGrpc;

  @Client({
    transport: Transport.GRPC,
    options: {
      package: 'notification',
      protoPath: '/app/protos/notification.proto',
      url: 'notification-service:50056',
    },
  })
  private notificationClient: ClientGrpc;

  private userService: UserService;
  private chatService: ChatService;
  private fileService: FileService;
  private notificationService: NotificationService;

  onModuleInit() {
    this.userService = this.userClient.getService<UserService>('UserService');
    this.chatService = this.chatClient.getService<ChatService>('ChatService');
    this.fileService = this.fileClient.getService<FileService>('FileService');
    this.notificationService = this.notificationClient.getService<NotificationService>('NotificationService');
  }

  validateToken(data: { token: string }) {
    return this.userService.validateToken(data);
  }

  // User Service Methods
  getAllUsers() {
    return this.userService.getAllUsers({});
  }

  getAllUsernames() {
    return this.userService.getAllUsernames({});
  }

  getUserByUsername(data: { username: string }) {
    return this.userService.getUserByUsername(data);
  }

  getUserById(data: { userId: string }) {
    return this.userService.getUserById(data);
  }

  updateUser(data: { userId: string; email?: string; name?: string; username?: string; profilePicture?: string; status?: string }) {
    return this.userService.updateUser(data);
  }

  // Chat Service Methods
  getUserConversations(data: { userId: string }) {
    return this.chatService.getUserConversations(data);
  }

  getConversationMessages(data: { conversationId: string; userId: string; limit?: number; before?: string; after?: string; }) {
    return this.chatService.getConversationMessages(data);
  }

  saveMessage(data: { 
    content: string; 
    conversationId: string; 
    senderId: string;
    messageType?: string;
    fileId?: string;
    fileInfo?: { originalName?: string; fileSize?: number; contentType?: string };
  }) {
    return this.chatService.saveMessage(data);
  }

  createChatRoom(data: { memberIds: string[]; name?: string; createdBy: string }) {
    return this.chatService.createChatRoom(data);
  }

  // 聊天室管理方法
  removeUserFromConversation(data: { conversationId: string; userIdToRemove: string; operatorId: string }) {
    return this.chatService.removeUserFromConversation(data);
  }

  addUsersToConversation(data: { conversationId: string; userIds: string[]; operatorId: string }) {
    return this.chatService.addUsersToConversation(data);
  }

  deleteConversation(data: { conversationId: string; operatorId: string }) {
    return this.chatService.deleteConversation(data);
  }

  updateConversationName(data: { conversationId: string; name: string; operatorId: string }) {
    return this.chatService.updateConversationName(data);
  }

  // File Service Methods - 統一預簽名 URL API
  requestUpload(data: {
    filename: string;
    fileSize: number;
    contentType: string;
    uploaderId: string;
    conversationId?: string;
    messageId?: string;
    category?: string;
  }) {
    return this.fileService.requestUpload(data);
  }

  confirmUpload(data: {
    fileId: string;
    uploaderId: string;
  }) {
    return this.fileService.confirmUpload(data);
  }

  // 保留向後相容
  uploadSecureFile(data: {
    filename: string;
    data: Buffer;
    contentType: string;
    uploaderId: string;
    conversationId?: string;
    messageId?: string;
    category?: string;
  }) {
    return this.fileService.uploadSecureFile(data);
  }

  getSecureFile(data: {
    fileId: string;
    userId: string;
  }) {
    return this.fileService.getSecureFile(data);
  }

  checkFilePermission(data: {
    fileId: string;
    userId: string;
  }) {
    return this.fileService.checkFilePermission(data);
  }

  getFileInfo(data: {
    fileId: string;
  }) {
    return this.fileService.getFileInfo(data);
  }

  // 新增：代理下載方法
  downloadFile(data: {
    fileId: string;
    userId: string;
    preview?: boolean;
  }) {
    return this.fileService.downloadFile(data);
  }

  // 保留向後相容方法
  updateProfilePicture(data: { username: string; imageUrl: string }) {
    return this.fileService.updateProfilePicture(data);
  }

  getPhoto(data: { filename: string }) {
    return this.fileService.getPhoto(data);
  }

  getImage(data: { filename: string }) {
    return this.fileService.getImage(data);
  }

  // Notification Service Methods
  sendNotification(data: { userId: string; type: string; title: string; body: string; data?: string }) {
    return this.notificationService.sendNotification(data);
  }

  registerDeviceToken(data: { userId: string; token: string; platform: string; deviceId: string; appVersion: string; environment?: string }) {
    return this.notificationService.registerDeviceToken(data);
  }

  updateNotificationSettings(data: { userId: string; newMessage?: boolean; groupInvite?: boolean; groupMessage?: boolean }) {
    return this.notificationService.updateNotificationSettings(data);
  }

  getNotificationSettings(data: { userId: string }) {
    return this.notificationService.getNotificationSettings(data);
  }

  removeDeviceToken(data: { userId: string; token: string }) {
    return this.notificationService.removeDeviceToken(data);
  }

  getNotificationHistory(data: { 
    userId: string; 
    limit?: number; 
    offset?: number; 
    type?: string; 
    startDate?: string; 
    endDate?: string; 
  }) {
    return this.notificationService.getNotificationHistory(data);
  }

  // Auth Methods (via User Service)
  register(data: { email: string; username: string; password: string; name?: string }) {
    return this.userService.register(data);
  }

  login(data: { emailOrUsername: string; password: string }) {
    return this.userService.login(data);
  }
} 