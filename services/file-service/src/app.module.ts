import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { FileRecord, FileSchema } from './schemas/file.schema';
import { MinioModule } from './minio/minio.module';
import { FileController } from './file.controller';
import { ChatClientService } from './chat-client/chat-client.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri: configService.get<string>('MONGODB_URI'),
      }),
      inject: [ConfigService],
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: FileRecord.name, schema: FileSchema },
    ]),
    MinioModule,
  ],
  controllers: [FileController],
  providers: [ChatClientService],
})
export class AppModule {}
