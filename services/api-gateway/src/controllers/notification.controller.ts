import { Controller, Get, Post, Put, Delete, Param, Body, Request, HttpException, HttpStatus, UseGuards, Query } from '@nestjs/common';
import { GrpcClientService } from '../services/grpc-client.service';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ApiResponse, ApiResponseHelper } from '../dto/api-response.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly grpcClient: GrpcClientService) {}

  @Post('register-device')
  async registerDevice(
    @Body() deviceData: {
      deviceId: string;
      platform: string;
      token: string;
      appVersion: string;
      environment?: string;
    },
    @Request() req: any,
  ): Promise<ApiResponse> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      // 驗證必要欄位
      if (!deviceData.deviceId || !deviceData.platform || !deviceData.token || !deviceData.appVersion) {
        throw new HttpException(
          ApiResponseHelper.error('裝置資訊不完整'),
          HttpStatus.BAD_REQUEST,
        );
      }

      // 驗證平台類型
      if (!['ios', 'android', 'fcm', 'apns'].includes(deviceData.platform.toLowerCase())) {
        throw new HttpException(
          ApiResponseHelper.error('不支援的平台類型'),
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await firstValueFrom(this.grpcClient.registerDeviceToken({
        userId,
        token: deviceData.token,
        platform: deviceData.platform.toLowerCase(),
        deviceId: deviceData.deviceId,
        appVersion: deviceData.appVersion,
        environment: deviceData.environment,
      }));

      return ApiResponseHelper.success(null, result.message || '裝置註冊成功');
    } catch (error) {
      console.error('Error registering device:', error);
      this.handleGrpcError(error);
    }
  }

  @Delete('device/:token')
  async removeDevice(
    @Param('token') token: string,
    @Request() req: any,
  ): Promise<ApiResponse> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      if (!token) {
        throw new HttpException(
          ApiResponseHelper.error('裝置 Token 不能為空'),
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await firstValueFrom(this.grpcClient.removeDeviceToken({
        userId,
        token,
      }));

      return ApiResponseHelper.success(null, result.message || '裝置移除成功');
    } catch (error) {
      console.error('Error removing device:', error);
      this.handleGrpcError(error);
    }
  }

  @Get('settings')
  async getNotificationSettings(@Request() req: any): Promise<ApiResponse> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      const result = await firstValueFrom(this.grpcClient.getNotificationSettings({ userId }));
      return ApiResponseHelper.success(result.settings, '取得推播設定成功');
    } catch (error) {
      console.error('Error getting notification settings:', error);
      this.handleGrpcError(error);
    }
  }

  @Put('settings')
  async updateNotificationSettings(
    @Body() settingsData: {
      newMessage?: boolean;
      groupInvite?: boolean;
      groupMessage?: boolean;
    },
    @Request() req: any,
  ): Promise<ApiResponse> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      // 驗證至少有一個設定項目
      if (
        settingsData.newMessage === undefined &&
        settingsData.groupInvite === undefined &&
        settingsData.groupMessage === undefined
      ) {
        throw new HttpException(
          ApiResponseHelper.error('至少需要提供一個設定項目'),
          HttpStatus.BAD_REQUEST,
        );
      }

      const result = await firstValueFrom(this.grpcClient.updateNotificationSettings({
        userId,
        ...settingsData,
      }));

      return ApiResponseHelper.success(null, result.message || '推播設定更新成功');
    } catch (error) {
      console.error('Error updating notification settings:', error);
      this.handleGrpcError(error);
    }
  }

  @Get('history')
  async getNotificationHistory(
    @Request() req: any,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ApiResponse> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        throw new HttpException(ApiResponseHelper.error('用戶ID未找到'), HttpStatus.UNAUTHORIZED);
      }

      // 解析查詢參數
      const queryParams: any = { userId };
      
      if (limit) {
        const limitNum = parseInt(limit, 10);
        if (limitNum > 0 && limitNum <= 100) {
          queryParams.limit = limitNum;
        } else {
          throw new HttpException(
            ApiResponseHelper.error('limit 必須在 1-100 之間'),
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      
      if (offset) {
        const offsetNum = parseInt(offset, 10);
        if (offsetNum >= 0) {
          queryParams.offset = offsetNum;
        } else {
          throw new HttpException(
            ApiResponseHelper.error('offset 必須大於等於 0'),
            HttpStatus.BAD_REQUEST,
          );
        }
      }
      
      if (type && ['new_message', 'group_message', 'group_invite'].includes(type)) {
        queryParams.type = type;
      } else if (type) {
        throw new HttpException(
          ApiResponseHelper.error('不支援的通知類型'),
          HttpStatus.BAD_REQUEST,
        );
      }
      
      if (startDate) {
        const startDateObj = new Date(startDate);
        if (isNaN(startDateObj.getTime())) {
          throw new HttpException(
            ApiResponseHelper.error('startDate 格式錯誤'),
            HttpStatus.BAD_REQUEST,
          );
        }
        queryParams.startDate = startDateObj.toISOString();
      }
      
      if (endDate) {
        const endDateObj = new Date(endDate);
        if (isNaN(endDateObj.getTime())) {
          throw new HttpException(
            ApiResponseHelper.error('endDate 格式錯誤'),
            HttpStatus.BAD_REQUEST,
          );
        }
        queryParams.endDate = endDateObj.toISOString();
      }

      const result = await firstValueFrom(this.grpcClient.getNotificationHistory(queryParams));

      return ApiResponseHelper.success({
        notifications: result.notifications || [],
        total: result.total || 0,
        hasMore: result.hasMore || false,
        limit: queryParams.limit || 20,
        offset: queryParams.offset || 0,
      }, '取得推播歷史記錄成功');
    } catch (error) {
      console.error('Error getting notification history:', error);
      this.handleGrpcError(error);
    }
  }

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