import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { join } from 'path';

async function bootstrap() {
  // 建立HTTP應用
  const app = await NestFactory.create(AppModule);
  
  // 啟用CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
  
  // 建立gRPC微服務
  const microservice = app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'user',
      protoPath: join(__dirname, '../protos/user.proto'),
      url: '0.0.0.0:50052',
      channelOptions: {
        'grpc.max_send_message_length': 200 * 1024 * 1024,
        'grpc.max_receive_message_length': 200 * 1024 * 1024,
      },
    },
  });

  // 啟動微服務
  await app.startAllMicroservices();
  
  // 啟動HTTP服務（保留用於健康檢查和測試）
  await app.listen(3002);
  console.log('User Service is running on port 3002 (HTTP) and 50052 (gRPC)');
}
bootstrap();
