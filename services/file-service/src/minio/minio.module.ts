import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MinioService } from './minio.service';
import { FileRecord, FileSchema } from '../schemas/file.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FileRecord.name, schema: FileSchema },
    ]),
  ],
  providers: [MinioService],
  exports: [MinioService],
})
export class MinioModule {} 