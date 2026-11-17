import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as Minio from 'minio';
import { v4 as uuidv4 } from 'uuid';
import { extname } from 'path';
import { FileRecord, FileDocument } from '../schemas/file.schema';
import { Readable } from 'stream';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private minioClient: Minio.Client;
  // 產生 presigned URL 專用：S3 簽名包含 host，必須用「瀏覽器實際連的位址」簽，
  // 不能用內部位址（minio:9000）簽完再換 host，否則 MinIO 會回 SignatureDoesNotMatch。
  private presignClient: Minio.Client;
  private readonly bucketName: string;

  constructor(
    private configService: ConfigService,
    @InjectModel(FileRecord.name) private fileModel: Model<FileDocument>,
  ) {
    const { endPoint, port, useSSL } = this.parseMinioEndpoint();
    
    this.minioClient = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey: this.configService.get<string>('MINIO_ACCESS_KEY') || '',
      secretKey: this.configService.get<string>('MINIO_SECRET_KEY') || '',
      pathStyle: true, // 支援 path-style URLs，適用於 nginx 代理
    });
    this.presignClient = this.createPresignClient() ?? this.minioClient;
    this.bucketName = this.configService.get<string>('MINIO_BUCKET_NAME') || 'files';
  }

  /**
   * 解析 MinIO 內部連接配置 (用於服務初始化和管理操作)
   * 優先順序：MINIO_SERVER_URL > MINIO_ENDPOINT + MINIO_PORT
   */
  private parseMinioEndpoint(): { endPoint: string; port: number; useSSL: boolean } {
    // 1. 優先使用 MINIO_SERVER_URL (向後相容)
    const minioServerUrl = this.configService.get<string>('MINIO_SERVER_URL');
    if (minioServerUrl) {
      try {
        const url = new URL(minioServerUrl);
        const useSSL = url.protocol === 'https:';
        const port = parseInt(url.port) || (useSSL ? 443 : 80);
        
        this.logger.log(`Using internal connection - MINIO_SERVER_URL: ${minioServerUrl}`);
        return { 
          endPoint: url.hostname, 
          port, 
          useSSL 
        };
      } catch (error) {
        this.logger.warn(`Invalid MINIO_SERVER_URL: ${minioServerUrl}, falling back to legacy config`);
      }
    }

    // 2. 回退到傳統配置 (內部連接)
    const endPoint = this.configService.get<string>('MINIO_ENDPOINT') || 'localhost';
    const port = parseInt(this.configService.get<string>('MINIO_PORT') || '9000');
    const useSSL = this.configService.get<string>('MINIO_USE_SSL') === 'true';
    
    this.logger.log(`Using internal connection - legacy config: ${endPoint}:${port} (SSL: ${useSSL})`);
    return { endPoint, port, useSSL };
  }

  /**
   * 以 MINIO_PUBLIC_ENDPOINT 的 host 建立簽名用 client。
   * 只用來離線計算簽名、不會真的連線（指定 region 就不會去查 bucket region）。
   * 公開端點帶路徑前綴（例如 https://im.example.com/minio）時，前綴由 convertToPublicUrl 補上，
   * 反向代理需保留原始 Host 並去掉前綴（見 nginx/im.example.conf）。
   */
  private createPresignClient(): Minio.Client | undefined {
    const publicEndpoint = this.configService.get<string>('MINIO_PUBLIC_ENDPOINT');
    if (!publicEndpoint) return undefined;
    try {
      const url = new URL(publicEndpoint);
      const useSSL = url.protocol === 'https:';
      return new Minio.Client({
        endPoint: url.hostname,
        port: parseInt(url.port) || (useSSL ? 443 : 80),
        useSSL,
        accessKey: this.configService.get<string>('MINIO_ACCESS_KEY') || '',
        secretKey: this.configService.get<string>('MINIO_SECRET_KEY') || '',
        pathStyle: true,
        region: 'us-east-1',
      });
    } catch {
      this.logger.warn(`Invalid MINIO_PUBLIC_ENDPOINT: ${publicEndpoint}, presigned URLs use the internal endpoint`);
      return undefined;
    }
  }

  /**
   * 獲取公開端點配置 (用於生成 presigned URLs)
   */
  private getPublicEndpoint(): { publicUrl?: string; shouldReplace: boolean } {
    const publicEndpoint = this.configService.get<string>('MINIO_PUBLIC_ENDPOINT');
    
    if (publicEndpoint) {
      try {
        new URL(publicEndpoint); // 驗證 URL 格式
        this.logger.log(`Using public endpoint for presigned URLs: ${publicEndpoint}`);
        return { 
          publicUrl: publicEndpoint,
          shouldReplace: true 
        };
      } catch (error) {
        this.logger.warn(`Invalid MINIO_PUBLIC_ENDPOINT: ${publicEndpoint}, using internal URLs`);
      }
    }
    
    return { shouldReplace: false };
  }

  /**
   * 將內部 presigned URL 轉換為外部 URL
   */
  private convertToPublicUrl(internalUrl: string): string {
    const { publicUrl, shouldReplace } = this.getPublicEndpoint();
    
    if (!shouldReplace || !publicUrl) {
      return internalUrl;
    }

    try {
      const publicUrlObj = new URL(publicUrl);
      const internalUrlObj = new URL(internalUrl);
      
      // 組合公開端點的路徑前綴 + 內部 URL 的路徑 + 查詢參數
      const publicPath = publicUrlObj.pathname.endsWith('/') ? publicUrlObj.pathname.slice(0, -1) : publicUrlObj.pathname;
      const combinedPath = publicPath + internalUrlObj.pathname + internalUrlObj.search;
      
      const convertedUrl = new URL(combinedPath, publicUrlObj.origin);
      
      this.logger.debug(`Converted URL: ${internalUrl} -> ${convertedUrl.toString()}`);
      return convertedUrl.toString();
    } catch (error) {
      this.logger.warn(`Failed to convert URL: ${internalUrl}, returning original`);
      return internalUrl;
    }
  }

  async onModuleInit() {
    await this.ensureBucketExists();
    this.logger.log(`MinIO client initialized with pathStyle: true for nginx proxy compatibility`);
  }

  private async ensureBucketExists() {
    try {
      const bucketExists = await this.minioClient.bucketExists(this.bucketName);
      if (!bucketExists) {
        this.logger.log(`Bucket "${this.bucketName}" does not exist. Creating it...`);
        await this.minioClient.makeBucket(this.bucketName, 'us-east-1'); // region is mandatory but not used by MinIO server
        this.logger.log(`Bucket "${this.bucketName}" created successfully.`);
        
        // 不設置公開政策，所有檔案需要權限驗證

      } else {
        this.logger.log(`Bucket "${this.bucketName}" already exists.`);
      }
    } catch (err) {
      this.logger.error('Error in MinIO bucket setup:', err);
      throw err; // Propagate error to stop the service from starting in a bad state
    }
  }

  /**
   * 清理檔案名稱，移除可能造成問題的特殊字符
   */
  private sanitizeFilename(filename: string): string {
    // 保留檔名和副檔名，但清理特殊字符
    const sanitized = filename
      .replace(/[^\w\-_. ]/g, '_')  // 替換特殊字符為底線
      .replace(/\s+/g, '_')        // 替換空格為底線
      .replace(/_{2,}/g, '_');     // 合併多個底線
    
    return sanitized;
  }


  /**
   * 生成預簽名上傳 URL - 新的統一上傳方式
   */
  async generatePresignedUploadUrl(
    originalName: string,
    fileSize: number,
    contentType: string,
    uploaderId: string,
    options?: {
      conversationId?: string;
      messageId?: string;
      category?: string;
    }
  ): Promise<{ 
    fileId: string; 
    uploadUrl: string; 
    expiresAt: string;
    minioObjectName: string;
  }> {
    // 生成安全的檔案 ID 和 MinIO 物件名稱
    const fileId = uuidv4();
    const fileExtension = extname(originalName);
    const minioObjectName = `${options?.category || 'general'}/${fileId}${fileExtension}`;
    
    // 清理檔案名稱以避免 MinIO 簽名問題
    const sanitizedOriginalName = this.sanitizeFilename(originalName);
    
    try {
      // 生成預簽名上傳 URL（有效期1小時）
      const expiry = 60 * 60; // 1 小時
      const internalUploadUrl = await this.presignClient.presignedPutObject(
        this.bucketName,
        minioObjectName,
        expiry
      );
      
      const uploadUrl = this.convertToPublicUrl(internalUploadUrl);

      // 預先建立資料庫記錄（狀態：pending）
      console.log('Creating pending FileRecord with:', {
        fileId,
        minioObjectName,
        originalName: sanitizedOriginalName,
        contentType,
        fileSize,
        uploaderId,
        conversationId: options?.conversationId,
        messageId: options?.messageId,
        category: options?.category || 'general',
        status: 'pending'
      });
      
      const fileRecord = new this.fileModel({
        fileId,
        minioObjectName,
        originalName: sanitizedOriginalName,
        contentType,
        fileSize,
        uploaderId,
        conversationId: options?.conversationId,
        messageId: options?.messageId,
        category: options?.category || 'general',
        status: 'pending', // 新增狀態欄位
      });

      await fileRecord.save();

      const expiresAt = new Date(Date.now() + expiry * 1000).toISOString();

      this.logger.log(
        `Presigned upload URL generated: ${sanitizedOriginalName} -> ${fileId} (expires: ${expiresAt})`
      );

      return { 
        fileId, 
        uploadUrl,
        expiresAt,
        minioObjectName
      };
    } catch (err) {
      this.logger.error(`Error generating presigned upload URL for ${originalName}:`, err);
      throw err;
    }
  }

  /**
   * 確認檔案上傳完成並更新狀態
   */
  async confirmFileUpload(
    fileId: string,
    uploaderId: string
  ): Promise<{
    fileId: string;
    fileSize: number;
    contentType: string;
    minioObjectName: string;
  }> {
    try {
      // 查找並驗證檔案記錄
      const fileRecord = await this.fileModel.findOne({ 
        fileId, 
        uploaderId,
        status: 'pending'
      });

      if (!fileRecord) {
        throw new Error('File record not found or already confirmed');
      }

      // 驗證檔案在 MinIO 中確實存在
      const stat = await this.minioClient.statObject(this.bucketName, fileRecord.minioObjectName);
      
      // 更新檔案記錄狀態和實際大小
      fileRecord.status = 'completed';
      fileRecord.fileSize = stat.size; // 使用實際檔案大小
      await fileRecord.save();

      this.logger.log(
        `File upload confirmed: ${fileRecord.originalName} -> ${fileId} (${stat.size} bytes)`
      );

      return {
        fileId,
        fileSize: stat.size,
        contentType: fileRecord.contentType,
        minioObjectName: fileRecord.minioObjectName,
      };
    } catch (err) {
      this.logger.error(`Error confirming file upload for ${fileId}:`, err);
      throw err;
    }
  }

  /**
   * 安全檔案上傳 - 生成 UUID 檔案 ID 並建立資料庫記錄（保留向後相容）
   */
  async uploadSecureFile(
    buffer: Buffer,
    originalName: string,
    contentType: string,
    uploaderId: string,
    options?: {
      conversationId?: string;
      messageId?: string;
      category?: string;
    }
  ): Promise<{ fileId: string; minioObjectName: string; fileSize: number; originalName: string; contentType: string }> {
    // 生成安全的檔案 ID 和 MinIO 物件名稱
    const fileId = uuidv4();
    const fileExtension = extname(originalName);
    const minioObjectName = `${options?.category || 'general'}/${fileId}${fileExtension}`;

    // 清理檔案名稱以避免 MinIO 簽名問題
    const sanitizedOriginalName = this.sanitizeFilename(originalName);
    
    const metaData = {
      'Content-Type': contentType,
      'Original-Name': sanitizedOriginalName,
      'Uploader-Id': uploaderId,
    };

    try {
      // 上傳到 MinIO
      await this.minioClient.putObject(
        this.bucketName,
        minioObjectName,
        buffer,
        buffer.length,
        metaData
      );

      // 建立資料庫記錄
      console.log('Creating FileRecord with:', {
        fileId,
        minioObjectName,
        originalName,
        contentType,
        fileSize: buffer.length,
        uploaderId,
        conversationId: options?.conversationId,
        messageId: options?.messageId,
        category: options?.category || 'general',
      });
      
      const fileRecord = new this.fileModel({
        fileId,
        minioObjectName,
        originalName,
        contentType,
        fileSize: buffer.length,
        uploaderId,
        conversationId: options?.conversationId,
        messageId: options?.messageId,
        category: options?.category || 'general',
      });

      await fileRecord.save();

      this.logger.log(
        `Secure file uploaded: ${originalName} -> ${fileId} (${minioObjectName})`
      );

      return { 
        fileId, 
        minioObjectName,
        fileSize: buffer.length,
        originalName: sanitizedOriginalName,
        contentType 
      };
    } catch (err) {
      this.logger.error(`Error uploading secure file ${originalName}:`, err);
      throw err;
    }
  }

  /**
   * 獲取檔案流 - 不進行權限檢查，依賴 Controller 層的權限驗證
   */
  async getFileStream(
    fileId: string
  ): Promise<{ stream: Readable; contentType: string; fileName: string; fileSize: number }> {
    try {
      // 查詢檔案記錄
      const fileRecord = await this.fileModel.findOne({ 
        fileId, 
        isActive: true 
      }).exec();

      if (!fileRecord) {
        throw new Error('File not found');
      }

      // 從 MinIO 獲取檔案流（不進行權限檢查，依賴 Controller 層）
      const stream = await this.minioClient.getObject(
        this.bucketName,
        fileRecord.minioObjectName
      );

      this.logger.log(`File stream accessed: ${fileId}`);

      return {
        stream,
        contentType: fileRecord.contentType,
        fileName: fileRecord.originalName,
        fileSize: fileRecord.fileSize,
      };
    } catch (err) {
      this.logger.error(`Error getting file stream ${fileId}:`, err);
      throw err;
    }
  }

  /**
   * 權限驗證檔案存取 - 檢查用戶權限後返回檔案流 (保留向後相容)
   * @deprecated 使用 getFileStream 替代，權限檢查應在 Controller 層進行
   */
  async getFileWithPermission(
    fileId: string,
    userId: string
  ): Promise<{ stream: Readable; contentType: string; fileName: string; fileSize: number }> {
    try {
      // 查詢檔案記錄
      const fileRecord = await this.fileModel.findOne({ 
        fileId, 
        isActive: true 
      }).exec();

      if (!fileRecord) {
        throw new Error('File not found');
      }

      // 檢查基本權限 (暫時只檢查上傳者)
      const hasPermission = await this.checkFilePermission(fileId, userId);
      if (!hasPermission) {
        throw new Error('Access denied');
      }

      // 從 MinIO 獲取檔案流
      const stream = await this.minioClient.getObject(
        this.bucketName,
        fileRecord.minioObjectName
      );

      this.logger.log(`File accessed: ${fileId} by user ${userId}`);

      return {
        stream,
        contentType: fileRecord.contentType,
        fileName: fileRecord.originalName,
        fileSize: fileRecord.fileSize,
      };
    } catch (err) {
      this.logger.error(`Error getting file ${fileId}:`, err);
      throw err;
    }
  }

  /**
   * 檢查檔案權限
   */
  async checkFilePermission(fileId: string, userId: string): Promise<boolean> {
    try {
      const fileRecord = await this.fileModel.findOne({ 
        fileId, 
        isActive: true 
      }).exec();

      if (!fileRecord) {
        return false;
      }

      // 基本權限檢查：上傳者可以存取
      if (fileRecord.uploaderId === userId) {
        return true;
      }

      // 如果有 conversationId，可以在這裡添加對話成員檢查
      // 目前簡化版本只允許上傳者存取
      // TODO: 後續可以添加對話成員檢查邏輯

      return false;
    } catch (err) {
      this.logger.error(`Error checking file permission ${fileId}:`, err);
      return false;
    }
  }

  /**
   * 獲取檔案資訊（不含檔案內容）
   */
  async getFileInfo(fileId: string): Promise<FileDocument | null> {
    try {
      return await this.fileModel.findOne({ 
        fileId, 
        isActive: true 
      }).exec();
    } catch (err) {
      this.logger.error(`Error getting file info ${fileId}:`, err);
      return null;
    }
  }

  // 保留原有方法作為向後相容
  async uploadFile(fileName: string, buffer: Buffer, contentType: string): Promise<any> {
    const metaData = {
      'Content-Type': contentType,
    };
    try {
      const result = await this.minioClient.putObject(this.bucketName, fileName, buffer, buffer.length, metaData);
      this.logger.log(`File ${fileName} uploaded successfully. ETag: ${result.etag}`);
      return result;
    } catch (err) {
      this.logger.error(`Error uploading file ${fileName}:`, err);
      throw err;
    }
  }

  async getPresignedUrl(fileName: string): Promise<string> {
    try {
      // 7 days expiry for the presigned URL
      const internalUrl = await this.presignClient.presignedGetObject(this.bucketName, fileName, 7 * 24 * 60 * 60);
      
      const url = this.convertToPublicUrl(internalUrl);
      
      this.logger.log(`Generated presigned URL for ${fileName}`);
      return url;
    } catch (err) {
      this.logger.error(`Error generating presigned URL for ${fileName}:`, err);
      throw err;
    }
  }

  get client(): Minio.Client {
    return this.minioClient;
  }
} 