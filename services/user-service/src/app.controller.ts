import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { AppService } from './app.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('users')
export class AppController {
  constructor(private readonly appService: AppService) {}

  // HTTP endpoints (require JWT authentication)
  @Get()
  @UseGuards(JwtAuthGuard)
  async getAllUsers() {
    return this.appService.getAllUsers();
  }

  @Get('usernames')
  @UseGuards(JwtAuthGuard)
  async getAllUsernames() {
    const usernames = await this.appService.getAllUsernames();
    return { usernames };
  }

  @Get(':username')
  @UseGuards(JwtAuthGuard)
  async getUserByUsername(@Param('username') username: string) {
    return this.appService.getUserByUsername(username);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async updateUser(
    @Param('id') id: string, 
    @Body() updateData: { email?: string; name?: string; username?: string; profilePicture?: string; status?: string }
  ) {
    return this.appService.updateUser(id, updateData);
  }

  // gRPC methods
  @GrpcMethod('UserService', 'GetAllUsers')
  async grpcGetAllUsers() {
    try {
      const users = await this.appService.getAllUsers();
      return {
        users: users.map(user => ({
          id: (user as any)._id.toString(),
          email: user.email,
          name: user.name,
          username: user.username,
          department: user.department,
          profilePicture: user.profilePicture,
          status: user.status,
          createdAt: user.createdAt?.toISOString() || '',
          updatedAt: user.updatedAt?.toISOString() || '',
        }))
      };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || 'Failed to get users'
      });
    }
  }

  @GrpcMethod('UserService', 'GetAllUsernames')
  async grpcGetAllUsernames() {
    try {
      const usernames = await this.appService.getAllUsernames();
      return { usernames };
    } catch (error) {
      throw new RpcException({
        code: 13, // INTERNAL
        message: error.message || 'Failed to get usernames'
      });
    }
  }

  @GrpcMethod('UserService', 'GetUserByUsername')
  async grpcGetUserByUsername(data: { username: string }) {
    try {
      const result = await this.appService.getUserByUsername(data.username);
      return {
        user: result.user ? {
          id: (result.user as any)._id.toString(),
          email: result.user.email,
          name: result.user.name,
          username: result.user.username,
          department: result.user.department,
          profilePicture: result.user.profilePicture,
          status: result.user.status,
          createdAt: result.user.createdAt?.toISOString() || '',
          updatedAt: result.user.updatedAt?.toISOString() || '',
        } : {},
        found: result.found,
      };
    } catch (error) {
      throw new RpcException({
        code: 5,
        message: error.message || 'Failed to get user'
      });
    }
  }

  @GrpcMethod('UserService', 'GetUserById')
  async grpcGetUserById(data: { userId: string }) {
    try {
      const user = await this.appService.getUserById(data.userId);
      return {
        user: user ? {
          id: (user as any)._id.toString(),
          email: user.email,
          name: user.name,
          username: user.username,
          department: user.department,
          profilePicture: user.profilePicture,
          status: user.status,
          createdAt: user.createdAt?.toISOString() || '',
          updatedAt: user.updatedAt?.toISOString() || '',
        } : {},
        found: !!user,
      };
    } catch (error) {
      throw new RpcException({
        code: 5,
        message: error.message || 'Failed to get user'
      });
    }
  }

  @GrpcMethod('UserService', 'UpdateUser')
  async grpcUpdateUser(data: { userId: string; email?: string; name?: string; username?: string; profilePicture?: string; status?: string }) {
    try {
      const result = await this.appService.updateUser(data.userId, {
        email: data.email,
        name: data.name,
        username: data.username,
        profilePicture: data.profilePicture,
        status: data.status
      });
      
      return {
        user: {
          id: (result.user as any)._id.toString(),
          email: result.user.email,
          name: result.user.name,
          username: result.user.username,
          department: result.user.department,
          profilePicture: result.user.profilePicture,
          status: result.user.status,
          createdAt: result.user.createdAt?.toISOString() || '',
          updatedAt: result.user.updatedAt?.toISOString() || '',
        },
        message: result.message,
      };
    } catch (error) {
      throw new RpcException({
        code: 3,
        message: error.message || 'Failed to update user'
      });
    }
  }

  @GrpcMethod('UserService', 'Register')
  async grpcRegister(data: { email: string; username: string; password: string; name?: string }) {
    try {
      const result = await this.appService.register(data);
      return {
        user: {
          id: (result.user._id as any).toString(),
          email: result.user.email,
          name: result.user.name,
          username: result.user.username,
          createdAt: result.user.createdAt?.toISOString() || '',
          updatedAt: result.user.updatedAt?.toISOString() || '',
        },
        accessToken: result.accessToken,
        message: result.message,
      };
    } catch (error) {
      throw new RpcException({ code: 6, message: error.message || 'Registration failed' });
    }
  }

  @GrpcMethod('UserService', 'Login')
  async grpcLogin(data: { emailOrUsername: string; password: string }) {
    try {
      const result = await this.appService.login(data);
      return {
        user: {
          id: (result.user._id as any).toString(),
          email: result.user.email,
          name: result.user.name,
          username: result.user.username,
          createdAt: result.user.createdAt?.toISOString() || '',
          updatedAt: result.user.updatedAt?.toISOString() || '',
        },
        accessToken: result.accessToken,
        message: result.message,
      };
    } catch (error) {
      throw new RpcException({ code: 16, message: error.message || 'Login failed' });
    }
  }

  @GrpcMethod('UserService', 'ValidateToken')
  async grpcValidateToken(data: { token: string }) {
    try {
      const decoded = await this.appService.validateToken(data.token);
      if (decoded) {
        const user = await this.appService.validateUser(decoded.userId);
        if (user) {
          return {
            valid: true,
            user: {
              id: (user as any)._id.toString(),
              email: user.email,
              name: user.name,
              username: user.username,
              department: user.department,
              createdAt: user.createdAt?.toISOString() || '',
              updatedAt: user.updatedAt?.toISOString() || '',
            },
          };
        }
      }
      return { valid: false, user: {} };
    } catch {
      return { valid: false, user: {} };
    }
  }
}
