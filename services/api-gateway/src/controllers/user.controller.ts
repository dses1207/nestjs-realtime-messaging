import { Controller, Get, Post, Delete, Param, Body, Request, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { GrpcClientService } from '../services/grpc-client.service';
import { firstValueFrom } from 'rxjs';
import { ApiResponse, ApiResponseHelper } from '../dto/api-response.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly grpcClient: GrpcClientService) {}

  @Get()
  async getAllUsers(): Promise<ApiResponse> {
    try {
      const result = await firstValueFrom(this.grpcClient.getAllUsers());
      return ApiResponseHelper.success(result.users, '取得用戶列表成功');
    } catch (error) {
      this.handleGrpcError(error);
    }
  }

  @Get('usernames')
  async getAllUsernames(): Promise<ApiResponse> {
    try {
      const result = await firstValueFrom(this.grpcClient.getAllUsernames());
      return ApiResponseHelper.success(result.usernames, '取得用戶名稱列表成功');
    } catch (error) {
      this.handleGrpcError(error);
    }
  }

  @Get(':username')
  async getUserByUsername(@Param('username') username: string): Promise<ApiResponse> {
    try {
      const result = await firstValueFrom(this.grpcClient.getUserByUsername({ username }));
      if (result.found) {
        return ApiResponseHelper.success(result.user, '取得用戶資料成功');
      } else {
        return ApiResponseHelper.success(null, '用戶不存在');
      }
    } catch (error) {
      this.handleGrpcError(error);
    }
  }

  // 移除所有好友相關端點
  // addFriend, removeFriend, getFriends

  private handleGrpcError(error: any): never {
    const grpcCode = error.code;
    const message = error.details || error.message || '服務暫時不可用';

    switch (grpcCode) {
      case 3: // INVALID_ARGUMENT
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.BAD_REQUEST);
      case 16: // UNAUTHENTICATED
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.UNAUTHORIZED);
      case 6: // ALREADY_EXISTS
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.CONFLICT);
      case 5: // NOT_FOUND
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.NOT_FOUND);
      case 13: // INTERNAL
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.INTERNAL_SERVER_ERROR);
      default:
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
} 