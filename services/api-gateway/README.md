# API Gateway

API Gateway 是整個微服務架構的入口點，負責路由請求、認證、授權和聚合來自多個微服務的回應。

## 系統架構

```
Client (Mobile/Web)
        ↓ (HTTP/HTTPS)
   API Gateway (Port 3000)
        ↓ (gRPC)
┌─────────────────────────────┐
│  User Service (50052)       │
│  Chat Service (50053)       │
│  File Service (50055)       │
│  Notification Service (50056)│
│  RTC Service (50058)        │
└─────────────────────────────┘
```

## 核心功能

- **統一路由**: 提供統一的 API 端點供前端調用。
- **身份認證與授權**: 使用 JWT Token 驗證用戶身份。
- **請求轉發**: 將 HTTP 請求轉換為 gRPC 請求發送給相應的微服務。
- **響應聚合**: 將微服務的響應格式化為統一的 JSON 格式返回給前端。
- **檔案上傳管理**: 管理安全的檔案上傳與下載流程。

## 認證流程

1. 用戶通過 `POST /auth/register` 以 Email、帳號名稱與密碼註冊，或通過 `POST /auth/login` 以 Email（或帳號名稱）與密碼登入。
2. API Gateway 以 gRPC 呼叫 User Service 驗證憑證（密碼以 bcrypt 雜湊保存）。
3. 驗證成功後，User Service 簽發 JWT Token；API Gateway 另外產生短效（30 秒）的 WebSocket 票證 (ws_ticket)，一起返回給前端。
4. 前端在後續請求的 Authorization Header 中攜帶 JWT Token。
5. API Gateway 使用 `JwtAuthGuard` 驗證 JWT Token，並從中提取用戶資訊。

## API 文件

所有需要認證的 API 都必須在 HTTP Header 中包含有效的 JWT Token:

```
Authorization: Bearer <your-jwt-token>
```

### 錯誤回應格式

所有 API 錯誤都會返回以下格式的 JSON:

```json
{
  "success": false,
  "message": "錯誤訊息",
  "data": null,
  "meta": {
    "timestamp": "ISO8601 時間戳"
  }
}
```

### 成功回應格式

成功的 API 請求會返回以下格式的 JSON:

```json
{
  "success": true,
  "message": "操作成功訊息",
  "data": { /* 實際資料 */ },
  "meta": {
    "timestamp": "ISO8601 時間戳"
  }
}
```

## 認證相關 API

### 註冊

- **URL**: `POST /auth/register`
- **描述**: 以 Email、帳號名稱與密碼建立新帳號，成功後直接返回登入狀態
- **請求 Body**:
  ```json
  {
    "email": "alice@example.com",
    "username": "alice",
    "password": "password123",
    "name": "Alice (可選)"
  }
  ```
- **成功回應**: 與「登入」相同
- **失敗**: Email 或帳號名稱已存在時返回 `User already exists`

### 登入

- **URL**: `POST /auth/login`
- **描述**: 以 Email（或帳號名稱）與密碼登入系統
- **請求 Body**:
  ```json
  {
    "email": "alice@example.com",
    "password": "password123"
  }
  ```
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "Login successful",
    "data": {
      "user": {
        "id": "用戶ID",
        "username": "alice",
        "email": "alice@example.com",
        "name": "Alice"
        // ... 其他用戶資訊
      },
      "accessToken": "JWT Token",
      "ws_ticket": "WebSocket 連線票證（30 秒內有效）"
    },
    "meta": { /* ... */ }
  }
  ```
- **失敗**: 帳號或密碼錯誤時返回 `Invalid email or password`

### 驗證 Token

- **URL**: `GET /auth/validate`
- **描述**: 驗證當前的 JWT Token 是否有效
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "Token is valid",
    "data": {
      "valid": true,
      "user": {
        "id": "用戶ID",
        "username": "alice",
        "email": "alice@example.com"
        // ... 其他用戶資訊
      },
      "ws_ticket": "新的 WebSocket 連線票證"
    },
    "meta": { /* ... */ }
  }
  ```

### 獲取 WebSocket 票證

- **URL**: `POST /auth/ws-ticket`
- **描述**: 為當前用戶獲取新的 WebSocket 連線票證（ws_ticket 有效期只有 30 秒，斷線重連前呼叫此 API 取得新票證）
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "WebSocket ticket generated",
    "data": {
      "ws_ticket": "WebSocket 連線票證"
    },
    "meta": { /* ... */ }
  }
  ```

### 獲取目前使用者資料

- **URL**: `GET /auth/profile`
- **描述**: 獲取當前登入用戶的資料（由 User Service 查詢）
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "Profile retrieved",
    "data": {
      "id": "用戶ID",
      "email": "alice@example.com",
      "name": "Alice",
      "username": "alice",
      "department": "（可選）",
      "profilePicture": "頭像 URL",
      "status": "使用者狀態",
      "createdAt": "建立時間",
      "updatedAt": "更新時間"
    },
    "meta": { /* ... */ }
  }
  ```

## 用戶相關 API

### 獲取所有用戶

- **URL**: `GET /users`
- **描述**: 獲取所有用戶的列表
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "取得用戶列表成功",
    "data": [
      {
        "id": "用戶ID",
        "username": "用戶名",
        "email": "用戶郵箱",
        // ... 其他公開用戶資訊
      }
      // ... 更多用戶
    ],
    "meta": { /* ... */ }
  }
  ```

### 獲取所有用戶名稱

- **URL**: `GET /users/usernames`
- **描述**: 獲取所有用戶的用戶名列表
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "取得用戶名稱列表成功",
    "data": ["username1", "username2", /* ... */],
    "meta": { /* ... */ }
  }
  ```

### 根據用戶名獲取用戶資料

- **URL**: `GET /users/:username`
- **描述**: 根據用戶名獲取特定用戶的公開資料
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "取得用戶資料成功",
    "data": {
      "id": "用戶ID",
      "username": "用戶名",
      "email": "用戶郵箱",
      // ... 其他公開用戶資訊
    },
    "meta": { /* ... */ }
  }
  ```

## 聊天相關 API

### 獲取用戶對話列表

- **URL**: `GET /chat/conversations`
- **描述**: 獲取當前用戶參與的所有對話列表
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "取得對話列表成功",
    "data": [
      {
        "id": "對話ID",
        "name": "對話名稱",
        "type": "對話類型 (private/group)",
        "memberIds": ["用戶ID1", "用戶ID2"],
        "lastMessage": {
          "id": "訊息ID",
          "content": "訊息內容",
          "senderId": "發送者ID",
          "createdAt": "發送時間"
        },
        "createdAt": "創建時間",
        "updatedAt": "更新時間"
      }
      // ... 更多對話
    ],
    "meta": { /* ... */ }
  }
  ```

### 獲取對話訊息

- **URL**: `GET /chat/conversations/:conversationId/messages`
- **查詢參數**:
  - `limit` (可選): 一次獲取的訊息數量上限 (預設 20, 最大 100)
  - `before` (可選): 獲取指定時間戳之前的訊息
  - `after` (可選): 獲取指定時間戳之後的訊息
- **描述**: 獲取指定對話的訊息歷史
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "取得對話訊息成功",
    "data": [
      {
        "id": "訊息ID",
        "content": "訊息內容",
        "senderId": "發送者ID",
        "conversationId": "對話ID",
        "messageType": "訊息類型 (text/image/file)",
        "fileInfo": { /* 檔案資訊，如果是檔案訊息 */ },
        "readBy": ["已讀用戶ID"],
        "createdAt": "發送時間",
        "updatedAt": "更新時間"
      }
      // ... 更多訊息
    ],
    "meta": { /* ... */ }
  }
  ```

### 發送訊息

- **URL**: `POST /chat/messages`
- **描述**: 發送一則新訊息到指定對話
- **請求 Body**:
  ```json
  {
    "content": "訊息內容",
    "conversationId": "對話ID",
    "senderId": "發送者ID"
  }
  ```
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "訊息發送成功",
    "data": {
      "id": "訊息ID",
      "content": "訊息內容",
      "senderId": "發送者ID",
      "conversationId": "對話ID",
      "createdAt": "發送時間"
      // ... 其他訊息資訊
    },
    "meta": { /* ... */ }
  }
  ```

### 創建聊天室

- **URL**: `POST /chat/rooms`
- **描述**: 創建一個新的群組聊天室
- **請求 Body**:
  ```json
  {
    "memberIds": ["用戶ID1", "用戶ID2", /* ... */],
    "name": "聊天室名稱 (可選)"
  }
  ```
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "聊天室建立成功",
    "data": {
      "id": "對話ID",
      "name": "對話名稱",
      "type": "group",
      "memberIds": ["用戶ID1", "用戶ID2", /* ... */],
      "createdAt": "創建時間",
      "updatedAt": "更新時間"
    },
    "meta": { /* ... */ }
  }
  ```

## 檔案相關 API

### 請求檔案上傳許可 (推薦)

- **URL**: `POST /api/files/request-upload`
- **描述**: 請求一個預簽名的上傳 URL，用於直接上傳檔案到雲端存儲
- **請求 Body**:
  ```json
  {
    "fileName": "原始檔案名稱",
    "fileSize": 12345, // 檔案大小 (bytes)
    "contentType": "檔案 MIME 類型 (e.g., image/jpeg)",
    "conversationId": "對話ID (可選)",
    "messageId": "訊息ID (可選)",
    "category": "檔案分類 (可選, 預設 general)"
  }
  ```
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "上傳 URL 生成成功",
    "data": {
      "fileId": "檔案唯一ID",
      "uploadUrl": "預簽名上傳 URL",
      "expiresAt": "URL 過期時間 (ISO8601)"
    },
    "meta": { /* ... */ }
  }
  ```

### 確認檔案上傳完成

- **URL**: `POST /api/files/confirm-upload`
- **描述**: 在檔案上傳到雲端存儲後，調用此 API 通知系統上傳已完成
- **請求 Body**:
  ```json
  {
    "fileId": "檔案唯一ID"
  }
  ```
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "檔案上傳確認成功",
    "data": {
      "fileId": "檔案唯一ID",
      "fileUrl": "檔案存取 URL",
      "fileSize": 12345,
      "contentType": "檔案 MIME 類型"
    },
    "meta": { /* ... */ }
  }
  ```

### 傳統檔案上傳 (向後相容)

- **URL**: `POST /api/files/upload`
- **描述**: 直接上傳檔案到 API Gateway，再由其轉發到 File Service
- **請求格式**: `multipart/form-data`
- **請求 Body**:
  - `file`: 要上傳的檔案
  - `conversationId` (可選): 對話ID
  - `messageId` (可選): 訊息ID
  - `category` (可選): 檔案分類 (預設 general)
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "檔案上傳成功",
    "data": {
      "fileId": "檔案唯一ID",
      "fileUrl": "檔案存取 URL",
      "fileSize": 12345,
      "contentType": "檔案 MIME 類型"
    },
    "meta": { /* ... */ }
  }
  ```

### 下載檔案

- **URL**: `GET /api/files/:fileId/download`
- **查詢參數**:
  - `preview` (可選): `true` 或 `false`，用於指示是否為預覽模式
- **描述**: 下載指定 ID 的檔案，系統會根據用戶權限和對話成員身份進行驗證
- **成功回應**: 檔案二進制數據流

### 預覽檔案

- **URL**: `GET /api/files/:fileId/preview`
- **描述**: 預覽指定 ID 的檔案 (等同於 `.../download?preview=true`)
- **成功回應**: 檔案二進制數據流

### 獲取檔案資訊

- **URL**: `GET /api/files/:fileId/info`
- **描述**: 獲取指定 ID 檔案的元資訊
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "檔案資訊獲取成功",
    "data": {
      "fileId": "檔案唯一ID",
      "originalName": "原始檔案名稱",
      "contentType": "檔案 MIME 類型",
      "fileSize": 12345,
      "uploaderId": "上傳者ID",
      "conversationId": "對話ID",
      "messageId": "訊息ID",
      "category": "檔案分類",
      "createdAt": "上傳時間"
    },
    "meta": { /* ... */ }
  }
  ```

## 推播通知相關 API

### 註冊裝置 Token

- **URL**: `POST /notifications/register-device`
- **描述**: 為當前用戶註冊推播通知的裝置 Token
- **請求 Body**:
  ```json
  {
    "deviceId": "裝置唯一識別碼",
    "platform": "平台 (ios/android/fcm/apns)",
    "token": "推播服務 Token",
    "appVersion": "應用程式版本"
  }
  ```
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "裝置註冊成功",
    "data": null,
    "meta": { /* ... */ }
  }
  ```

### 移除裝置 Token

- **URL**: `DELETE /notifications/device/:token`
- **描述**: 為當前用戶移除指定的推播通知裝置 Token
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "裝置移除成功",
    "data": null,
    "meta": { /* ... */ }
  }
  ```

### 獲取推播設定

- **URL**: `GET /notifications/settings`
- **描述**: 獲取當前用戶的推播通知設定
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "取得推播設定成功",
    "data": {
      "userId": "用戶ID",
      "newMessage": true,  // 新訊息通知
      "groupInvite": true, // 群組邀請通知
      "groupMessage": true, // 群組訊息通知
      "createdAt": "創建時間",
      "updatedAt": "更新時間"
    },
    "meta": { /* ... */ }
  }
  ```

### 更新推播設定

- **URL**: `PUT /notifications/settings`
- **描述**: 更新當前用戶的推播通知設定
- **請求 Body**:
  ```json
  {
    "newMessage": true,  // 新訊息通知 (可選)
    "groupInvite": false, // 群組邀請通知 (可選)
    "groupMessage": true  // 群組訊息通知 (可選)
  }
  ```
  (至少需要提供一個設定項目)
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "推播設定更新成功",
    "data": null,
    "meta": { /* ... */ }
  }
  ```

### 獲取推播歷史記錄

- **URL**: `GET /notifications/history`
- **查詢參數**:
  - `limit` (可選): 回傳記錄數量上限 (預設 20, 範圍 1-100)
  - `offset` (可選): 偏移量 (預設 0)
  - `type` (可選): 通知類型篩選 (`new_message`, `group_message`, `group_invite`)
  - `startDate` (可選): 開始日期 (ISO 8601 格式)
  - `endDate` (可選): 結束日期 (ISO 8601 格式)
- **描述**: 獲取當前用戶的推播通知歷史記錄
- **成功回應**:
  ```json
  {
    "success": true,
    "message": "取得推播歷史記錄成功",
    "data": {
      "notifications": [
        {
          "id": "記錄ID",
          "type": "通知類型",
          "title": "通知標題",
          "body": "通知內容",
          "data": { /* 附加數據 */ },
          "platform": "發送平台",
          "status": "發送狀態",
          "errorMessage": "錯誤訊息 (如果有)",
          "messageId": "訊息ID (如果有)",
          "sentAt": "發送時間",
          "createdAt": "創建時間"
        }
        // ... 更多記錄
      ],
      "total": 100, // 總記錄數
      "hasMore": true, // 是否還有更多記錄
      "limit": 20,
      "offset": 0
    },
    "meta": { /* ... */ }
  }
  ```

## 本地開發

### 環境變數

確保在 `.env` 文件中設置必要的環境變數:

```env
JWT_SECRET=your-super-secret-jwt-key
```

### 啟動服務

```bash
# 安裝依賴
pnpm install

# 啟動開發伺服器
pnpm run start:dev
```

API Gateway 將在 `http://localhost:3000` 上運行。