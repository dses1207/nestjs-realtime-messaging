import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  // 創建 HTTP 應用
  const app = await NestFactory.create(AppModule);
  
  // 設置 CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // 連接 gRPC 微服務
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'chat',
      protoPath: join(__dirname, '../protos/chat.proto'),
      url: '0.0.0.0:50053',
      channelOptions: {
        'grpc.max_send_message_length': 200 * 1024 * 1024,
        'grpc.max_receive_message_length': 200 * 1024 * 1024,
      },
    },
  });

  // 啟動所有微服務
  await app.startAllMicroservices();
  
  // 啟動 HTTP 服務
  await app.listen(3003);
  console.log('Chat Service is running on port 3003 (HTTP) and 50053 (gRPC)');
}

bootstrap();
