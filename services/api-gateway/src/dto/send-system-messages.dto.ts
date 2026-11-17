import { IsArray, IsString, IsOptional, IsEnum, IsNotEmpty } from 'class-validator';

export class SendSystemMessagesDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  conversationIds?: string[];  // 選填：對話 ID 陣列，空陣列或未提供 = 群發所有人

  @IsString()
  @IsNotEmpty()
  content: string;  // 必填：訊息內容

  @IsEnum(['text', 'file', 'image', 'document', 'video'])
  @IsOptional()
  messageType?: string = 'text';  // 選填：訊息類型

  @IsString()
  @IsOptional()
  fileId?: string;  // 選填：檔案 ID

  @IsOptional()
  metadata?: Record<string, any>;  // 選填：自訂元資料
}
