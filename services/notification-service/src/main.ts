import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { join } from 'path';

async function bootstrap() {
  const app = await NestFactory.createMicroservice<MicroserviceOptions>(AppModule, {
    transport: Transport.GRPC,
    options: {
      package: 'notification',
      protoPath: join(__dirname, '../protos/notification.proto'),
      url: `0.0.0.0:${process.env.NOTIFICATION_SERVICE_PORT || 50056}`,
      channelOptions: {
        'grpc.max_send_message_length': 200 * 1024 * 1024,
        'grpc.max_receive_message_length': 200 * 1024 * 1024,
      },
    },
  });

  console.log(`🚀 Notification Service is running on port ${process.env.NOTIFICATION_SERVICE_PORT || 50056}`);
  await app.listen();
}

bootstrap();