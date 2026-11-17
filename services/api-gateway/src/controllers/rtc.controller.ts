import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RtcClientService } from '../rtc-client/rtc-client.service';

@Controller('api/calls')
@UseGuards(JwtAuthGuard)
export class RtcController {
  private readonly logger = new Logger(RtcController.name);

  constructor(private rtcClientService: RtcClientService) {}

  /**
   * GET /api/calls/history
   * 查詢通話記錄
   */
  @Get('history')
  async getCallHistory(
    @Request() req: any,
    @Query('conversationId') conversationId?: string,
    @Query('limit') limit: string = '20',
    @Query('offset') offset: string = '0',
  ) {
    const userId = req.user.userId;

    this.logger.log(`📋 GetCallHistory request from user ${userId}`);

    try {
      const response = await this.rtcClientService.getCallHistory({
        userId: userId,
        conversationId: conversationId,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });

      return {
        success: true,
        calls: response.calls,
        totalCount: response.totalCount,
      };
    } catch (error) {
      this.logger.error(`❌ GetCallHistory error:`, error.message);
      return {
        success: false,
        calls: [],
        totalCount: 0,
        message: '查詢通話記錄失敗',
      };
    }
  }

  /**
   * GET /api/calls/:callId
   * 查詢通話詳情
   */
  @Get(':callId')
  async getCallDetails(@Param('callId') callId: string) {
    this.logger.log(`🔍 GetCallDetails request for ${callId}`);

    try {
      const response = await this.rtcClientService.getCallDetails({
        callId: callId,
      });

      return {
        success: response.success,
        call: response.call,
        message: response.message,
      };
    } catch (error) {
      this.logger.error(`❌ GetCallDetails error:`, error.message);
      return {
        success: false,
        call: null,
        message: '查詢通話詳情失敗',
      };
    }
  }

  /**
   * GET /api/calls/:callId/status
   * 查詢通話狀態
   */
  @Get(':callId/status')
  async getCallStatus(@Param('callId') callId: string) {
    this.logger.log(`📊 GetCallStatus request for ${callId}`);

    try {
      const response = await this.rtcClientService.getCallStatus({
        callId: callId,
      });

      return {
        success: true,
        active: response.active,
        status: response.status,
        participantCount: response.participantCount,
        startedAt: response.startedAt,
        durationSeconds: response.durationSeconds,
        roomName: response.roomName,
      };
    } catch (error) {
      this.logger.error(`❌ GetCallStatus error:`, error.message);
      return {
        success: false,
        active: false,
        message: '查詢通話狀態失敗',
      };
    }
  }
}
