import { 
  Controller, 
  Post, 
  Get,
  Body, 
  Param,
  Res,
  Req,
  HttpException, 
  HttpStatus, 
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { GrpcClientService } from '../services/grpc-client.service';
import { firstValueFrom } from 'rxjs';
import { ApiResponse, ApiResponseHelper } from '../dto/api-response.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';

@Controller()
export class FileController {
  constructor(private readonly grpcClient: GrpcClientService) {}

  // 統一預簽名 URL 檔案上傳 API - 請求上傳許可
  @Post('api/files/request-upload')
  @UseGuards(JwtAuthGuard)
  async requestUpload(
    @Body() body: { 
      fileName: string;
      fileSize: number;
      contentType: string;
      conversationId?: string; 
      messageId?: string; 
      category?: string;
    },
    @Req() req: Request,
  ): Promise<ApiResponse> {
    try {
      // 從 JWT token 獲取 user ID
      const userId = (req as any).user?.id || (req as any).user?.userId;

      if (!userId) {
        throw new HttpException(
          ApiResponseHelper.error('缺少用戶資訊'),
          HttpStatus.UNAUTHORIZED
        );
      }

      const requestData = {
        filename: body.fileName,
        fileSize: body.fileSize,
        contentType: body.contentType,
        uploaderId: userId,
        conversationId: body.conversationId,
        messageId: body.messageId,
        category: body.category || 'general',
      };

      const result = await firstValueFrom(
        this.grpcClient.requestUpload(requestData)
      );

      if (result.success) {
        return ApiResponseHelper.success(
          {
            fileId: result.fileId,
            uploadUrl: result.uploadUrl,
            expiresAt: result.expiresAt,
          },
          result.message || '上傳 URL 生成成功'
        );
      } else {
        throw new HttpException(
          ApiResponseHelper.error(result.message || '生成上傳 URL 失敗'),
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    } catch (error) {
      this.handleGrpcError(error);
    }
  }

  // 確認檔案上傳完成
  @Post('api/files/confirm-upload')
  @UseGuards(JwtAuthGuard)
  async confirmUpload(
    @Body() body: { 
      fileId: string;
    },
    @Req() req: Request,
  ): Promise<ApiResponse> {
    try {
      // 從 JWT token 獲取 user ID
      const userId = (req as any).user?.id || (req as any).user?.userId;

      if (!userId) {
        throw new HttpException(
          ApiResponseHelper.error('缺少用戶資訊'),
          HttpStatus.UNAUTHORIZED
        );
      }

      const confirmData = {
        fileId: body.fileId,
        uploaderId: userId,
      };

      const result = await firstValueFrom(
        this.grpcClient.confirmUpload(confirmData)
      );

      if (result.success) {
        return ApiResponseHelper.success(
          {
            fileId: result.fileId,
            fileUrl: result.fileUrl,
            fileSize: result.fileSize,
            contentType: result.contentType,
            // 原始名稱將由mongodb處理
          },
          result.message || '檔案上傳確認成功'
        );
      } else {
        throw new HttpException(
          ApiResponseHelper.error(result.message || '確認檔案上傳失敗'),
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    } catch (error) {
      this.handleGrpcError(error);
    }
  }

  // 保留向後相容 - 舊的檔案上傳 API
  @Post('api/files/upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadSecureFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { 
      conversationId?: string; 
      messageId?: string; 
      category?: string;
    },
    @Req() req: Request,
  ): Promise<ApiResponse> {
    try {
      if (!file) {
        throw new HttpException(
          ApiResponseHelper.error('沒有上傳檔案'),
          HttpStatus.BAD_REQUEST
        );
      }

      // 從 JWT token 獲取 user ID
      const userId = (req as any).user?.id || (req as any).user?.userId;

      if (!userId) {
        throw new HttpException(
          ApiResponseHelper.error('缺少用戶資訊'),
          HttpStatus.UNAUTHORIZED
        );
      }

      const uploadRequest = {
        filename: file.originalname,
        data: file.buffer,
        contentType: file.mimetype,
        uploaderId: userId,
        conversationId: body.conversationId,
        messageId: body.messageId,
        category: body.category || 'general',
      };

      const result = await firstValueFrom(
        this.grpcClient.uploadSecureFile(uploadRequest)
      );

      if (result.success) {
        return ApiResponseHelper.success(
          {
            fileId: result.fileId,
            fileUrl: result.fileUrl,
            fileSize: result.fileSize,
            contentType: result.contentType,
            // 原始名稱將由mongodb處理
          },
          result.message || '檔案上傳成功'
        );
      } else {
        throw new HttpException(
          ApiResponseHelper.error(result.message || '檔案上傳失敗'),
          HttpStatus.INTERNAL_SERVER_ERROR
        );
      }
    } catch (error) {
      this.handleGrpcError(error);
    }
  }

  // 安全檔案存取 API (向後兼容)
  @Get('files/:fileId')
  @UseGuards(JwtAuthGuard)
  async getSecureFile(
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      // 從 JWT token 獲取 user ID
      const userId = (req as any).user?.id || (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json(
          ApiResponseHelper.error('缺少用戶資訊')
        );
      }

      const getFileRequest = {
        fileId: fileId,
        userId: userId,
      };

      const result = await firstValueFrom(
        this.grpcClient.getSecureFile(getFileRequest)
      );

      if (result.success && result.fileData) {
        // 設置適當的 headers
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Length', result.fileSize);
        res.setHeader(
          'Content-Disposition',
          `inline; filename="${result.filename}"`
        );
        
        // 串流檔案
        res.send(Buffer.from(result.fileData));
      } else {
        res.status(404).json(
          ApiResponseHelper.error('檔案不存在或無權限存取')
        );
      }
    } catch (error) {
      console.error('Error getting secure file:', error);
      res.status(500).json(
        ApiResponseHelper.error('獲取檔案失敗')
      );
    }
  }

  // 新增：代理下載 API (基於對話權限)
  @Get('api/files/:fileId/download')
  @UseGuards(JwtAuthGuard)
  async downloadFile(
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      // 從 JWT token 獲取 user ID
      const userId = (req as any).user?.id || (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json(
          ApiResponseHelper.error('缺少用戶資訊')
        );
      }

      // 檢查是否為預覽模式
      const preview = req.query.preview === 'true';

      const downloadRequest = {
        fileId: fileId,
        userId: userId,
        preview: preview,
      };

      const result = await firstValueFrom(
        this.grpcClient.downloadFile(downloadRequest)
      );

      if (result.success && result.fileData) {
        // 設置適當的 headers
        res.setHeader('Content-Type', result.contentType);
        res.setHeader('Content-Length', result.fileSize);
        res.setHeader('Content-Disposition', result.disposition);
        
        // 支援 Cache-Control
        res.setHeader('Cache-Control', 'private, max-age=3600');
        
        // 串流檔案
        res.send(Buffer.from(result.fileData));
      } else {
        res.status(403).json(
          ApiResponseHelper.error(result.message || '檔案不存在或無權限存取')
        );
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      
      // 根據錯誤類型返回不同狀態碼
      if (error.message?.includes('Access denied')) {
        res.status(403).json(
          ApiResponseHelper.error('無權限存取此檔案')
        );
      } else if (error.message?.includes('not found')) {
        res.status(404).json(
          ApiResponseHelper.error('檔案不存在')
        );
      } else {
        res.status(500).json(
          ApiResponseHelper.error('下載檔案失敗')
        );
      }
    }
  }

  // 預覽檔案 API (便利方法)
  @Get('api/files/:fileId/preview')
  @UseGuards(JwtAuthGuard)
  async previewFile(
    @Param('fileId') fileId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // 將 preview=true 設為查詢參數並調用 downloadFile
    req.query.preview = 'true';
    return this.downloadFile(fileId, req, res);
  }

  // 檔案資訊 API
  @Get('api/files/:fileId/info')
  @UseGuards(JwtAuthGuard)
  async getFileInfo(
    @Param('fileId') fileId: string,
    @Req() req: Request,
  ): Promise<ApiResponse> {
    try {
      const result = await firstValueFrom(
        this.grpcClient.getFileInfo({ fileId: fileId })
      );

      if (result.success) {
        return ApiResponseHelper.success(
          {
            fileId: result.fileId,
            originalName: result.originalName,
            contentType: result.contentType,
            fileSize: result.fileSize,
            uploaderId: result.uploaderId,
            conversationId: result.conversationId,
            messageId: result.messageId,
            category: result.category,
            createdAt: result.createdAt,
          },
          '檔案資訊獲取成功'
        );
      } else {
        throw new HttpException(
          ApiResponseHelper.error('檔案不存在'),
          HttpStatus.NOT_FOUND
        );
      }
    } catch (error) {
      this.handleGrpcError(error);
    }
  }

  // 保留舊的 API 作為向後相容
  @Post('upload/profile-picture')
  async updateProfilePicture(@Body() body: { username: string; imageUrl: string }): Promise<ApiResponse> {
    try {
      const result = await firstValueFrom(this.grpcClient.updateProfilePicture(body));
      return ApiResponseHelper.success(result.user, result.message || '頭像更新成功');
    } catch (error) {
      this.handleGrpcError(error);
    }
  }

  // 保留舊的圖片 API 作為向後相容
  @Get('upload/photos/:filename')
  async getPhoto(@Param('filename') filename: string, @Res() res: Response) {
    try {
      const result = await firstValueFrom(this.grpcClient.getPhoto({ filename }));
      if (result.success && result.data) {
        // 設置正確的內容類型
        res.setHeader('Content-Type', result.contentType || 'image/jpeg');
        res.setHeader('Content-Length', result.data.length);
        res.send(Buffer.from(result.data));
      } else {
        res.status(404).json(ApiResponseHelper.error('圖片不存在'));
      }
    } catch (error) {
      console.error('Error getting photo:', error);
      res.status(404).json(ApiResponseHelper.error('圖片不存在'));
    }
  }

  @Get('upload/images/:filename')
  async getImage(@Param('filename') filename: string, @Res() res: Response) {
    try {
      const result = await firstValueFrom(this.grpcClient.getImage({ filename }));
      if (result.success && result.data) {
        // 設置正確的內容類型
        res.setHeader('Content-Type', result.contentType || 'image/png');
        res.setHeader('Content-Length', result.data.length);
        res.send(Buffer.from(result.data));
      } else {
        res.status(404).json(ApiResponseHelper.error('圖片不存在'));
      }
    } catch (error) {
      console.error('Error getting image:', error);
      res.status(404).json(ApiResponseHelper.error('圖片不存在'));
    }
  }

  private handleGrpcError(error: any): never {
    const grpcCode = error.code;
    const message = error.details || error.message || '服務暫時不可用';

    switch (grpcCode) {
      case 3: // INVALID_ARGUMENT
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.BAD_REQUEST);
      case 16: // UNAUTHENTICATED
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.UNAUTHORIZED);
      case 6: // ALREADY_EXISTS
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.CONFLICT);
      case 5: // NOT_FOUND
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.NOT_FOUND);
      case 13: // INTERNAL
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.INTERNAL_SERVER_ERROR);
      default:
        throw new HttpException(ApiResponseHelper.error(message), HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
} 