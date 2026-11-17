import { Controller, Post, Body, Get, UseGuards, Request, Logger } from '@nestjs/common';
import { GrpcClientService } from '../services/grpc-client.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { ApiResponse, ApiResponseHelper } from '../dto/api-response.dto';
import { JwtService } from '@nestjs/jwt';
import { firstValueFrom } from 'rxjs';
import { randomUUID } from 'crypto';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly grpcClientService: GrpcClientService,
    private readonly jwtService: JwtService,
  ) {}

  private generateWsTicket(userId: string): string {
    return this.jwtService.sign(
      { sub: userId, jti: randomUUID() },
      { secret: process.env.JWT_SECRET || 'your-secret-key', expiresIn: '30s', audience: 'websocket' },
    );
  }

  @Post('register')
  async register(@Body() body: { email: string; username: string; password: string; name?: string }): Promise<ApiResponse> {
    try {
      const result = await firstValueFrom(
        this.grpcClientService.register({
          email: body.email,
          username: body.username,
          password: body.password,
          name: body.name,
        }),
      );

      const wsTicket = this.generateWsTicket(result.user.id);
      return ApiResponseHelper.success(
        { user: result.user, accessToken: result.accessToken, ws_ticket: wsTicket },
        result.message || 'Registration successful',
      );
    } catch (error) {
      this.logger.error('Register error:', error);
      if (error.code === 6) return ApiResponseHelper.error('User already exists');
      return ApiResponseHelper.error(error.details || 'Registration failed');
    }
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }): Promise<ApiResponse> {
    try {
      const result = await firstValueFrom(
        this.grpcClientService.login({ emailOrUsername: body.email, password: body.password }),
      );

      const wsTicket = this.generateWsTicket(result.user.id);
      return ApiResponseHelper.success(
        { user: result.user, accessToken: result.accessToken, ws_ticket: wsTicket },
        result.message || 'Login successful',
      );
    } catch (error) {
      this.logger.error('Login error:', error);
      if (error.code === 16) return ApiResponseHelper.error('Invalid email or password');
      return ApiResponseHelper.error(error.details || 'Login failed');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('validate')
  async validateToken(@Request() req: any): Promise<ApiResponse> {
    try {
      const user = req.user;
      if (user && user.userId) {
        const wsTicket = this.generateWsTicket(user.userId);
        try {
          const userResult = await firstValueFrom(this.grpcClientService.getUserById({ userId: user.userId }));
          if (userResult.found && userResult.user) {
            return ApiResponseHelper.success({ valid: true, user: userResult.user, ws_ticket: wsTicket }, 'Token is valid');
          }
        } catch {}
        return ApiResponseHelper.success(
          { valid: true, user: { id: user.userId, username: user.username, email: user.email }, ws_ticket: wsTicket },
          'Token is valid',
        );
      }
      return ApiResponseHelper.error('Token validation failed');
    } catch (error) {
      this.logger.error('Token validation error:', error);
      return ApiResponseHelper.error('Token validation failed');
    }
  }

  @Post('ws-ticket')
  @UseGuards(JwtAuthGuard)
  async getWsTicket(@Request() req: any): Promise<ApiResponse> {
    try {
      const user = req.user;
      if (!user || !user.userId) return ApiResponseHelper.error('Unable to get user info');
      return ApiResponseHelper.success({ ws_ticket: this.generateWsTicket(user.userId) }, 'WebSocket ticket generated');
    } catch (error) {
      this.logger.error('Get WS ticket error:', error);
      return ApiResponseHelper.error('Failed to generate WebSocket ticket');
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@Request() req: any): Promise<ApiResponse> {
    try {
      const user = req.user;
      if (user && user.userId) {
        const userResult = await firstValueFrom(this.grpcClientService.getUserById({ userId: user.userId }));
        if (userResult.found && userResult.user) {
          return ApiResponseHelper.success(userResult.user, 'Profile retrieved');
        }
      }
      return ApiResponseHelper.error('User not found');
    } catch (error) {
      this.logger.error('Get profile error:', error);
      return ApiResponseHelper.error('Server error');
    }
  }
}
