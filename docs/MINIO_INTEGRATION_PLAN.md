# MinIO 整合計畫 - 安全檔案存取設計

## 核心安全概念 (即時通訊系統)

本即時通訊系統採用**完全隱私保護**的檔案存取架構：

### 安全檔案存取設計原則
- **不直接暴露 MinIO URL**：所有圖片/語音 URL 不直接暴露 MinIO 的物件 URL
- **API Gateway 代理存取**：前端請求透過 `/files/:fileId` API，後端驗證權限後串流檔案
- **權限驗證機制**：驗證用戶身分是否為訊息的合法接收者/聊天室成員
- **安全檔案 ID**：使用 UUID 作為檔案標識符，與 MinIO 物件名稱分離

### 隱私保護機制
1. **檔案訪問控制**：每個檔案訪問都需要經過用戶權限驗證
2. **會話驗證**：確認用戶為聊天室成員或私聊參與者
3. **安全串流**：通過 API Gateway 安全串流檔案，不暴露實際存儲路徑

## 1. 總體設計思路

為了在專案中整合MinIO來處理非文字訊息（如圖片、文件等），我們將遵循現有的微服務架構。核心思想是，**前端不直接與MinIO進行通訊**。所有檔案的上傳請求都將透過`api-gateway`，路由到一個專門的`file-service`，由該服務負責與MinIO互動並將檔案存入儲存桶（Bucket）。

這樣做有幾個好處：
* **安全性**：MinIO的存取金鑰（Access Key & Secret Key）不會暴露在前端，降低了安全風險。
* **統一性**：所有外部請求都由`api-gateway`統一處理，符合現有架構。
* **可控性**：後端可以對上傳的檔案進行驗證、大小限制等處理。
* **隱私保護**：檔案存取需要權限驗證，保護用戶隱私。

### 安全檔案存取流程：

#### 檔案上傳流程：
1.  **前端**：使用者選擇檔案後，將檔案（以`multipart/form-data`形式）上傳到 `api-gateway` 的特定端點（例如：`/api/files/upload`）。
2.  **API Gateway**：驗證用戶身份後，將檔案轉發給 `file-service`。
3.  **File Service**：
    * 接收到來自`api-gateway`的檔案資料。
    * 生成安全的檔案 ID（UUID）。
    * 使用MinIO SDK將檔案上傳到指定的儲存桶，物件名稱使用 UUID。
    * 在 MongoDB 建立檔案記錄，包含檔案 ID、MinIO 物件名稱、上傳者等資訊。
    * 回傳安全的檔案 ID 給前端（不是 MinIO URL）。
4.  **前端**：取得檔案 ID 後，將訊息（包含`fileId`和`fileType`）透過WebSocket傳送。
5.  **訊息存儲**：將檔案 ID 存入訊息記錄，建立訊息與檔案的關聯。

#### 檔案存取流程：
1.  **前端**：請求檔案時使用 `/files/:fileId` API。
2.  **API Gateway**：
    * 驗證用戶身份（JWT token）。
    * 查詢檔案所屬的訊息/對話。
    * 驗證用戶是否為該對話成員。
3.  **權限驗證通過**：直接串流檔案給用戶（或使用 HTTP redirect）。
4.  **權限驗證失敗**：回傳 403 Forbidden。

---

## 目前進度追蹤 (2025-01-29)

### 已完成項目 (70%)

#### 基礎設施 (100% 完成)
- Docker Compose 配置 MinIO 服務
- 環境變數設置（開發/生產環境）
- MinIO 服務容器化部署
- 網路配置和健康檢查

#### File Service 核心功能 (80% 完成)
- MinIO 客戶端服務實現 (`minio.service.ts`)
- 基本檔案上傳功能 (`file.controller.ts`)
- gRPC 介面定義和實現
- 檔案 URL 生成機制
- 錯誤處理和日誌記錄

#### API Gateway 整合 (60% 完成)
- HTTP 到 gRPC 的檔案上傳代理
- **缺少**：安全檔案存取 API (`/files/:fileId`)
- **缺少**：用戶權限驗證機制

### 進行中項目 (20%)

#### 安全檔案存取系統 (0% 完成)
- **待實現**：檔案權限驗證服務
- **待實現**：檔案與訊息關聯機制
- **待實現**：安全檔案串流 API
- **待實現**：檔案 ID 與 MinIO 物件映射

### 待開始項目 (10%)

#### 資料庫 Schema 更新 (0% 完成)
- **待實現**：檔案記錄 Schema
- **待實現**：訊息與檔案關聯 Schema
- **待實現**：權限查詢優化

#### 前端整合 (0% 完成)
- **待實現**：檔案上傳 UI 組件
- **待實現**：安全檔案顯示組件
- **待實現**：權限錯誤處理

### 下一步優先任務
1. **實現安全檔案存取 API** - 核心安全機制
2. **建立檔案權限驗證服務** - 保護用戶隱私
3. **更新訊息 Schema** - 支持檔案關聯
4. **實現檔案串流機制** - 安全檔案傳輸

---

## 2. 具體實施步驟

### Phase 1: 基礎設施設定 (Docker & MinIO) 已完成

1.  **更新 `docker-compose.yml`**

    在 `docker-compose.yml` 中新增 `minio` 服務：

    ```yaml
    services:
      # ... 其他現有服務 ...

      minio:
        image: minio/minio:RELEASE.2025-05-24T17-08-30Z
        container_name: minio
        command: server /data --console-address ":9001"
        ports:
          - "9000:9000" # MinIO API
          - "9001:9001" # MinIO Console
        environment:
          - MINIO_ROOT_USER=${MINIO_ROOT_USER}
          - MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}
        volumes:
          - minio_data:/data
        networks:
          - my_network # 請確保與您的後端服務在同一個network

    volumes:
      # ... 其他現有volumes ...
      minio_data:
    ```

2.  **更新環境變數 (`.env`)**

    在您的 `.env` 檔案和 `env.example` 檔案中加入MinIO的設定。**請告訴我您想設定的帳號密碼，我會提供對應的內容給您貼上。**

    ```ini
    # .env
    MINIO_ROOT_USER=your_minio_user
    MINIO_ROOT_PASSWORD=your_minio_password
    MINIO_ENDPOINT=minio
    MINIO_PORT=9000
    MINIO_USE_SSL=false
    MINIO_BUCKET_NAME=messages
    ```

### Phase 2: 安全檔案服務實現 進行中

#### 2.0 安全檔案 Schema 設計

新增檔案記錄 Schema (`services/file-service/src/schemas/file.schema.ts`)：

```typescript
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FileDocument = HydratedDocument<File>;

@Schema({ timestamps: true })
export class File {
  @Prop({ required: true, unique: true })
  fileId: string; // UUID - 前端使用的安全檔案 ID

  @Prop({ required: true })
  minioObjectName: string; // MinIO 實際物件名稱

  @Prop({ required: true })
  originalName: string; // 原始檔案名稱

  @Prop({ required: true })
  contentType: string; // MIME type

  @Prop({ required: true })
  fileSize: number; // 檔案大小

  @Prop({ required: true })
  uploaderId: string; // 上傳者用戶 ID

  @Prop({ required: true })
  messageId: string; // 關聯的訊息 ID

  @Prop({ required: true })
  conversationId: string; // 關聯的對話 ID

  @Prop({ default: true })
  isActive: boolean; // 檔案是否有效
}

export const FileSchema = SchemaFactory.createForClass(File);
```

#### 2.1 `file-service` - 安全檔案管理

這是處理檔案上傳的核心服務。

1.  **安裝MinIO套件**

    ```bash
    # 進入 file-service 目錄
    cd services/file-service
    pnpm add minio
    ```

2.  **更新`file.proto`**

    我們需要定義gRPC的介面，讓`api-gateway`可以傳遞檔案。

    `services/protos/file.proto`:

    ```protobuf
    syntax = "proto3";

    package file;

    service FileService {
      rpc UploadFile (UploadFileRequest) returns (UploadFileResponse);
    }

    message UploadFileRequest {
      bytes file_data = 1;
      string filename = 2;
      string mimetype = 3;
    }

    message UploadFileResponse {
      string url = 1;
      string fileType = 2;
    }
    ```

3.  **實現安全檔案服務** 已部分完成

    當前 `minio.service.ts` 已實現基本功能，需要增強安全性：

    **新增安全檔案管理方法**：
    ```typescript
    // 安全檔案上傳 - 生成 UUID 檔案 ID
    async uploadSecureFile(fileData: Buffer, originalName: string, contentType: string, uploaderId: string): Promise<string>
    
    // 權限驗證檔案存取
    async getFileWithPermission(fileId: string, userId: string): Promise<{ stream: Readable, contentType: string }>
    
    // 檔案權限檢查
    async checkFilePermission(fileId: string, userId: string): Promise<boolean>
    ```

4.  **更新 `file.controller.ts`** 需要增強

    當前控制器已實現基本上傳功能，需要新增安全存取方法：

    **新增安全檔案存取 gRPC 方法**：
    ```typescript
    @GrpcMethod('FileService', 'GetSecureFile')
    async getSecureFile(data: {
      fileId: string;
      userId: string;
    }) {
      // 驗證用戶權限
      // 返回檔案串流或錯誤
    }
    
    @GrpcMethod('FileService', 'VerifyFilePermission')
    async verifyFilePermission(data: {
      fileId: string;
      userId: string;
    }) {
      // 檢查用戶是否有權限存取檔案
    }
    ```

#### 2.2 `api-gateway` - 安全檔案存取 API

1.  **實現安全檔案存取 API** 待實現

    在 `services/api-gateway/src/controllers/file.controller.ts` 中新增：

    **安全檔案存取端點**：
    ```typescript
    @Get('/files/:fileId')
    @UseGuards(AuthGuard) // JWT 驗證
    async getSecureFile(
      @Param('fileId') fileId: string,
      @Req() req: Request,
      @Res() res: Response,
    ) {
      const userId = req.user.id;
      
      // 1. 驗證用戶權限
      const hasPermission = await this.fileService.verifyFilePermission({ fileId, userId });
      if (!hasPermission) {
        throw new ForbiddenException('無權限存取此檔案');
      }
      
      // 2. 獲取並串流檔案
      const fileStream = await this.fileService.getSecureFile({ fileId, userId });
      
      // 3. 設置適當的 headers 並串流檔案
      res.setHeader('Content-Type', fileStream.contentType);
      fileStream.stream.pipe(res);
    }
    ```

    **檔案上傳端點增強**：
    ```typescript
    @Post('/files/upload')
    @UseGuards(AuthGuard)
    @UseInterceptors(FileInterceptor('file'))
    async uploadFile(
      @UploadedFile() file: Express.Multer.File,
      @Body() body: { conversationId: string, messageId?: string },
      @Req() req: Request,
    ) {
      const userId = req.user.id;
      
      // 驗證用戶是否為對話成員
      await this.chatService.verifyConversationMember({ 
        conversationId: body.conversationId, 
        userId 
      });
      
      // 上傳檔案並建立關聯
      const result = await this.fileService.uploadSecureFile({
        fileData: file.buffer,
        originalName: file.originalname,
        contentType: file.mimetype,
        uploaderId: userId,
        conversationId: body.conversationId,
        messageId: body.messageId,
      });
      
      return { success: true, fileId: result.fileId };
    }
    ```

#### 2.3 訊息與檔案關聯 Schema 更新

1.  **更新 `message.schema.ts`** 待實現

    在 `services/chat-service/src/schemas/message.schema.ts` 更新為安全檔案設計：

    ```typescript
    @Schema({ timestamps: true })
    export class Message {
      // ... 現有欄位 (sender, content 等)
    
      // 移除直接的 fileUrl，改用安全的檔案 ID
      @Prop({ required: false })
      fileId: string; // 安全檔案 ID，用於 /files/:fileId API
    
      @Prop({ type: String, default: 'text' })
      messageType: string; // 'text', 'image', 'file', 'voice' etc.
      
      @Prop({ required: false })
      fileName: string; // 顯示用的檔案名稱
      
      @Prop({ required: false })
      fileSize: number; // 檔案大小（顯示用）
    }
    ```

    **檔案權限查詢優化**：
    ```typescript
    // 新增索引以優化權限查詢
    MessageSchema.index({ conversationId: 1, fileId: 1 });
    MessageSchema.index({ sender: 1, fileId: 1 });
    ```

2.  **更新 `websocket.gateway.ts`**

    在 `services/websocket-server/src/websocket/websocket.gateway.ts` 中處理新訊息的邏輯：

    * 當收到前端發來的訊息事件時，檢查`payload`中是否包含`fileUrl`和`fileType`。
    * 將這些新欄位連同其他訊息內容一併存入MongoDB。
    * 廣播時，確保`fileUrl`和`fileType`也包含在訊息物件中。

### Phase 3: 前端安全檔案處理 待實現

1.  **安裝Expo檔案選擇套件**

    `expo-image-picker` 是官方支援的優良選擇，可以選擇圖片或影片。

    ```bash
    cd frontend
    pnpm add expo-image-picker
    ```

2.  **建立檔案上傳服務**

    在 `frontend/services/api.ts` 或 `chatApi.ts` 中新增一個上傳函式：

    ```typescript
    // frontend/services/chatApi.ts
    import * as FileSystem from 'expo-file-system';
    
    export const uploadFile = async (uri: string) => {
      const formData = new FormData();
      formData.append('file', {
        uri,
        name: uri.split('/').pop(), // 'image.jpg'
        type: `image/${uri.split('.').pop()}`, // 'image/jpeg' - 簡易判斷，可優化
      } as any);
    
      const response = await fetch(`${API_BASE_URL}/api/files/upload`, {
        method: 'POST',
        body: formData,
        headers: {
          'Content-Type': 'multipart/form-data',
          // 如果需要，加上 Authorization header
        },
      });
    
      if (!response.ok) {
        throw new Error('File upload failed');
      }
    
      return response.json(); // 應該回傳 { success: true, data: { url: '...', fileType: '...' } }
    };
    ```

3.  **更新聊天畫面 (`ChatScreen.tsx`)**

    * 新增一個按鈕（例如：迴紋針圖示），點擊後觸發`expo-image-picker`。
    * 使用者選擇圖片後，會得到一個本地`uri`。
    * 呼叫上面寫好的`uploadFile(uri)`函式。
    * 上傳成功後，取得回傳的`url`和`fileType`。
    * 呼叫現有的WebSocket `sendMessage` 方法，傳入的訊息物件結構為：`{ content: '', fileUrl: url, fileType: fileType, conversationId: '...' }`。

4.  **安全檔案顯示元件** 待實現

    更新為使用安全檔案 API：

    ```tsx
    // frontend/src/components/SecureMessageBubble.tsx
    import React from 'react';
    import { View, Text, StyleSheet } from 'react-native';
    import { SecureImage } from './SecureImage';
    
    const MessageBubble = ({ message }) => {
      const renderContent = () => {
        if (message.messageType === 'image' && message.fileId) {
          // 使用安全檔案 API
          return (
            <SecureImage 
              fileId={message.fileId} 
              fileName={message.fileName}
              style={styles.image} 
            />
          );
        }
        if (message.messageType === 'file' && message.fileId) {
          return (
            <SecureFileLink 
              fileId={message.fileId} 
              fileName={message.fileName}
              fileSize={message.fileSize}
            />
          );
        }
        return <Text>{message.content}</Text>;
      };
    
      return (
        <View style={styles.bubble}>
          {renderContent()}
          <Text style={styles.timestamp}>{/* timestamp */}</Text>
        </View>
      );
    };
    ```

    **安全圖片元件**：
    ```tsx
    // frontend/src/components/SecureImage.tsx
    import React, { useState, useEffect } from 'react';
    import { Image, ActivityIndicator } from 'react-native';
    import { getAuthToken } from '../services/auth';
    
    const SecureImage = ({ fileId, fileName, style }) => {
      const [imageUri, setImageUri] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(false);
    
      useEffect(() => {
        loadSecureImage();
      }, [fileId]);
    
      const loadSecureImage = async () => {
        try {
          const token = await getAuthToken();
          const response = await fetch(`${API_BASE_URL}/files/${fileId}`, {
            headers: {
              'Authorization': `Bearer ${token}`,
            },
          });
          
          if (response.ok) {
            const blob = await response.blob();
            const localUri = URL.createObjectURL(blob);
            setImageUri(localUri);
          } else {
            setError(true);
          }
        } catch (err) {
          setError(true);
        } finally {
          setLoading(false);
        }
      };
    
      if (loading) return <ActivityIndicator />;
      if (error) return <Text>無法載入圖片</Text>;
      
      return <Image source={{ uri: imageUri }} style={style} />;
    };
    ```

---

## MinIO 管理界面選項

### 官方 MinIO Console (推薦)

**訪問方式**：`http://localhost:9001` (開發環境)
- **官方支援**：MinIO 原生管理界面
- **功能完整**：檔案管理、用戶管理、監控統計
- **安全性高**：原生支援 RBAC 權限控制
- **無額外部署**：已包含在 Docker Compose 配置中

**使用憑證**：
- 用戶名：`admin` (來自 `MINIO_ROOT_USER`)
- 密碼：`admin_password` (來自 `MINIO_ROOT_PASSWORD`)

### 第三方管理工具

1. **MinIO Client (mc)**
   ```bash
   # 安裝 MinIO Client
   curl https://dl.min.io/client/mc/release/linux-amd64/mc -o mc
   chmod +x mc
   
   # 配置連接
   ./mc alias set local http://localhost:9000 admin admin_password
   
   # 常用命令
   ./mc ls local/
   ./mc stat local/messages_file/
   ```

2. **Web 檔案管理器**（可選）
   - **FileBrowser**：輕量級 web 檔案管理
   - **Filebrowser Docker**：`docker run -p 8080:80 filebrowser/filebrowser`

### 建議使用方案

**開發環境**：使用 MinIO Console (`http://localhost:9001`)
**生產環境**：MinIO Console + mc client (命令行管理)

---

## 3. 實作優先級與時程

### 立即實作 (本週)
1. **實現安全檔案存取 API** (`/files/:fileId`)
2. **建立檔案權限驗證服務**
3. **更新檔案 Schema 和訊息關聯**

### ⏳ 後續實作 (下週)
1. **前端安全檔案組件**
2. **檔案上傳 UI 優化**
3. **效能優化和快取機制**

### 總結

此計畫詳細規劃了**安全優先**的檔案存取系統，確保即時通訊中的檔案隱私保護。通過 UUID 檔案 ID、權限驗證機制和安全串流 API，我們建立了一個既安全又實用的檔案管理系統。

**當前進度：70% 完成**
**下一步重點：實現安全檔案存取 API 和權限驗證機制** 