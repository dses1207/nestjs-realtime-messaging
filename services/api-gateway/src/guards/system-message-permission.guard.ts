import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Inject, Logger } from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

interface ChatServiceClient {
  checkSystemMessagePermission(data: { userId: string }): any;
}

@Injectable()
export class SystemMessagePermissionGuard implements CanActivate {
  private readonly logger = new Logger(SystemMessagePermissionGuard.name);
  private chatService: ChatServiceClient;

  constructor(
    @Inject('CHAT_SERVICE') private chatClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.chatService = this.chatClient.getService<ChatServiceClient>('ChatService');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    // 取得當前使用者（JWT 已驗證）
    const user = request.user;

    if (!user || !user.userId) {
      this.logger.warn('User not authenticated');
      throw new ForbiddenException('User not authenticated');
    }

    // 檢查使用者是否有權限
    try {
      this.logger.log(`Checking system message permission for user: ${user.userId}`);
      const result = await firstValueFrom(
        this.chatService.checkSystemMessagePermission({
          userId: user.userId
        })
      ) as {
        hasPermission: boolean;
      };

      if (!result.hasPermission) {
        this.logger.warn(`User ${user.userId} (${user.username}) does not have system message permission`);
        throw new ForbiddenException('You do not have permission to send system messages');
      }

      this.logger.log(`Permission check passed for user: ${user.userId} (${user.username})`);
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      this.logger.error('Failed to check permission:', error);
      throw new ForbiddenException('Failed to check permission');
    }
  }
}
