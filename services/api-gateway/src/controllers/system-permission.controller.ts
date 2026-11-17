import {
  Controller,
  Post,
  Delete,
  Get,
  Body,
  Param,
  UseGuards,
  Logger,
  Inject,
  Request,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SystemMessagePermissionGuard } from '../guards/system-message-permission.guard';
import { GrantPermissionDto } from '../dto/grant-permission.dto';
import { firstValueFrom } from 'rxjs';

interface ChatServiceClient {
  grantSystemMessagePermission(data: any): any;
  revokeSystemMessagePermission(data: any): any;
  listSystemMessagePermissions(data: any): any;
}

interface UserServiceClient {
  getUserById(data: { userId: string }): any;
}

@Controller('api/system/permissions')
@UseGuards(JwtAuthGuard, SystemMessagePermissionGuard)
export class SystemPermissionController {
  private readonly logger = new Logger(SystemPermissionController.name);
  private chatService: ChatServiceClient;
  private userService: UserServiceClient;

  constructor(
    @Inject('CHAT_SERVICE') private chatClient: ClientGrpc,
    @Inject('USER_SERVICE') private userClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.chatService = this.chatClient.getService<ChatServiceClient>('ChatService');
    this.userService = this.userClient.getService<UserServiceClient>('UserService');
  }

  @Post()
  async grantPermission(
    @Body() dto: GrantPermissionDto,
    @Request() req: any
  ) {
    this.logger.log(`User ${req.user.username} is granting permission to user ${dto.userId}`);

    try {
      // 驗證目標使用者是否存在並取得 username
      const userResponse = await firstValueFrom(
        this.userService.getUserById({ userId: dto.userId })
      ) as {
        found: boolean;
        user: {
          username: string;
        };
      };

      if (!userResponse.found) {
        throw new HttpException('User not found', HttpStatus.NOT_FOUND);
      }

      // 從使用者資料中取得 username
      const username = userResponse.user.username;

      // 授予權限
      const result = await firstValueFrom(
        this.chatService.grantSystemMessagePermission({
          userId: dto.userId,
          username: username,
          grantedBy: req.user.username
        })
      ) as {
        success: boolean;
        message: string;
      };

      if (!result.success) {
        throw new HttpException(result.message, HttpStatus.INTERNAL_SERVER_ERROR);
      }

      this.logger.log(`Permission granted to user ${username} (${dto.userId}) by ${req.user.username}`);

      return {
        success: true,
        message: `Permission granted to ${username} successfully`,
        grantedBy: req.user.username
      };

    } catch (error) {
      this.logger.error('Error in grantPermission:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to grant permission',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Delete(':userId')
  async revokePermission(
    @Param('userId') userId: string,
    @Request() req: any
  ) {
    this.logger.log(`User ${req.user.username} is revoking permission from user ${userId}`);

    try {
      // 不允許撤銷自己的權限
      if (userId === req.user.userId) {
        throw new HttpException(
          'Cannot revoke your own permission',
          HttpStatus.BAD_REQUEST
        );
      }

      // 撤銷權限
      const result = await firstValueFrom(
        this.chatService.revokeSystemMessagePermission({
          userId: userId
        })
      ) as {
        success: boolean;
        message: string;
      };

      if (!result.success) {
        throw new HttpException(result.message, HttpStatus.NOT_FOUND);
      }

      this.logger.log(`Permission revoked from user ${userId} by ${req.user.username}`);

      return {
        success: true,
        message: result.message,
        revokedBy: req.user.username
      };

    } catch (error) {
      this.logger.error('Error in revokePermission:', error);
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        error.message || 'Failed to revoke permission',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get()
  async listPermissions(@Request() req: any) {
    this.logger.log(`User ${req.user.username} is listing system message permissions`);

    try {
      const result = await firstValueFrom(
        this.chatService.listSystemMessagePermissions({
          activeOnly: true
        })
      ) as {
        permissions: any[];
        totalCount: number;
      };

      return {
        success: true,
        permissions: result.permissions,
        totalCount: result.totalCount
      };

    } catch (error) {
      this.logger.error('Error in listPermissions:', error);
      throw new HttpException(
        error.message || 'Failed to list permissions',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
