import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CallRecordService } from './call-record.service';
import { CallRecord, CallRecordSchema } from './schemas/call-record.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CallRecord.name, schema: CallRecordSchema },
    ]),
  ],
  providers: [CallRecordService],
  exports: [CallRecordService],
})
export class CallRecordModule {}
