import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { Model } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AppService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
  ) {}

  async register(data: { email: string; username: string; password: string; name?: string }): Promise<{ user: any; accessToken: string; message: string }> {
    const existingUser = await this.userModel.findOne({
      $or: [{ email: data.email }, { username: data.username }],
    }).exec();

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const newUser = new this.userModel({
      email: data.email,
      username: data.username,
      name: data.name || data.username,
      password: hashedPassword,
    });

    const savedUser = await newUser.save();
    const payload = {
      userId: (savedUser._id as any).toString(),
      username: savedUser.username,
      email: savedUser.email,
    };
    const accessToken = this.jwtService.sign(payload);
    const { password: _, ...userWithoutPassword } = savedUser.toObject();

    return { user: userWithoutPassword, accessToken, message: 'Registration successful' };
  }

  async login(data: { emailOrUsername: string; password: string }): Promise<{ user: any; accessToken: string; message: string }> {
    const user = await this.userModel.findOne({
      $or: [{ email: data.emailOrUsername }, { username: data.emailOrUsername }],
    }).exec();

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(data.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      userId: (user._id as any).toString(),
      username: user.username,
      email: user.email,
    };
    const accessToken = this.jwtService.sign(payload);
    const { password: _, ...userWithoutPassword } = user.toObject();

    return { user: userWithoutPassword, accessToken, message: 'Login successful' };
  }

  // JWT Token validation
  async validateToken(token: string): Promise<any> {
    try {
      return await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET || 'your-secret-key'
      });
    } catch {
      return null;
    }
  }

  async validateUser(userId: string): Promise<User | null> {
    return this.userModel.findById(userId).exec();
  }

  async getAllUsers(): Promise<User[]> {
    return this.userModel.find({}).exec();
  }

  async getAllUsernames(): Promise<string[]> {
    const users = await this.userModel.find({}, 'username').exec();
    return users.map(user => user.username);
  }

  async getUserByUsername(username: string): Promise<{ user: User | null; found: boolean }> {
    const user = await this.userModel.findOne({ username }).exec();
    return { user, found: !!user };
  }

  async getUserById(userId: string): Promise<User | null> {
    return this.userModel.findById(userId).exec();
  }

  async updateUser(
    userId: string,
    updateData: { email?: string; name?: string; username?: string; profilePicture?: string; status?: string },
  ): Promise<{ user: User; message: string }> {
    const updatedUser = await this.userModel.findByIdAndUpdate(userId, updateData, { new: true }).exec();
    if (!updatedUser) {
      throw new Error('User not found');
    }
    return { user: updatedUser, message: 'User updated successfully' };
  }
}
