import { Controller, Logger } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { MinioService } from './minio/minio.service';
import { ChatClientService } from './chat-client/chat-client.service';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';
import { Readable } from 'stream';

@Controller()
export class FileController {
  private readonly logger = new Logger(FileController.name);
  private readonly apiGatewayUrl = process.env.API_GATEWAY_URL || 'http://localhost:3050';


  constructor(
    private readonly minioService: MinioService,
    private readonly chatClientService: ChatClientService,
  ) {}

  @GrpcMethod('FileService', 'RequestUpload')
  async requestUpload(data: {
    filename: string;
    fileSize: number;
    contentType: string;
    uploaderId: string;
    conversationId?: string;
    messageId?: string;
    category?: string;
  }) {
    try {
      console.log('File Service received RequestUpload:', {
        filename: data.filename,
        fileSize: data.fileSize,
        contentType: data.contentType,
        uploaderId: data.uploaderId,
        conversationId: data.conversationId,
        messageId: data.messageId,
        category: data.category
      });

      const result = await this.minioService.generatePresignedUploadUrl(
        data.filename,
        data.fileSize,
        data.contentType,
        data.uploaderId,
        {
          conversationId: data.conversationId,
          messageId: data.messageId,
          category: data.category || 'general',
        }
      );

      this.logger.log(
        `Presigned upload URL requested: ${data.filename} -> ${result.fileId}`
      );

      return {
        success: true,
        message: 'Upload URL generated successfully',
        fileId: result.fileId,
        uploadUrl: result.uploadUrl,
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      this.logger.error(`Failed to generate upload URL for ${data.filename}`, error);
      throw new RpcException('Failed to generate upload URL');
    }
  }

  @GrpcMethod('FileService', 'ConfirmUpload')
  async confirmUpload(data: {
    fileId: string;
    uploaderId: string;
  }) {
    try {
      console.log('File Service received ConfirmUpload:', {
        fileId: data.fileId,
        uploaderId: data.uploaderId
      });

      const result = await this.minioService.confirmFileUpload(
        data.fileId,
        data.uploaderId
      );

      this.logger.log(
        `File upload confirmed: ${result.fileId} (${result.fileSize} bytes)`
      );

      return {
        success: true,
        message: 'File upload confirmed successfully',
        fileId: result.fileId,
        fileUrl: `${this.apiGatewayUrl}/api/files/${result.fileId}/download`,
        fileSize: result.fileSize,
        contentType: result.contentType,
        // 原始名稱將由mongodb處理
      };
    } catch (error) {
      this.logger.error(`Failed to confirm upload for ${data.fileId}`, error);
      throw new RpcException('Failed to confirm upload');
    }
  }

  // 保留向後相容
  @GrpcMethod('FileService', 'UploadSecureFile')
  async uploadSecureFile(data: {
    filename: string;
    data: Buffer;
    contentType: string;
    uploaderId: string;
    conversationId?: string;
    messageId?: string;
    category?: string;
  }) {
    try {
      console.log('File Service received gRPC request:', {
        filename: data.filename,
        dataLength: data.data?.length,
        contentType: data.contentType,
        uploaderId: data.uploaderId,
        conversationId: data.conversationId,
        messageId: data.messageId,
        category: data.category
      });
      const result = await this.minioService.uploadSecureFile(
        data.data,
        data.filename,
        data.contentType,
        data.uploaderId,
        {
          conversationId: data.conversationId,
          messageId: data.messageId,
          category: data.category || 'general',
        }
      );

      this.logger.log(
        `Secure file uploaded: ${data.filename} -> ${result.fileId}`,
      );

      return {
        success: true,
        message: 'File uploaded successfully',
        fileId: result.fileId,
        fileUrl: `${this.apiGatewayUrl}/api/files/${result.fileId}/download`,
        fileSize: result.fileSize,
        contentType: result.contentType,
        // 原始名稱將由mongodb處理
      };
    } catch (error) {
      this.logger.error(`Failed to upload secure file ${data.filename}`, error);
      throw new RpcException('Failed to upload file');
    }
  }

  @GrpcMethod('FileService', 'GetSecureFile')
  async getSecureFile(data: {
    fileId: string;
    userId: string;
  }) {
    try {
      const fileData = await this.minioService.getFileWithPermission(
        data.fileId,
        data.userId
      );

      // 將 Readable stream 轉換為 Buffer
      const chunks: Buffer[] = [];
      for await (const chunk of fileData.stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      return {
        success: true,
        message: 'File retrieved successfully',
        fileData: buffer,
        contentType: fileData.contentType,
        filename: fileData.fileName,
        fileSize: fileData.fileSize,
      };
    } catch (error) {
      this.logger.error(`Failed to get secure file ${data.fileId}`, error);
      throw new RpcException('File not found or access denied');
    }
  }

  @GrpcMethod('FileService', 'CheckFilePermission')
  async checkFilePermission(data: {
    fileId: string;
    userId: string;
  }) {
    try {
      const hasPermission = await this.minioService.checkFilePermission(
        data.fileId,
        data.userId
      );

      return {
        success: true,
        hasPermission: hasPermission,
      };
    } catch (error) {
      this.logger.error(`Failed to check permission for file ${data.fileId}`, error);
      return {
        success: false,
        hasPermission: false,
      };
    }
  }

  @GrpcMethod('FileService', 'GetFileInfo')
  async getFileInfo(data: {
    fileId: string;
  }) {
    try {
      const fileInfo = await this.minioService.getFileInfo(data.fileId);

      if (!fileInfo) {
        throw new RpcException('File not found');
      }

      return {
        success: true,
        fileId: fileInfo.fileId,
        originalName: fileInfo.originalName,
        contentType: fileInfo.contentType,
        fileSize: fileInfo.fileSize,
        uploaderId: fileInfo.uploaderId,
        conversationId: fileInfo.conversationId,
        messageId: fileInfo.messageId,
        category: fileInfo.category,
        createdAt: (fileInfo as any).createdAt?.toISOString() || (fileInfo as any).updatedAt?.toISOString(),
      };
    } catch (error) {
      this.logger.error(`Failed to get file info ${data.fileId}`, error);
      throw new RpcException('File not found');
    }
  }

  @GrpcMethod('FileService', 'DownloadFile')
  async downloadFile(data: {
    fileId: string;
    userId: string;
    preview?: boolean;
  }) {
    try {
      this.logger.log(`Download request: fileId=${data.fileId}, userId=${data.userId}, preview=${data.preview}`);

      // Step 1: 根據 fileId 查詢檔案資訊
      const fileInfo = await this.minioService.getFileInfo(data.fileId);
      if (!fileInfo) {
        throw new RpcException('File not found');
      }

      // Step 2: 檢查用戶是否在對話中 (如果有 conversationId)
      if (fileInfo.conversationId) {
        const permissionCheck = await this.chatClientService.checkUserInConversation(
          data.userId,
          fileInfo.conversationId
        );

        if (!permissionCheck.success || !permissionCheck.hasAccess) {
          this.logger.warn(`Access denied: userId=${data.userId}, conversationId=${fileInfo.conversationId}`);
          throw new RpcException('Access denied: You are not a member of this conversation');
        }
      } else {
        // 如果沒有 conversationId，檢查是否為檔案上傳者
        if (fileInfo.uploaderId !== data.userId) {
          this.logger.warn(`Access denied: userId=${data.userId}, uploaderId=${fileInfo.uploaderId}`);
          throw new RpcException('Access denied: You can only access your own files');
        }
      }

      // Step 3: 從 MinIO 取得檔案流（權限檢查已在上面完成）
      const fileData = await this.minioService.getFileStream(
        data.fileId
      );

      // Step 4: 將 Readable stream 轉換為 Buffer
      const chunks: Buffer[] = [];
      for await (const chunk of fileData.stream) {
        chunks.push(chunk);
      }
      const buffer = Buffer.concat(chunks);

      // Step 5: 設定 Content-Disposition
      const disposition = data.preview 
        ? `inline; filename="${fileInfo.originalName}"`
        : `attachment; filename="${fileInfo.originalName}"`;

      this.logger.log(`File downloaded successfully: ${data.fileId} (${buffer.length} bytes)`);

      return {
        success: true,
        message: 'File downloaded successfully',
        fileData: buffer,
        contentType: fileInfo.contentType,
        filename: fileInfo.originalName,
        fileSize: buffer.length,
        disposition: disposition,
      };
    } catch (error) {
      this.logger.error(`Failed to download file ${data.fileId}:`, error);
      
      if (error instanceof RpcException) {
        throw error;
      }
      
      throw new RpcException('Failed to download file');
    }
  }

  // 保留原有方法作為向後相容
  @GrpcMethod('FileService', 'UploadFile')
  async uploadFile(data: {
    filename: string;
    data: Buffer;
    content_type: string;
    context_prefix?: string;
  }) {
    // Generate a unique object name to avoid collisions
    const originalName = data.filename;
    const randomName = `${uuidv4()}${extname(originalName)}`;
    const objectName = data.context_prefix
      ? `${data.context_prefix.replace(/\/$/, '')}/${randomName}` // Remove trailing slash if exists
      : randomName;

    try {
      await this.minioService.uploadFile(
        objectName,
        data.data,
        data.content_type,
      );

      // The URL returned points to the API gateway, which will proxy the request.
      // The objectName now contains the full path (prefix + filename).
      const fileUrl = `${this.apiGatewayUrl}/files/${objectName}`;

      this.logger.log(
        `File ${originalName} uploaded as ${objectName}, URL: ${fileUrl}`,
      );

      return {
        success: true,
        message: 'File uploaded successfully',
        file_url: fileUrl,
      };
    } catch (error) {
      this.logger.error(`Failed to upload file ${originalName}`, error);
      throw new RpcException('Failed to upload file');
    }
  }

  @GrpcMethod('FileService', 'GetFileUrl')
  async getFileUrl(data: { filename: string }) {
    // The filename here is expected to be the full object name, including any prefixes.
    try {
      const url = await this.minioService.getPresignedUrl(data.filename);
      return {
        success: true,
        message: 'Presigned URL generated successfully',
        url: url,
      };
    } catch (error) {
      this.logger.error(`Failed to get presigned URL for ${data.filename}`, error);
      throw new RpcException('File not found or access denied');
    }
  }
} 