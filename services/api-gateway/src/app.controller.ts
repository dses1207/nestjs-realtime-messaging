import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ApiResponse, ApiResponseHelper } from './dto/api-response.dto';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  getHealth(): ApiResponse {
    return ApiResponseHelper.success(
      { 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'api-gateway'
      },
      'API Gateway 健康檢查通過'
    );
  }
}
