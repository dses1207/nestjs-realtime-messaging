import { Injectable, ExecutionContext, UnauthorizedException, CanActivate } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw new UnauthorizedException('認證令牌未找到');
    }
    try {
      const payload = await this.jwtService.verifyAsync(
        token,
        {
          secret: process.env.JWT_SECRET || 'your-secret-key'
        }
      );

      // 標準化用戶資料格式，確保 id 字段統一
      const standardizedUser = {
        id: payload.userId || payload.id,  // 將 userId 轉換為 id
        userId: payload.userId || payload.id,  // 保留 userId 以向後兼容
        username: payload.username,
        email: payload.email,
        ...payload  // 保留其他字段
      };

      request['user'] = standardizedUser;
    } catch (error) {
      console.error('JWT verification failed:', error);
      throw new UnauthorizedException('無效的認證令牌');
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
} 