import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // 設置 CORS
  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  const port = process.env.WEBSOCKET_SERVICE_PORT || 3001;
  await app.listen(port);
  console.log(`WebSocket Server is running on port ${port}`);
}

bootstrap(); 