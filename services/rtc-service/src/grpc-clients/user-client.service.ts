import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

interface UserInfo {
  id: string;
  username: string;
  profilePicture?: string;
}

@Injectable()
export class UserClientService implements OnModuleInit {
  private readonly logger = new Logger(UserClientService.name);
  private userService: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const PROTO_PATH = join(__dirname, '../../protos/user.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const userProto: any = grpc.loadPackageDefinition(packageDefinition).user;

    const USER_SERVICE_URL = this.configService.get<string>('USER_SERVICE_URL');
    const USER_SERVICE_PORT = this.configService.get<string>('USER_SERVICE_PORT');

    // 檢查 URL 是否已包含端口，避免重複
    const serviceAddress = USER_SERVICE_URL?.includes(':')
      ? USER_SERVICE_URL
      : `${USER_SERVICE_URL}:${USER_SERVICE_PORT}`;

    this.userService = new userProto.UserService(
      serviceAddress,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 200 * 1024 * 1024,
        'grpc.max_send_message_length': 200 * 1024 * 1024,
      },
    );

    this.logger.log(
      `✅ User gRPC client connected to ${serviceAddress}`,
    );
  }

  /**
   * 獲取用戶資訊（假設 User Service 有這個方法，如果沒有可以跳過）
   */
  async getUserInfo(userId: string): Promise<UserInfo | null> {
    return new Promise((resolve, reject) => {
      // 注意：這個方法需要在 user.proto 中定義，如果沒有可以註釋掉
      if (!this.userService.GetUserInfo) {
        // 如果 User Service 沒有提供此方法，返回基本資訊
        resolve({
          id: userId,
          username: 'User',
        });
        return;
      }

      this.userService.GetUserInfo(
        { user_id: userId },
        (error: any, response: any) => {
          if (error) {
            this.logger.warn(`GetUserInfo gRPC error for ${userId}:`, error.message);
            // 返回默認值
            resolve({
              id: userId,
              username: 'User',
            });
          } else {
            resolve(response);
          }
        },
      );
    });
  }

  /**
   * 批次獲取用戶資訊
   */
  async batchGetUsers(userIds: string[]): Promise<Map<string, string>> {
    const userMap = new Map<string, string>();

    // 如果沒有批次獲取方法，逐一獲取
    for (const userId of userIds) {
      try {
        const userInfo = await this.getUserInfo(userId);
        if (userInfo) {
          userMap.set(userId, userInfo.username);
        }
      } catch (error) {
        this.logger.warn(`Failed to get user info for ${userId}`);
        userMap.set(userId, 'Unknown User');
      }
    }

    return userMap;
  }
}
