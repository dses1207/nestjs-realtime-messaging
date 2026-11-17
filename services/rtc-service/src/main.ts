import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { join } from 'path';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = process.env.RTC_SERVICE_PORT || '50058';

  const app = await NestFactory.createMicroservice<MicroserviceOptions>(
    AppModule,
    {
      transport: Transport.GRPC,
      options: {
        package: 'rtc',
        protoPath: join(__dirname, '../protos/rtc.proto'),
        url: `0.0.0.0:${port}`,
        maxReceiveMessageLength: 200 * 1024 * 1024, // 200MB
        maxSendMessageLength: 200 * 1024 * 1024,    // 200MB
      },
    },
  );

  await app.listen();
  logger.log(`🚀 RTC Service is listening on port ${port} (gRPC)`);
  logger.log(`📡 Proto file: ${join(__dirname, '../protos/rtc.proto')}`);
  logger.log(`🔗 LiveKit URL: ${process.env.LIVEKIT_URL || 'Not configured'}`);
}

bootstrap();
