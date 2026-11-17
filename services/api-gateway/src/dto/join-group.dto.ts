import { IsString, IsNotEmpty } from 'class-validator';

export class JoinGroupDto {
  @IsString()
  @IsNotEmpty()
  conversationId: string;  // 必填：要加入的群組對話 ID
}
