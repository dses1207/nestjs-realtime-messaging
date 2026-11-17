import { IsString, IsNotEmpty, Length } from 'class-validator';

export class UpdateRoomNameDto {
  @IsString({ message: 'name 必須是字串' })
  @IsNotEmpty({ message: 'name 不可為空' })
  @Length(1, 50, { message: '名稱長度必須在 1-50 字元之間' })
  name: string;
}
