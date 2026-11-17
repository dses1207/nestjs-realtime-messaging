import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

@Injectable()
export class RtcClientService implements OnModuleInit {
  private readonly logger = new Logger(RtcClientService.name);
  private rtcService: any;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const PROTO_PATH = join(__dirname, '../../protos/rtc.proto');
    const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    const rtcProto: any = grpc.loadPackageDefinition(packageDefinition).rtc;

    const RTC_SERVICE_URL = this.configService.get<string>('RTC_SERVICE_URL');
    const RTC_SERVICE_PORT = this.configService.get<string>('RTC_SERVICE_PORT');

    this.rtcService = new rtcProto.RTCService(
      `${RTC_SERVICE_URL}:${RTC_SERVICE_PORT}`,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 200 * 1024 * 1024,
        'grpc.max_send_message_length': 200 * 1024 * 1024,
      },
    );

    this.logger.log(
      `✅ RTC gRPC client connected to ${RTC_SERVICE_URL}:${RTC_SERVICE_PORT}`,
    );
  }

  /**
   * 獲取通話記錄
   */
  getCallHistory(request: {
    userId: string;
    conversationId?: string;
    limit: number;
    offset: number;
  }): Promise<any> {
    return new Promise((resolve, reject) => {
      this.rtcService.GetCallHistory(request, (error: any, response: any) => {
        if (error) {
          this.logger.error('GetCallHistory gRPC error:', error.message);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * 獲取通話詳情
   */
  getCallDetails(request: { callId: string }): Promise<any> {
    return new Promise((resolve, reject) => {
      this.rtcService.GetCallDetails(request, (error: any, response: any) => {
        if (error) {
          this.logger.error('GetCallDetails gRPC error:', error.message);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * 獲取通話狀態
   */
  getCallStatus(request: { callId: string }): Promise<any> {
    return new Promise((resolve, reject) => {
      this.rtcService.GetCallStatus(request, (error: any, response: any) => {
        if (error) {
          this.logger.error('GetCallStatus gRPC error:', error.message);
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }
}
