import { IsString, IsNotEmpty } from 'class-validator';

export class GrantPermissionDto {
  @IsString()
  @IsNotEmpty()
  userId: string;  // 必填：要授予權限的使用者 ID
}
