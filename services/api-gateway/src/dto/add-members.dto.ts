import { IsArray, IsString, ArrayNotEmpty, ArrayMinSize } from 'class-validator';

export class AddMembersDto {
  @IsArray()
  @ArrayNotEmpty({ message: 'userIds 不可為空陣列' })
  @ArrayMinSize(1, { message: '至少需要新增一位成員' })
  @IsString({ each: true, message: '每個 userId 都必須是字串' })
  userIds: string[];
}
