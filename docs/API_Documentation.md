# API 文檔 - 純 gRPC 微服務聊天系統

## 系統架構概述

### 核心架構原則
- **API Gateway 為單一入口點**：所有前端請求必須通過 API Gateway (Port 3000)
- **純 gRPC 後端服務**：所有微服務僅暴露 gRPC 接口，不直接對外提供 HTTP 服務
- **Email / 密碼認證**：帳號存在 User Service（MongoDB，密碼以 bcrypt 雜湊），登入後以 JWT 存取 API
- **統一響應格式**：所有 API 回應都使用標準化的 ApiResponse 格式

### 服務架構圖
```
Frontend → API Gateway (HTTP:3000) → Backend Services (gRPC)
                ↓
    WebSocket Server (Port 3001) → Chat Service (gRPC)
                ↓
          MongoDB + MinIO Storage
```

### 微服務列表
- **API Gateway** (Port 3000): HTTP/gRPC 橋接，認證，路由
- **User Service** (gRPC 50052): 註冊、登入、簽發 JWT、用戶管理
- **Chat Service** (gRPC 50053): 訊息，對話，觸發通知
- **File Service** (gRPC 50055): 檔案上傳，權限控制
- **Notification Service** (gRPC 50056): FCM/APNs 推播通知
- **RTC Service** (gRPC 50058): 語音 / 視訊通話（LiveKit）
- **WebSocket Server** (Port 3001): 即時訊息傳遞，多設備管理，心跳監控

---

## 標準響應格式

所有 API 端點都使用統一的響應格式：

```json
{
  "success": boolean,
  "message": "操作結果描述",
  "data": {
    // 端點特定的資料內容
  }
}
```

**成功響應範例**:
```json
{
  "success": true,
  "message": "操作成功",
  "data": {
    "id": "12345",
    "name": "用戶名稱"
  }
}
```

**錯誤響應範例**:
```json
{
  "success": false,
  "message": "操作失敗：找不到用戶",
  "data": null
}
```

---

## 認證 API

認證流程：`POST /auth/register` 或 `POST /auth/login` → 取得 `accessToken`（JWT）與 `ws_ticket` → 之後的 HTTP 請求帶 `Authorization: Bearer <accessToken>`，WebSocket 連線用 `ws_ticket`（30 秒內有效，過期用 `POST /auth/ws-ticket` 換新的）。

### POST /auth/register
註冊新帳號，成功後直接返回登入狀態

**請求體**:
```json
{
  "email": "alice@example.com",
  "username": "alice",
  "password": "password123",
  "name": "Alice Chen"
}
```
`name` 為選填。

**成功響應**: 與 `POST /auth/login` 相同

**錯誤響應**（Email 或帳號名稱已存在）:
```json
{
  "success": false,
  "message": "User already exists",
  "data": null
}
```

### POST /auth/login
Email / 密碼登入（`email` 欄位也可以填帳號名稱）

**請求體**:
```json
{
  "email": "alice@example.com",
  "password": "password123"
}
```

**成功響應**:
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "ws_ticket": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "665f1c2e9b1d4a0012345678",
      "email": "alice@example.com",
      "name": "Alice Chen",
      "username": "alice",
      "department": "Engineering",
      "profilePicture": "",
      "status": "active",
      "createdAt": "2025-07-01T10:30:00.000Z",
      "updatedAt": "2025-07-30T15:45:00.000Z"
    }
  }
}
```

**錯誤響應**:
```json
{
  "success": false,
  "message": "Invalid email or password",
  "data": null
}
```

### GET /auth/validate
驗證 JWT Token 有效性，並順便發一張新的 `ws_ticket`

**需要認證**: `Authorization: Bearer <token>`

**成功響應**:
```json
{
  "success": true,
  "message": "Token is valid",
  "data": {
    "valid": true,
    "ws_ticket": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "665f1c2e9b1d4a0012345678",
      "email": "alice@example.com",
      "name": "Alice Chen",
      "username": "alice"
    }
  }
}
```

### POST /auth/ws-ticket
取得新的 WebSocket 連線票證

**需要認證**: `Authorization: Bearer <token>`

**成功響應**:
```json
{
  "success": true,
  "message": "WebSocket ticket generated",
  "data": {
    "ws_ticket": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### GET /auth/profile
取得目前登入用戶的資料

**需要認證**: `Authorization: Bearer <token>`

**成功響應**:
```json
{
  "success": true,
  "message": "Profile retrieved",
  "data": {
    "id": "665f1c2e9b1d4a0012345678",
    "email": "alice@example.com",
    "name": "Alice Chen",
    "username": "alice",
    "department": "Engineering",
    "profilePicture": "",
    "status": "active",
    "createdAt": "2025-07-01T10:30:00.000Z",
    "updatedAt": "2025-07-30T15:45:00.000Z"
  }
}
```

---

## 用戶管理 API

### GET /users
取得所有用戶列表

**需要認證**: `Authorization: Bearer <token>`

**成功響應**:
```json
{
  "success": true,
  "message": "取得用戶列表成功",
  "data": [
    {
      "id": "alice",
      "email": "alice@example.com",
      "name": "Alice Chen",
      "username": "alice",
      "department": "Engineering",
      "profilePicture": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA...",
      "status": "active",
      "createdAt": "2025-07-01T10:30:00.000Z",
      "updatedAt": "2025-07-30T15:45:00.000Z"
    }
  ]
}
```

### GET /users/usernames
取得所有用戶名稱列表

**需要認證**: `Authorization: Bearer <token>`

**成功響應**:
```json
{
  "success": true,
  "message": "取得用戶名稱列表成功",
  "data": ["alice", "bob", "charlie", "dave"]
}
```

### GET /users/:username
根據用戶名取得用戶資料

**需要認證**: `Authorization: Bearer <token>`

**路徑參數**:
- `username`: 用戶名稱

**成功響應**:
```json
{
  "success": true,
  "message": "取得用戶資料成功",
  "data": {
    "id": "alice",
    "email": "alice@example.com",
    "name": "Alice Chen",
    "username": "alice",
    "
    "
    "department": "Engineering",
    "profilePicture": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA...",
    "status": "active",
    "createdAt": "2025-07-01T10:30:00.000Z",
    "updatedAt": "2025-07-30T15:45:00.000Z"
  }
}
```

**找不到用戶**:
```json
{
  "success": false,
  "message": "找不到用戶",
  "data": null
}
```

---

## 聊天服務 API

### GET /chat/conversations
取得用戶的所有對話列表

**需要認證**: `Authorization: Bearer <token>`

**成功響應**:
```json
{
  "success": true,
  "message": "取得對話列表成功",
  "data": [
    {
      "id": "conv_12345",
      "name": "專案討論群",
      "type": "group",
      "participants": [
        {
          "id": "alice",
          "username": "alice",
          "profilePicture": "data:image/jpeg;base64,..."
        },
        {
          "id": "alice",
          "username": "alice",
          "profilePicture": null
        }
      ],
      "lastMessage": {
        "content": "明天開會記得準備報告",
        "timestamp": "2025-07-30T16:30:00.000Z",
        "senderName": "Alice Chen"
      },
      "lastMessageAt": "2025-07-30T16:30:00.000Z",
      "createdAt": "2025-07-28T09:00:00.000Z",
      "updatedAt": "2025-07-30T16:30:00.000Z",
      "groupPicture": null
    },
    {
      "id": "conv_67890",
      "name": null,
      "type": "private",
      "participants": [
        {
          "id": "alice",
          "username": "alice",
          "profilePicture": "data:image/jpeg;base64,..."
        },
        {
          "id": "bob",
          "username": "bob", 
          "profilePicture": null
        }
      ],
      "lastMessage": {
        "content": "好的，我知道了",
        "timestamp": "2025-07-30T14:20:00.000Z",
        "senderName": "Bob"
      },
      "lastMessageAt": "2025-07-30T14:20:00.000Z",
      "createdAt": "2025-07-29T11:15:00.000Z",
      "updatedAt": "2025-07-30T14:20:00.000Z",
      "groupPicture": null
    }
  ]
}
```

### GET /chat/conversations/:conversationId/messages
取得特定對話的訊息

**需要認證**: `Authorization: Bearer <token>`

**路徑參數**:
- `conversationId`: 對話 ID

**查詢參數**:
- `limit` (可選): 訊息數量限制，預設 50，最大 100
- `before` (可選): 取得此訊息 ID 之前的訊息（用於歷史記錄載入）
- `after` (可選): 取得此訊息 ID 之後的訊息（用於同步新訊息）

**使用範例**:
- 基本取得: `GET /chat/conversations/conv_12345/messages`
- 限制數量: `GET /chat/conversations/conv_12345/messages?limit=20`
- 載入歷史: `GET /chat/conversations/conv_12345/messages?limit=20&before=msg_456`
- 同步新訊息: `GET /chat/conversations/conv_12345/messages?after=msg_789`

**成功響應**:
```json
{
  "success": true,
  "message": "取得對話訊息成功",
  "data": [
    {
      "id": "msg_12345",
      "content": "明天開會記得準備報告",
      "conversationId": "conv_12345",
      "senderId": "alice",
      "senderName": "Alice Chen",
      "senderProfilePicture": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA...",
      "timestamp": "2025-07-30T16:30:00.000Z"
    },
    {
      "id": "msg_12344",
      "content": "好的，我會準時到",
      "conversationId": "conv_12345",
      "senderId": "alice",
      "senderName": "Alice",
      "senderProfilePicture": null,
      "timestamp": "2025-07-30T16:25:00.000Z"
    }
  ]
}
```

**注意事項**:
- 訊息按時間降序排列（最新的在前面）
- `before` 和 `after` 參數不能同時使用
- 使用 `before` 進行分頁時，會獲取比指定訊息更舊的訊息
- 使用 `after` 同步時，會獲取比指定訊息更新的訊息

### POST /chat/messages
發送新訊息

**需要認證**: `Authorization: Bearer <token>`

**請求體**:
```json
{
  "content": "這是一條新訊息",
  "conversationId": "conv_12345",
  "senderId": "alice"
}
```

**成功響應**:
```json
{
  "success": true,
  "message": "訊息發送成功",
  "data": {
    "id": "msg_new123",
    "content": "這是一條新訊息",
    "conversationId": "conv_12345",
    "senderId": "alice",
    "senderName": "Alice Chen",
    "senderProfilePicture": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA...",
    "timestamp": "2025-07-30T17:00:00.000Z"
  }
}
```

**重要說明**:
- 訊息發送成功後會自動通過 WebSocket 廣播給對話中的所有成員
- 如果接收者離線，會自動觸發推播通知

### POST /chat/rooms
建立新的聊天室

**需要認證**: `Authorization: Bearer <token>`

**請求體**:
```json
{
  "memberIds": ["alice", "bob", "charlie"],
  "name": "新專案討論群"
}
```

**重要說明**:
- `memberIds` 應包含除了建立者本人以外的所有成員 ID
- 如果提供 `name`，將建立群組聊天
- 如果省略 `name` 且 `memberIds` 只包含一位成員，則建立私人聊天

**成功響應**:
```json
{
  "success": true,
  "message": "聊天室建立成功",
  "data": {
    "id": "conv_new456",
    "name": "新專案討論群",
    "type": "group",
    "participants": [
      {
        "id": "alice",
        "username": "alice",
        "profilePicture": "data:image/jpeg;base64,..."
      },
      {
        "id": "alice",
        "username": "alice",
        "profilePicture": null
      },
      {
        "id": "bob",
        "username": "bob",
        "profilePicture": null
      },
      {
        "id": "charlie",
        "username": "charlie",
        "profilePicture": null
      }
    ],
    "lastMessage": null,
    "lastMessageAt": null,
    "createdAt": "2025-07-30T17:05:00.000Z",
    "updatedAt": "2025-07-30T17:05:00.000Z",
    "groupPicture": null
  }
}
```

---

## 檔案服務 API

### 檔案上傳系統概述
本系統採用**三步驟安全檔案上傳流程**：
1. **請求上傳許可**：取得預簽名上傳 URL 和檔案 ID
2. **直接上傳到 MinIO**：使用預簽名 URL 直接上傳到 MinIO 存儲
3. **確認上傳完成**：通知後端檔案已成功上傳並啟用記錄

### POST /api/files/request-upload
請求檔案上傳許可，取得預簽名上傳 URL

**需要認證**: `Authorization: Bearer <token>`

**請求體**:
```json
{
  "fileName": "report.pdf",
  "fileSize": 2048576,
  "contentType": "application/pdf",
  "category": "message",
  "conversationId": "conv_12345"
}
```

**欄位說明**:
- `fileName`: 原始檔案名稱
- `fileSize`: 檔案大小（位元組）
- `contentType`: MIME 類型
- `category`: 檔案分類 (`general`, `message`, `avatar`)
- `conversationId` (可選): 關聯的對話 ID，用於權限控制

**成功響應**:
```json
{
  "success": true,
  "message": "上傳 URL 生成成功",
  "data": {
    "fileId": "file_abc123def456",
    "uploadUrl": "https://minio.example.com/bucket/file_abc123def456?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=...",
    "expiresAt": "2025-07-30T18:15:00.000Z"
  }
}
```

**使用範例 (JavaScript)**:
```javascript
const requestResponse = await fetch('http://localhost:3050/api/files/request-upload', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  },
  body: JSON.stringify({
    fileName: file.name,
    fileSize: file.size,
    contentType: file.type,
    category: 'message',
    conversationId: 'conv_12345'
  })
});

const requestData = await requestResponse.json();
if (requestData.success) {
  const { fileId, uploadUrl, expiresAt } = requestData.data;
  console.log('上傳許可已取得:', { fileId, expiresAt });
}
```

### 步驟2: 直接上傳到 MinIO
使用步驟1取得的預簽名 URL 直接上傳檔案到 MinIO

**請求方式**: `PUT` 到預簽名 URL  
**請求體**: 檔案二進制數據  
**重要**: 必須設定正確的 `Content-Type` header

**使用範例 (JavaScript)**:
```javascript
const uploadResponse = await fetch(uploadUrl, {
  method: 'PUT',
  body: file,
  headers: {
    'Content-Type': file.type
  }
});

if (uploadResponse.ok) {
  console.log('檔案上傳到 MinIO 成功');
} else {
  throw new Error(`MinIO 上傳失敗: ${uploadResponse.statusText}`);
}
```

### POST /api/files/confirm-upload
確認檔案上傳完成，啟用檔案記錄

**需要認證**: `Authorization: Bearer <token>`

**請求體**:
```json
{
  "fileId": "file_abc123def456"
}
```

**成功響應**:
```json
{
  "success": true,
  "message": "檔案上傳確認成功",
  "data": {
    "fileId": "file_abc123def456",
    "fileUrl": "http://localhost:3050/api/files/file_abc123def456/download",
    "fileSize": 2048576,
    "contentType": "application/pdf"
  }
}
```

**使用範例 (JavaScript)**:
```javascript
const confirmResponse = await fetch('http://localhost:3050/api/files/confirm-upload', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`
  },
  body: JSON.stringify({ fileId })
});

const confirmData = await confirmResponse.json();
if (confirmData.success) {
  console.log('檔案上傳完成:', confirmData.data);
  const { fileUrl } = confirmData.data;
  // 現在可以使用 fileUrl 來存取檔案
}
```

### 完整檔案上傳範例 (JavaScript)
```javascript
async function uploadFile(file, category = 'general', conversationId = null) {
  try {
    // 步驟1: 請求上傳許可
    console.log('步驟 1/3: 請求上傳許可...');
    const requestResponse = await fetch('http://localhost:3050/api/files/request-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
        category: category,
        conversationId: conversationId
      })
    });
    
    const requestData = await requestResponse.json();
    if (!requestData.success) {
      throw new Error(`請求上傳許可失敗: ${requestData.message}`);
    }
    
    const { fileId, uploadUrl, expiresAt } = requestData.data;
    console.log(`檔案 ID: ${fileId}, 有效期至: ${expiresAt}`);
    
    // 步驟2: 直接上傳到 MinIO
    console.log('步驟 2/3: 上傳檔案到 MinIO...');
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type
      }
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`MinIO 上傳失敗: ${uploadResponse.statusText}`);
    }
    
    // 步驟3: 確認上傳完成
    console.log('步驟 3/3: 確認上傳完成...');
    const confirmResponse = await fetch('http://localhost:3050/api/files/confirm-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ fileId })
    });
    
    const confirmData = await confirmResponse.json();
    if (!confirmData.success) {
      throw new Error(`確認上傳失敗: ${confirmData.message}`);
    }
    
    console.log('✅ 檔案上傳完成:', confirmData.data);
    return confirmData.data;
    
  } catch (error) {
    console.error('❌ 檔案上傳錯誤:', error);
    throw error;
  }
}

// 使用範例
const fileInput = document.getElementById('fileInput');
const file = fileInput.files[0];
if (file) {
  uploadFile(file, 'message', 'conv_12345')
    .then(fileData => {
      console.log('檔案可通過此 URL 存取:', fileData.fileUrl);
    })
    .catch(error => {
      console.error('上傳失敗:', error);
    });
}
```

### GET /api/files/:fileId/info
取得檔案資訊

**需要認證**: `Authorization: Bearer <token>`

**路徑參數**:
- `fileId`: 檔案 ID

**成功響應**:
```json
{
  "success": true,
  "message": "檔案資訊獲取成功",
  "data": {
    "fileId": "file_abc123def456",
    "originalName": "report.pdf",
    "contentType": "application/pdf",
    "fileSize": 2048576,
    "uploaderId": "alice",
    "conversationId": "conv_12345",
    "messageId": null,
    "category": "message",
    "createdAt": "2025-07-30T17:30:00.000Z"
  }
}
```

### GET /api/files/:fileId/download
下載檔案（基於權限控制）

**需要認證**: `Authorization: Bearer <token>`

**路徑參數**:
- `fileId`: 檔案 ID

**查詢參數**:
- `preview` (可選): `true` 為預覽模式，`false` 為下載模式

**響應**: 直接回傳檔案二進制內容

**安全特性**:
- **對話檔案**：自動檢查用戶是否為對話成員
- **個人檔案**：自動檢查用戶是否為檔案上傳者
- **自動 Content-Type**：根據檔案類型設定適當的 MIME 類型
- **檔名處理**：自動設定正確的檔案名稱

**使用範例 (JavaScript)**:
```javascript
// 下載檔案
async function downloadFile(fileId) {
  const response = await fetch(`http://localhost:3050/api/files/${fileId}/download`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  if (response.ok) {
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'downloaded-file'; // 瀏覽器會使用 Content-Disposition 中的檔名
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } else {
    const errorData = await response.json();
    console.error('下載失敗:', errorData.message);
  }
}
```

### GET /api/files/:fileId/preview
預覽檔案（便利方法）

**需要認證**: `Authorization: Bearer <token>`

**路徑參數**:
- `fileId`: 檔案 ID

**功能說明**:
- 這是 `/api/files/:fileId/download?preview=true` 的便利方法
- 檔案會以 `inline` 模式回傳，適合在瀏覽器中直接顯示
- 支援圖片、PDF 等可預覽的檔案類型

**使用範例 (HTML)**:
```html
<!-- 直接在 img 標籤中預覽圖片 -->
<img src="http://localhost:3050/api/files/file_abc123def456/preview" 
     headers="Authorization: Bearer ${accessToken}" 
     alt="預覽圖片">

<!-- 或使用 JavaScript 處理 -->
<script>
async function previewFile(fileId) {
  const response = await fetch(`http://localhost:3050/api/files/${fileId}/preview`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  if (response.ok) {
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    
    if (response.headers.get('Content-Type').startsWith('image/')) {
      // 顯示圖片預覽
      document.getElementById('preview').innerHTML = 
        `<img src="${url}" style="max-width: 100%; height: auto;">`;
    } else {
      // 其他類型的檔案
      window.open(url, '_blank');
    }
  } else {
    const errorData = await response.json();
    console.error('預覽失敗:', errorData.message);
  }
}
</script>
```

### 向後相容的檔案 API

#### POST /api/files/upload
直接上傳檔案（舊版方法，向後相容）

**需要認證**: `Authorization: Bearer <token>`

**Content-Type**: `multipart/form-data`

**表單欄位**:
- `file`: 檔案
- `conversationId` (可選): 對話 ID
- `messageId` (可選): 訊息 ID
- `category` (可選): 檔案分類

**成功響應**:
```json
{
  "success": true,
  "message": "檔案上傳成功",
  "data": {
    "fileId": "file_xyz789abc123",
    "fileUrl": "http://localhost:3050/api/files/file_xyz789abc123/download",
    "fileSize": 1024768,
    "contentType": "image/jpeg"
  }
}
```

#### GET /files/:fileId
取得安全檔案（舊版路徑，向後相容）

**需要認證**: `Authorization: Bearer <token>`

**路徑參數**:
- `fileId`: 檔案 ID

**響應**: 直接回傳檔案二進制內容

**注意**: 建議使用新的 `/api/files/:fileId/download` 端點

---

## 通知服務 API

### POST /notifications/register-device
註冊設備推播通知令牌

**需要認證**: `Authorization: Bearer <token>`

**安全說明**: 後端會自動從 JWT Token 中解析當前用戶 ID，無需前端提供

**請求體**:
```json
{
  "token": "dGhpcyBpcyBhIGZha2UgRkNNIHRva2VuIGZvciBkZW1vbnN0cmF0aW9u",
  "platform": "android",
  "deviceId": "device_unique_12345",
  "appVersion": "1.2.3"
}
```

**欄位說明**:
- `token`: FCM Token (Android) 或 APNs Token (iOS)
- `platform`: 平台類型 (`ios`, `android`)
- `deviceId`: 唯一設備識別碼
- `appVersion`: 應用程式版本

**成功響應**:
```json
{
  "success": true,
  "message": "Device token registered successfully",
  "data": {
    "deviceToken": {
      "userId": "alice",
      "token": "dGhpcyBpcyBhIGZha2UgRkNNIHRva2VuIGZvciBkZW1vbnN0cmF0aW9u",
      "platform": "android",
      "deviceId": "device_unique_12345",
      "appVersion": "1.2.3",
      "createdAt": "2025-07-30T18:00:00.000Z"
    }
  }
}
```

**使用範例 (JavaScript)**:
```javascript
async function registerDeviceForNotifications(fcmToken, platform = 'android') {
  try {
    const response = await fetch('http://localhost:3050/notifications/register-device', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        token: fcmToken,
        platform: platform,
        deviceId: generateDeviceId(), // 自行實作的設備 ID 生成函數
        appVersion: "1.2.3"
      })
    });
    
    const data = await response.json();
    if (data.success) {
      console.log('設備註冊成功:', data.data.deviceToken);
      return data.data.deviceToken;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('設備註冊失敗:', error);
    return null;
  }
}

function generateDeviceId() {
  // 生成唯一設備 ID 的範例實作
  return 'web-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
}
```

### DELETE /notifications/device/:token
移除設備推播通知令牌

**需要認證**: `Authorization: Bearer <token>`

**路徑參數**:
- `token`: 要移除的設備 Token (需要 URL 編碼)

**成功響應**:
```json
{
  "success": true,
  "message": "Device token removed successfully",
  "data": null
}
```

**使用範例 (JavaScript)**:
```javascript
async function unregisterDevice(fcmToken) {
  try {
    const encodedToken = encodeURIComponent(fcmToken);
    const response = await fetch(`http://localhost:3050/notifications/device/${encodedToken}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      }
    });
    
    const data = await response.json();
    if (data.success) {
      console.log('設備移除成功:', data.message);
      return true;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('設備移除失敗:', error);
    return false;
  }
}
```

### GET /notifications/settings
取得推播通知設定

**需要認證**: `Authorization: Bearer <token>`

**安全說明**: 後端會自動從 JWT Token 中解析當前用戶 ID，返回該用戶的通知設定

**成功響應**:
```json
{
  "success": true,
  "message": "取得推播設定成功",
  "data": {
    "userId": "alice",
    "newMessage": true,
    "groupInvite": true,
    "groupMessage": false,
    "createdAt": "2025-07-28T10:00:00.000Z",
    "updatedAt": "2025-07-30T18:15:00.000Z"
  }
}
```

**欄位說明**:
- `newMessage`: 是否接收新私人訊息通知
- `groupInvite`: 是否接收群組邀請通知
- `groupMessage`: 是否接收群組訊息通知

### PUT /notifications/settings
更新推播通知設定

**需要認證**: `Authorization: Bearer <token>`

**安全說明**: 後端會自動從 JWT Token 中解析當前用戶 ID，無需前端提供

**請求體**:
```json
{
  "newMessage": true,
  "groupInvite": false,
  "groupMessage": true
}
```

**成功響應**:
```json
{
  "success": true,
  "message": "Notification settings updated successfully",
  "data": {
    "settings": {
      "userId": "alice",
      "newMessage": true,
      "groupInvite": false,
      "groupMessage": true,
      "updatedAt": "2025-07-30T18:20:00.000Z"
    }
  }
}
```

**使用範例 (JavaScript)**:
```javascript
async function updateNotificationSettings(settings) {
  try {
    const response = await fetch('http://localhost:3050/notifications/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        newMessage: settings.newMessage ?? true,
        groupInvite: settings.groupInvite ?? true,
        groupMessage: settings.groupMessage ?? true
      })
    });
    
    const data = await response.json();
    if (data.success) {
      console.log('通知設定更新成功:', data.data.settings);
      return data.data.settings;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('通知設定更新失敗:', error);
    return null;
  }
}

// 使用範例
updateNotificationSettings({
  newMessage: true,      // 接收私人訊息通知
  groupInvite: true,     // 接收群組邀請通知
  groupMessage: false    // 不接收群組訊息通知（靜音）
});
```

### 完整通知系統整合範例
```javascript
class NotificationManager {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.fcmToken = null;
    this.deviceInfo = null;
  }

  // 初始化通知系統
  async initialize() {
    try {
      // 1. 取得 FCM Token
      this.fcmToken = await this.getFCMToken();
      if (!this.fcmToken) {
        throw new Error('無法取得 FCM Token');
      }

      // 2. 註冊設備
      this.deviceInfo = await this.registerDevice();
      if (!this.deviceInfo) {
        throw new Error('設備註冊失敗');
      }

      // 3. 載入並顯示當前通知設定
      const settings = await this.getNotificationSettings();
      this.displaySettings(settings);

      console.log('✅ 通知系統初始化完成');
      return true;
    } catch (error) {
      console.error('❌ 通知系統初始化失敗:', error);
      return false;
    }
  }

  // 取得 FCM Token（需要實作 Firebase 相關邏輯）
  async getFCMToken() {
    // 這裡需要實作 Firebase Cloud Messaging 的 Token 取得邏輯
    // 參考 Firebase 官方文檔
    return 'fake_fcm_token_for_demo';
  }

  // 註冊設備
  async registerDevice() {
    return await registerDeviceForNotifications(this.fcmToken, 'web');
  }

  // 取得通知設定
  async getNotificationSettings() {
    try {
      const response = await fetch('http://localhost:3050/notifications/settings', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        }
      });
      
      const data = await response.json();
      if (data.success) {
        return data.data;
      } else {
        throw new Error(data.message);
      }
    } catch (error) {
      console.error('取得通知設定失敗:', error);
      return null;
    }
  }

  // 更新通知設定
  async updateSettings(newSettings) {
    return await updateNotificationSettings(newSettings);
  }

  // 顯示設定到 UI
  displaySettings(settings) {
    if (settings) {
      document.getElementById('newMessage').checked = settings.newMessage;
      document.getElementById('groupInvite').checked = settings.groupInvite;
      document.getElementById('groupMessage').checked = settings.groupMessage;
    }
  }

  // 清理（登出時調用）
  async cleanup() {
    if (this.fcmToken) {
      await unregisterDevice(this.fcmToken);
      console.log('通知服務已清理');
    }
  }
}

// 使用範例
async function initApp() {
  // 假設已經完成登入並取得 accessToken
  const accessToken = 'your_jwt_token_here';
  
  const notificationManager = new NotificationManager(accessToken);
  const initialized = await notificationManager.initialize();
  
  if (initialized) {
    // 設定 UI 事件監聽器
    document.getElementById('updateSettings').addEventListener('click', async () => {
      const newSettings = {
        newMessage: document.getElementById('newMessage').checked,
        groupInvite: document.getElementById('groupInvite').checked,
        groupMessage: document.getElementById('groupMessage').checked
      };
      
      const updatedSettings = await notificationManager.updateSettings(newSettings);
      if (updatedSettings) {
        alert('通知設定已更新');
      }
    });
  }
}
```

---

## WebSocket 服務 (Socket.IO)

### 連線資訊
- **開發環境 URL**: `http://localhost:3001`
- **生產環境 URL**: `https://ws.yourdomain.com`
- **命名空間**: `/` (根命名空間)
- **認證方式**: WebSocket 票證（`/auth/login` 等回應裡的 `ws_ticket`，或呼叫 `POST /auth/ws-ticket` 取得）
- **多設備支援**: 每用戶最多 5 個設備同時在線
- **心跳間隔**: 30 秒自動心跳檢查
- **超時設定**: 60 秒無回應自動斷線

### 連線建立和配置
```javascript
import { io } from "socket.io-client";

// 建立 WebSocket 連線（完整配置）
const socket = io('http://localhost:3001', {
  // 認證配置
  auth: {
    token: wsTicket  // 從 /auth/login 回應中取得的 ws_ticket
  },
  
  // 查詢參數（用於連線初始化）
  query: {
    deviceId: generateDeviceId(),      // 設備 ID（自動生成或手動指定）
    platform: detectPlatform(),       // 平台類型：web, ios, android
    userAgent: navigator.userAgent    // 用戶代理字串
  },
  
  // Socket.IO 傳輸配置
  transports: ['websocket', 'polling'], // 優先使用 WebSocket，降級到長輪詢
  upgrade: true,                         // 允許傳輸升級
  
  // 重連配置
  reconnection: true,           // 啟用自動重連
  reconnectionAttempts: 5,      // 最大重連次數
  reconnectionDelay: 1000,      // 初始重連延遲 1 秒
  reconnectionDelayMax: 30000,  // 最大重連延遲 30 秒
  randomizationFactor: 0.5,     // 隨機化係數
  
  // 超時配置
  timeout: 10000,               // 連線超時 10 秒
  
  // CORS 配置
  withCredentials: true
});

// WebSocket 票證取得範例
async function getWebSocketTicket(accessToken) {
  try {
    const response = await fetch('http://localhost:3050/auth/ws-ticket', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    if (data.success) {
      return data.data.ws_ticket;
    } else {
      throw new Error(data.message);
    }
  } catch (error) {
    console.error('取得 WebSocket 票證失敗:', error);
    return null;
  }
}

// 完整連線範例（alice@example.com）
async function connectWebSocket(accessToken) {
  // 1. 取得 WebSocket 票證
  console.log('🎫 Alice 正在取得 WebSocket 票證...');
  const wsTicket = await getWebSocketTicket(accessToken);
  if (!wsTicket) {
    throw new Error('無法取得 WebSocket 票證');
  }
  
  // 2. 建立連線
  console.log('🔌 Alice 正在連接到聊天伺服器...');
  const socket = io('http://localhost:3001', {
    auth: { token: wsTicket },
    query: {
      deviceId: generateDeviceId(),
      platform: detectPlatform(),
      userAgent: navigator.userAgent
    },
    transports: ['websocket', 'polling'],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 30000,
    randomizationFactor: 0.5,
    timeout: 10000,
    withCredentials: true
  });
  
  return socket;
}

// 設備 ID 生成函數
function generateDeviceId() {
  let deviceId = localStorage.getItem('websocket_device_id');
  if (!deviceId) {
    deviceId = 'web-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
    localStorage.setItem('websocket_device_id', deviceId);
  }
  return deviceId;
}

// 平台檢測函數
function detectPlatform() {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('iphone') || userAgent.includes('ipad')) return 'ios';
  if (userAgent.includes('android')) return 'android';
  return 'web';
}

// 監聽連線確認
socket.on('connected', (data) => {
  console.log('✅ WebSocket 連線成功:', data);
  /*
  data 結構:
  {
    userId: 'alice',
    deviceId: 'web-abc123-1691234567890',
    platform: 'web',
    serverTime: '2025-08-01T12:00:00.000Z',
    connectionId: 'socket_xyz789',
    initialTransport: 'websocket'
  }
  */
  
  // 更新 UI 連線狀態
  updateConnectionStatus('connected', data);
});
```

### 多設備連線管理

系統支援每個用戶最多 **5 個設備** 同時在線：

```javascript
// 監聽強制斷線事件（超出連線限制）
socket.on('force_disconnect', (data) => {
  console.warn('連線被強制斷開:', data.reason);
  
  if (data.reason === 'connection_limit_exceeded') {
    // 顯示友好的用戶提示
    showNotification('您已在其他設備登入，此設備連線已斷開', 'warning');
    
    // 可選：提供重新連線選項
    showReconnectOption();
  }
});

function showReconnectOption() {
  const reconnect = confirm('是否要斷開其他設備並重新連線？');
  if (reconnect) {
    // 延遲後重新連線（讓伺服器有時間清理舊連線）
    setTimeout(() => {
      socket.connect();
    }, 2000);
  }
}
```

### 傳輸升級處理

Socket.IO 會自動嘗試從長輪詢升級到 WebSocket：

```javascript
// 監聽傳輸升級成功
socket.on('transportUpgraded', (data) => {
  console.log('🚀 傳輸升級成功:', data.transport);
  /*
  data 結構:
  {
    transport: 'websocket',
    timestamp: '2025-08-01T12:00:05.000Z'
  }
  */
  updateConnectionQuality('excellent');
});

// 監聽傳輸升級失敗
socket.on('transportUpgradeError', (data) => {
  console.warn('⚠️ 傳輸升級失敗:', data.error);
  /*
  data 結構:
  {
    error: 'upgrade error message',
    timestamp: '2025-08-01T12:00:05.000Z'
  }
  */
  updateConnectionQuality('good'); // 仍然可用，但非最佳狀態
});

// 監聽傳輸變更
socket.io.on('upgrade', () => {
  console.log('傳輸已升級至:', socket.io.engine.transport.name);
});

socket.io.on('upgradeError', (error) => {
  console.error('傳輸升級錯誤:', error);
});
```

### 監聽事件（由客戶端發送）

#### `joinRoom` - 加入聊天室
```javascript
socket.emit('joinRoom', {
  conversationId: 'conv_12345'
});

// 監聽加入確認
socket.on('joinedRoom', (data) => {
  console.log('已加入聊天室:', data);
  // data: { success: true, conversationId: 'conv_12345' }
});
```

#### `leaveRoom` - 離開聊天室
```javascript
socket.emit('leaveRoom', {
  conversationId: 'conv_12345'
});

// 監聽離開確認
socket.on('leftRoom', (data) => {
  console.log('已離開聊天室:', data);
  // data: { success: true, conversationId: 'conv_12345' }
});
```

#### `sendMessage` - 發送訊息
```javascript
socket.emit('sendMessage', {
  content: '這是一條即時訊息',
  conversationId: 'conv_12345',
  senderId: 'alice',
  senderName: 'Alice Chen',
  senderProfilePicture: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA...'
});
```

**重要說明**:
- 此事件會將訊息廣播給房間內的所有人（包括發送者本人）
- 同時會觸發後端的訊息儲存邏輯
- 離線用戶會自動收到推播通知

#### `getConnectionStats` - 取得伺服器統計
```javascript
socket.emit('getConnectionStats');

// 監聽統計資料
socket.on('connectionStats', (stats) => {
  console.log('伺服器統計:', stats);
  /*
  stats: {
    totalConnections: 42,
    totalUsers: 15,
    totalDevices: 28,
    serverUptime: 3600000,
    memoryUsage: { rss: 125829120, heapTotal: 67108864, ... },
    timestamp: '2025-07-30T18:30:00.000Z'
  }
  */
});

// Alice 查看伺服器狀態範例
function checkServerStatus(socket) {
  console.log('📊 Alice 正在查看伺服器狀態...');
  
  socket.emit('getConnectionStats');
  
  socket.on('connectionStats', (stats) => {
    const uptimeHours = Math.floor(stats.serverUptime / (1000 * 60 * 60));
    const memoryUsageMB = Math.round(stats.memoryUsage.rss / 1024 / 1024);
    
    console.log(`🏢 聊天伺服器狀態:`);
    console.log(`   • 線上人數: ${stats.totalUsers} 人`);
    console.log(`   • 總連線數: ${stats.totalConnections} 個`);
    console.log(`   • 設備數量: ${stats.totalDevices} 台`);
    console.log(`   • 運行時間: ${uptimeHours} 小時`);
    console.log(`   • 記憶體使用: ${memoryUsageMB} MB`);
    
    // 更新 UI 顯示
    updateServerStatusDisplay(stats);
  });
}

function updateServerStatusDisplay(stats) {
  const statusPanel = document.getElementById('server-status');
  if (statusPanel) {
    const uptimeHours = Math.floor(stats.serverUptime / (1000 * 60 * 60));
    const memoryUsageMB = Math.round(stats.memoryUsage.rss / 1024 / 1024);
    
    statusPanel.innerHTML = `
      <div class="server-status-panel">
        <h4>🏢 聊天伺服器</h4>
        <div class="status-grid">
          <div class="status-item">
            <span class="label">線上人數:</span>
            <span class="value">${stats.totalUsers} 人</span>
          </div>
          <div class="status-item">
            <span class="label">總連線數:</span>
            <span class="value">${stats.totalConnections} 個</span>
          </div>
          <div class="status-item">
            <span class="label">設備數量:</span>
            <span class="value">${stats.totalDevices} 台</span>
          </div>
          <div class="status-item">
            <span class="label">運行時間:</span>
            <span class="value">${uptimeHours} 小時</span>
          </div>
          <div class="status-item">
            <span class="label">記憶體:</span>
            <span class="value">${memoryUsageMB} MB</span>
          </div>
        </div>
      </div>
    `;
  }
}
```

#### `getUserDevices` - 取得用戶設備列表
```javascript
socket.emit('getUserDevices');

// 監聽設備列表
socket.on('userDevices', (data) => {
  console.log('我的設備:', data);
  /*
  data: {
    userId: 'alice',
    devices: [
      {
        deviceId: 'web-device-12345',
        platform: 'web',
        connectedAt: '2025-07-30T18:25:00.000Z',
        lastHeartbeat: '2025-07-30T18:29:50.000Z',
        userAgent: 'Mozilla/5.0...',
        isCurrent: true
      }
    ],
    totalDevices: 1
  }
  */
});
```

#### `isUserOnline` - 檢查用戶在線狀態
```javascript
socket.emit('isUserOnline', {
  userId: 'alice'
});

// 監聽在線狀態結果
socket.on('userOnlineStatus', (data) => {
  console.log('用戶在線狀態:', data);
  /*
  data: {
    userId: 'alice',
    isOnline: true,
    deviceCount: 2,
    timestamp: '2025-07-30T18:30:00.000Z'
  }
  */
});
```

### 接收事件（由伺服器廣播）

#### `newMessage` - 接收新訊息
```javascript
socket.on('newMessage', (message) => {
  console.log('收到新訊息:', message);
  displayMessage(message);
});

/*
message 格式:
{
  messageId: 'msg_12345',
  content: '這是一條即時訊息',
  conversationId: 'conv_12345',
  senderId: 'alice',
  senderName: 'Alice Chen',
  senderProfilePicture: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAA...',
  timestamp: '2025-07-30T18:30:00.000Z'
}
*/
```

**重要說明**:
- 當任一用戶透過 `sendMessage` 發送訊息時，伺服器會將處理並儲存後的完整訊息物件透過此事件廣播給房間內的所有成員（包括發送者）
- 發送者收到此事件即表示訊息已成功發送並儲存
- 這統一了私人聊天和群組聊天的訊息處理邏輯

#### `globalNotification` - 全域通知
```javascript
socket.on('globalNotification', (notification) => {
  console.log('收到全域通知:', notification);
  showBrowserNotification(notification);
});

/*
notification 格式:
{
  type: 'new_message',
  title: '新訊息',
  body: 'Alice Chen: 明天開會記得準備報告',
  data: {
    conversationId: 'conv_12345',
    senderId: 'alice',
    messageId: 'msg_12345',
    timestamp: '2025-07-30T18:30:00.000Z'
  },
  deviceId: 'web-device-12345',
  timestamp: '2025-07-30T18:30:00.000Z'
}
*/

function showBrowserNotification(notification) {
  if (Notification.permission === 'granted') {
    new Notification(notification.title, {
      body: notification.body,
      data: notification.data,
      icon: '/icon-192.png'
    });
  }
}
```

**觸發條件**:
- 用戶在線但不在相關聊天室時收到的訊息通知
- 系統會自動判斷用戶狀態並選擇適當的通知方式

#### `systemNotification` - 系統通知
```javascript
socket.on('systemNotification', (notification) => {
  console.log('收到系統通知:', notification);
  showSystemAlert(notification);
});

/*
notification 格式:
{
  type: 'maintenance',
  title: '系統維護通知',
  body: '系統將於今晚 22:00 進行維護，預計 2 小時',
  data: {
    maintenanceStart: '2025-07-30T22:00:00.000Z',
    maintenanceEnd: '2025-07-31T00:00:00.000Z'
  },
  deviceId: 'web-device-12345',
  timestamp: '2025-07-30T18:30:00.000Z'
}
*/
```

#### `updateConversations` - 對話列表更新
```javascript
socket.on('updateConversations', (data) => {
  console.log('對話列表有更新:', data.message);
  // 重新載入對話列表
  refreshConversationList();
});

async function refreshConversationList() {
  try {
    const response = await fetch('http://localhost:3050/chat/conversations', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const data = await response.json();
    if (data.success) {
      updateConversationUI(data.data);
    }
  } catch (error) {
    console.error('更新對話列表失敗:', error);
  }
}
```

**觸發條件**:
- 用戶被加入新的群組聊天
- 聊天室成員有變動
- 需要重新同步對話列表的任何情況

#### 心跳機制（自動處理）
```javascript
// 監聽伺服器心跳（自動回應）
socket.on('heartbeat_ping', (data) => {
  socket.emit('heartbeat_pong', { timestamp: data.timestamp });
});

// 監聽心跳確認（顯示延遲）
socket.on('heartbeat_ack', (data) => {
  console.log(`心跳延遲: ${data.latency}ms`);
  updateConnectionStatus('connected', data.latency);
});

// 完整心跳機制示範（alice@example.com）
function setupHeartbeatMonitoring(socket) {
  let heartbeatStats = {
    totalPings: 0,
    avgLatency: 0,
    maxLatency: 0,
    minLatency: Infinity,
    connectionQuality: 'excellent'
  };
  
  // 自動心跳回應
  socket.on('heartbeat_ping', (data) => {
    console.log('💓 伺服器心跳檢測 ping');
    socket.emit('heartbeat_pong', { 
      timestamp: data.timestamp,
      clientTime: Date.now()
    });
  });
  
  // 心跳延遲監控
  socket.on('heartbeat_ack', (data) => {
    heartbeatStats.totalPings++;
    const latency = data.latency;
    
    // 更新統計
    heartbeatStats.avgLatency = 
      (heartbeatStats.avgLatency * (heartbeatStats.totalPings - 1) + latency) / heartbeatStats.totalPings;
    heartbeatStats.maxLatency = Math.max(heartbeatStats.maxLatency, latency);
    heartbeatStats.minLatency = Math.min(heartbeatStats.minLatency, latency);
    
    // 判斷連線品質
    if (latency < 50) {
      heartbeatStats.connectionQuality = 'excellent';
    } else if (latency < 150) {
      heartbeatStats.connectionQuality = 'good';
    } else if (latency < 300) {
      heartbeatStats.connectionQuality = 'fair';
    } else {
      heartbeatStats.connectionQuality = 'poor';
    }
    
    console.log(`💓 Alice 的連線品質: ${heartbeatStats.connectionQuality} (${latency}ms)`);
    
    // 更新 UI 顯示
    updateConnectionDisplay({
      status: 'connected',
      latency: latency,
      quality: heartbeatStats.connectionQuality,
      stats: heartbeatStats
    });
  });
  
  return heartbeatStats;
}

// UI 更新函數範例
function updateConnectionDisplay(info) {
  const statusElement = document.getElementById('connection-status');
  const latencyElement = document.getElementById('latency-display');
  
  if (statusElement) {
    statusElement.textContent = `聊天系統 - ${info.quality} (${info.latency}ms)`;
    statusElement.className = `connection-status ${info.quality}`;
  }
  
  if (latencyElement) {
    latencyElement.innerHTML = `
      <div>當前延遲: ${info.latency}ms</div>
      <div>平均延遲: ${Math.round(info.stats.avgLatency)}ms</div>
      <div>連線品質: ${info.quality}</div>
    `;
  }
}
```

### 斷線重連機制
```javascript
// 斷線重連狀態監控
function setupReconnectionHandling(socket) {
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  
  // 監聽連線成功
  socket.on('connect', () => {
    console.log('✅ Alice 已成功連接到聊天伺服器');
    reconnectAttempts = 0;
    updateReconnectionStatus('connected');
  });
  
  // 監聽斷線事件
  socket.on('disconnect', (reason) => {
    console.warn(`🔌 Alice 與伺服器的連線已斷開: ${reason}`);
    
    updateReconnectionStatus('disconnected', reason);
    
    // 根據斷線原因決定是否重連
    if (reason === 'io server disconnect') {
      console.log('🚫 伺服器主動斷開連線，不進行自動重連');
    } else {
      console.log('🔄 正在嘗試重新連接...');
    }
  });
  
  // 監聽重連嘗試
  socket.on('reconnect_attempt', (attemptNumber) => {
    reconnectAttempts = attemptNumber;
    console.log(`🔄 Alice 正在進行第 ${attemptNumber} 次重連嘗試...`);
    updateReconnectionStatus('reconnecting', null, attemptNumber);
  });
  
  // 監聽重連失敗
  socket.on('reconnect_failed', () => {
    console.error(`❌ Alice 無法重新連接到伺服器（${maxReconnectAttempts} 次嘗試都失敗）`);
    updateReconnectionStatus('failed');
    showReconnectionOptions();
  });
  
  // 監聽重連成功
  socket.on('reconnect', (attemptNumber) => {
    console.log(`✅ Alice 已成功重新連接（第 ${attemptNumber} 次嘗試）`);
    updateReconnectionStatus('connected');
  });
  
  // 監聽連線錯誤
  socket.on('connect_error', (error) => {
    console.error('❌ Alice 連接伺服器時發生錯誤:', error.message);
    updateReconnectionStatus('error', error.message);
  });
  
  // 監聽強制斷線（超出設備限制）
  socket.on('force_disconnect', (data) => {
    console.warn('⚠️ Alice 的連線被強制斷開:', data.reason);
    
    if (data.reason === 'connection_limit_exceeded') {
      alert('Alice 已在其他設備登入，此設備連線已斷開。\n請確認是否要斷開其他設備並重新連線？');
      
      const shouldReconnect = confirm('是否要重新連線？（會斷開其他設備）');
      if (shouldReconnect) {
        setTimeout(() => {
          socket.connect();
        }, 2000);
      }
    }
  });
}

// 更新重連狀態顯示
function updateReconnectionStatus(status, reason = null, attempt = null) {
  const statusElement = document.getElementById('reconnection-status');
  if (!statusElement) return;
  
  let message = '';
  let className = 'reconnection-status';
  
  switch (status) {
    case 'connected':
      message = '✅ 已連接到聊天伺服器';
      className += ' connected';
      break;
    case 'disconnected':
      message = `🔌 與的連線已斷開${reason ? ` (${reason})` : ''}`;
      className += ' disconnected';
      break;
    case 'reconnecting':
      message = `🔄 正在重新連接... (第 ${attempt} 次嘗試)`;
      className += ' reconnecting';
      break;
    case 'failed':
      message = '❌ 重連失敗，請手動重新整理頁面';
      className += ' failed';
      break;
    case 'error':
      message = `❌ 連線錯誤: ${reason}`;
      className += ' error';
      break;
  }
  
  statusElement.textContent = message;
  statusElement.className = className;
}

// 顯示重連選項
function showReconnectionOptions() {
  const shouldReload = confirm(
    'Alice 無法連接到聊天伺服器。\n\n' +
    '是否要重新整理頁面來重新連線？'
  );
  
  if (shouldReload) {
    window.location.reload();
  }
}
```

### 完整 WebSocket 整合範例
```javascript
class WebSocketManager {
  constructor(wsTicket, accessToken) {
    this.wsTicket = wsTicket;
    this.accessToken = accessToken;
    this.socket = null;
    this.currentRoom = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  // 建立連線
  connect() {
    this.socket = io('http://localhost:3001', {
      auth: { token: this.wsTicket },
      query: {
        deviceId: this.generateDeviceId(),
        platform: 'web',
        userAgent: navigator.userAgent
      }
    });

    this.setupEventListeners();
    return new Promise((resolve, reject) => {
      this.socket.on('connected', (data) => {
        console.log('✅ WebSocket 連線成功:', data);
        this.reconnectAttempts = 0;
        resolve(data);
      });

      this.socket.on('connect_error', (error) => {
        console.error('❌ WebSocket 連線失敗:', error);
        reject(error);
      });
    });
  }

  // 設定事件監聽器
  setupEventListeners() {
    // 自動心跳回應
    this.socket.on('heartbeat_ping', (data) => {
      this.socket.emit('heartbeat_pong', { timestamp: data.timestamp });
    });

    // 心跳延遲監控
    this.socket.on('heartbeat_ack', (data) => {
      this.updateConnectionStatus('connected', data.latency);
    });

    // 接收新訊息
    this.socket.on('newMessage', (message) => {
      this.handleNewMessage(message);
    });

    // 全域通知
    this.socket.on('globalNotification', (notification) => {
      this.handleGlobalNotification(notification);
    });

    // 系統通知
    this.socket.on('systemNotification', (notification) => {
      this.handleSystemNotification(notification);
    });

    // 對話列表更新
    this.socket.on('updateConversations', (data) => {
      this.handleConversationUpdate(data);
    });

    // 斷線重連
    this.socket.on('disconnect', (reason) => {
      console.warn('WebSocket 連線斷開:', reason);
      this.handleDisconnect(reason);
    });

    // 房間事件
    this.socket.on('joinedRoom', (data) => {
      console.log('已加入聊天室:', data.conversationId);
      this.currentRoom = data.conversationId;
    });

    this.socket.on('leftRoom', (data) => {
      console.log('已離開聊天室:', data.conversationId);
      this.currentRoom = null;
    });
  }

  // 加入聊天室
  joinRoom(conversationId) {
    if (this.socket && conversationId) {
      this.socket.emit('joinRoom', { conversationId });
    }
  }

  // 離開聊天室
  leaveRoom(conversationId) {
    if (this.socket && conversationId) {
      this.socket.emit('leaveRoom', { conversationId });
    }
  }

  // 發送訊息
  sendMessage(content, conversationId, userInfo) {
    if (this.socket && content && conversationId) {
      this.socket.emit('sendMessage', {
        content,
        conversationId,
        senderId: userInfo.id,
        senderName: userInfo.name,
        senderProfilePicture: userInfo.profilePicture
      });
    }
  }

  // 處理新訊息
  handleNewMessage(message) {
    // 如果是自己發送的訊息，顯示發送成功狀態
    const isOwnMessage = message.senderId === this.getCurrentUserId();
    
    // 添加到訊息列表
    this.addMessageToUI(message, isOwnMessage);
    
    // 更新對話列表的最後訊息
    this.updateConversationLastMessage(message.conversationId, message);
  }

  // 處理全域通知
  handleGlobalNotification(notification) {
    // 顯示瀏覽器通知
    if (Notification.permission === 'granted') {
      const browserNotification = new Notification(notification.title, {
        body: notification.body,
        icon: '/icon-192.png',
        data: notification.data
      });

      // 點擊通知跳轉到對應對話
      browserNotification.onclick = () => {
        if (notification.data.conversationId) {
          this.navigateToConversation(notification.data.conversationId);
        }
        browserNotification.close();
      };
    }

    // 顯示應用內通知
    this.showInAppNotification(notification);
  }

  // 處理系統通知
  handleSystemNotification(notification) {
    this.showSystemAlert(notification);
  }

  // 處理對話列表更新
  handleConversationUpdate(data) {
    console.log('對話列表更新:', data.message);
    this.refreshConversationList();
  }

  // 處理斷線
  handleDisconnect(reason) {
    this.updateConnectionStatus('disconnected');
    
    // 自動重連邏輯
    if (reason === 'io server disconnect') {
      // 伺服器主動斷開，不自動重連
      console.log('伺服器主動斷開連線');
    } else {
      // 其他原因，嘗試重連
      this.attemptReconnect();
    }
  }

  // 嘗試重連
  attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      
      console.log(`${delay/1000}秒後嘗試第${this.reconnectAttempts}次重連...`);
      setTimeout(() => {
        this.socket.connect();
      }, delay);
    } else {
      console.error('重連次數已達上限，請手動重新整理頁面');
      this.showReconnectError();
    }
  }

  // 生成設備 ID
  generateDeviceId() {
    let deviceId = localStorage.getItem('deviceId');
    if (!deviceId) {
      deviceId = 'web-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
      localStorage.setItem('deviceId', deviceId);
    }
    return deviceId;
  }

  // 取得當前用戶 ID（需要實作）
  getCurrentUserId() {
    // 從 JWT token 或用戶狀態中取得
    return 'alice'; // 範例
  }

  // UI 更新方法（需要根據實際 UI 框架實作）
  addMessageToUI(message, isOwnMessage) {
    // 實作訊息 UI 添加邏輯
  }

  updateConversationLastMessage(conversationId, message) {
    // 實作對話列表最後訊息更新邏輯
  }

  showInAppNotification(notification) {
    // 實作應用內通知顯示邏輯
  }

  showSystemAlert(notification) {
    // 實作系統通知顯示邏輯
  }

  refreshConversationList() {
    // 實作對話列表重新載入邏輯
  }

  navigateToConversation(conversationId) {
    // 實作頁面跳轉邏輯
  }

  updateConnectionStatus(status, latency = null) {
    // 實作連線狀態顯示邏輯
  }

  showReconnectError() {
    // 實作重連錯誤顯示邏輯
  }

  // 斷開連線
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

// 使用範例
async function initWebSocket() {
  try {
    // 假設已經完成登入
    const wsTicket = 'your_ws_ticket_here';
    const accessToken = 'your_access_token_here';
    
    const wsManager = new WebSocketManager(wsTicket, accessToken);
    const connectionData = await wsManager.connect();
    
    console.log('WebSocket 初始化成功:', connectionData);
    
    // 自動加入當前查看的聊天室
    if (currentConversationId) {
      wsManager.joinRoom(currentConversationId);
    }
    
    return wsManager;
  } catch (error) {
    console.error('WebSocket 初始化失敗:', error);
    return null;
  }
}
```

---

## 完整系統整合範例

### 登入到 WebSocket 的完整流程
```javascript
class ChatApplication {
  constructor() {
    this.accessToken = null;
    this.currentUser = null;
    this.wsManager = null;
    this.notificationManager = null;
  }

  // 初始化應用程式
  async initialize() {
    try {
      // 檢查是否有已存儲的 token
      const storedToken = localStorage.getItem('accessToken');
      if (storedToken) {
        const isValid = await this.validateToken(storedToken);
        if (isValid) {
          this.accessToken = storedToken;
          await this.initializeServices();
          return true;
        } else {
          localStorage.removeItem('accessToken');
        }
      }
      
      // 顯示登入頁面
      this.showLoginPage();
      return false;
    } catch (error) {
      console.error('應用初始化失敗:', error);
      this.showLoginPage();
      return false;
    }
  }

  // Email / 密碼登入
  async login(email, password) {
    try {
      const response = await fetch('http://localhost:3050/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json();
      if (data.success) {
        // 儲存認證資訊
        this.accessToken = data.data.accessToken;
        this.currentUser = data.data.user;
        localStorage.setItem('accessToken', this.accessToken);

        // 初始化各項服務
        await this.initializeServices();
        
        // 顯示主應用界面
        this.showMainApp();
        
        return { success: true, user: this.currentUser };
      } else {
        return { success: false, message: data.message };
      }
    } catch (error) {
      console.error('登入失敗:', error);
      return { success: false, message: '網路錯誤，請稍後再試' };
    }
  }

  // 驗證 Token
  async validateToken(token) {
    try {
      const response = await fetch('http://localhost:3050/auth/validate', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      const data = await response.json();
      if (data.success) {
        this.currentUser = data.data.user;
        return true;
      }
      return false;
    } catch (error) {
      console.error('Token 驗證失敗:', error);
      return false;
    }
  }

  // 初始化各項服務
  async initializeServices() {
    try {
      // 1. 初始化 WebSocket 連線
      const wsTicket = await this.getWebSocketTicket();
      if (wsTicket) {
        this.wsManager = new WebSocketManager(wsTicket, this.accessToken);
        await this.wsManager.connect();
      }

      // 2. 初始化通知服務
      this.notificationManager = new NotificationManager(this.accessToken);
      await this.notificationManager.initialize();

      // 3. 載入對話列表
      await this.loadConversations();

      // 4. 載入用戶列表
      await this.loadUsers();

      console.log('✅ 所有服務初始化完成');
    } catch (error) {
      console.error('服務初始化失敗:', error);
    }
  }

  // 取得 WebSocket 票證
  async getWebSocketTicket() {
    try {
      // WebSocket 票證通常在登入時一起取得，或者透過獨立 API 取得
      // 這裡假設需要獨立請求
      const response = await fetch('http://localhost:3050/auth/ws-ticket', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });

      const data = await response.json();
      if (data.success) {
        return data.data.ws_ticket;
      }
      return null;
    } catch (error) {
      console.error('取得 WebSocket 票證失敗:', error);
      return null;
    }
  }

  // 載入對話列表
  async loadConversations() {
    try {
      const response = await fetch('http://localhost:3050/chat/conversations', {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });

      const data = await response.json();
      if (data.success) {
        this.updateConversationList(data.data);
      }
    } catch (error) {
      console.error('載入對話列表失敗:', error);
    }
  }

  // 載入用戶列表
  async loadUsers() {
    try {
      const response = await fetch('http://localhost:3050/users', {
        headers: { 'Authorization': `Bearer ${this.accessToken}` }
      });

      const data = await response.json();
      if (data.success) {
        this.updateUserList(data.data);
      }
    } catch (error) {
      console.error('載入用戶列表失敗:', error);
    }
  }

  // 發送訊息
  async sendMessage(content, conversationId) {
    if (this.wsManager) {
      // 透過 WebSocket 即時發送
      this.wsManager.sendMessage(content, conversationId, this.currentUser);
    } else {
      // 降級到 HTTP API
      try {
        const response = await fetch('http://localhost:3050/chat/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`
          },
          body: JSON.stringify({
            content,
            conversationId,
            senderId: this.currentUser.id
          })
        });

        const data = await response.json();
        if (data.success) {
          // 手動添加訊息到 UI
          this.addMessageToUI(data.data, true);
        }
      } catch (error) {
        console.error('發送訊息失敗:', error);
      }
    }
  }

  // 建立新聊天室
  async createRoom(memberIds, name = null) {
    try {
      const response = await fetch('http://localhost:3050/chat/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`
        },
        body: JSON.stringify({ memberIds, name })
      });

      const data = await response.json();
      if (data.success) {
        // 重新載入對話列表
        await this.loadConversations();
        return data.data;
      }
      return null;
    } catch (error) {
      console.error('建立聊天室失敗:', error);
      return null;
    }
  }

  // 上傳檔案
  async uploadFile(file, conversationId = null) {
    try {
      // 使用三步驟上傳流程
      const fileData = await uploadFile(file, 'message', conversationId);
      console.log('檔案上傳成功:', fileData);
      return fileData;
    } catch (error) {
      console.error('檔案上傳失敗:', error);
      return null;
    }
  }

  // 登出
  async logout() {
    try {
      // 清理通知服務
      if (this.notificationManager) {
        await this.notificationManager.cleanup();
      }

      // 斷開 WebSocket 連線
      if (this.wsManager) {
        this.wsManager.disconnect();
      }

      // 清除本地儲存
      localStorage.removeItem('accessToken');
      
      // 重置狀態
      this.accessToken = null;
      this.currentUser = null;
      this.wsManager = null;
      this.notificationManager = null;

      // 顯示登入頁面
      this.showLoginPage();
      
      console.log('登出成功');
    } catch (error) {
      console.error('登出時發生錯誤:', error);
    }
  }

  // UI 更新方法（需要根據實際框架實作）
  showLoginPage() {
    // 實作登入頁面顯示邏輯
  }

  showMainApp() {
    // 實作主應用界面顯示邏輯
  }

  updateConversationList(conversations) {
    // 實作對話列表更新邏輯
  }

  updateUserList(users) {
    // 實作用戶列表更新邏輯
  }

  addMessageToUI(message, isOwnMessage) {
    // 實作訊息添加到 UI 的邏輯
  }
}

// 應用程式啟動
document.addEventListener('DOMContentLoaded', async () => {
  const app = new ChatApplication();
  await app.initialize();
  
  // 將 app 實例掛載到 window 供全域使用
  window.chatApp = app;
});
```

---

## 環境配置與部署

### 開發環境
- **API Gateway**: `http://localhost:3050`
- **WebSocket 服務**: `http://localhost:3001`
- **MongoDB**: `mongodb://localhost:27017`
- **MinIO**: 內部網路存取

### 生產環境
- **API Gateway**: `https://api.yourdomain.com`
- **WebSocket 服務**: `https://ws.yourdomain.com`
- **資料庫**: 生產 MongoDB 集群
- **檔案存儲**: 生產 MinIO 集群

### 環境變數範例
```bash
# JWT 設定
JWT_SECRET=your-super-secure-jwt-secret-key

# 資料庫設定
DATABASE_URL=mongodb://localhost:27017/chat-app

# MinIO 設定
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=your-access-key
MINIO_SECRET_KEY=your-secret-key
MINIO_BUCKET_NAME=chat-files

# FCM 推播設定
FIREBASE_CONFIG_PATH=/app/keys/firebase-service-account.json
# 或使用環境變數
FCM_PROJECT_ID=your-firebase-project-id
FCM_PRIVATE_KEY=your-firebase-private-key
FCM_CLIENT_EMAIL=firebase-adminsdk-xxx@project-id.iam.gserviceaccount.com
```

### 部署命令
```bash
# 開發環境
./build.sh dev

# 生產環境  
./build.sh prod
```

---

## 完整使用範例：Alice 的一天

為了幫助前端開發人員更好地理解和使用本系統，以下以虛構人物 Alice（Example Inc. 的前端工程師）為例，示範使用聊天系統的完整流程。

### 人物設定
- **姓名**: Alice Chen（虛構人物）
- **帳號**: alice@example.com
- **部門**: Engineering
- **使用場景**: 在公司內部使用聊天系統與同事溝通、分享檔案、接收通知

### 1️⃣ 登入流程

```javascript
// Alice 開啟聊天系統網頁
async function aliceLoginFlow() {
  console.log('🏢 Alice 正在開啟聊天系統...');
  
  try {
    // 步驟 1: Email / 密碼登入
    const loginResponse = await fetch('http://localhost:3050/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'password123'
      })
    });
    
    const loginData = await loginResponse.json();
    
    if (loginData.success) {
      console.log('✅ Alice 登入成功！');
      console.log(`👤 歡迎回來，${loginData.data.user.name}`);
      
      // 儲存認證信息
      localStorage.setItem('accessToken', loginData.data.accessToken);
      localStorage.setItem('currentUser', JSON.stringify(loginData.data.user));
      
      return {
        accessToken: loginData.data.accessToken,
        user: loginData.data.user
      };
    } else {
      throw new Error(loginData.message);
    }
  } catch (error) {
    console.error('❌ Alice 登入失敗:', error);
    alert(`登入失敗: ${error.message}`);
    throw error;
  }
}
```

### 2️⃣ WebSocket 連線與心跳機制

```javascript
// Alice 連接 WebSocket 並設置心跳監控
async function aliceConnectWebSocket(accessToken) {
  try {
    // 取得 WebSocket 票證
    console.log('🎫 Alice 正在取得 WebSocket 連線票證...');
    const ticketResponse = await fetch('http://localhost:3050/auth/ws-ticket', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    const ticketData = await ticketResponse.json();
    if (!ticketData.success) {
      throw new Error('無法取得 WebSocket 票證');
    }
    
    const wsTicket = ticketData.data.ws_ticket;
    
    // 建立 WebSocket 連線
    console.log('🔌 Alice 正在連接聊天伺服器...');
    const socket = io('http://localhost:3001', {
      auth: { token: wsTicket },
      query: {
        deviceId: 'alice-laptop-001',
        platform: 'web',
        userAgent: navigator.userAgent
      },
      transports: ['websocket', 'polling'],
      upgrade: true,
      reconnection: true,
      reconnectionAttempts: 5
    });
    
    // 設置心跳監控
    setupAliceHeartbeat(socket);
    
    // 設置重連機制
    setupAliceReconnection(socket);
    
    return socket;
  } catch (error) {
    console.error('❌ user WebSocket 連線失敗:', error);
    throw error;
  }
}

// Alice 的心跳監控系統
function setupAliceHeartbeat(socket) {
  let heartbeatStats = {
    totalPings: 0,
    avgLatency: 0,
    connectionQuality: 'excellent'
  };
  
  socket.on('heartbeat_ping', (data) => {
    console.log('💓 Alice 收到伺服器心跳 ping');
    socket.emit('heartbeat_pong', { 
      timestamp: data.timestamp,
      clientTime: Date.now()
    });
  });
  
  socket.on('heartbeat_ack', (data) => {
    heartbeatStats.totalPings++;
    const latency = data.latency;
    
    // 更新統計
    heartbeatStats.avgLatency = 
      (heartbeatStats.avgLatency * (heartbeatStats.totalPings - 1) + latency) / heartbeatStats.totalPings;
    
    // 判斷連線品質
    if (latency < 50) {
      heartbeatStats.connectionQuality = '優秀';
    } else if (latency < 150) {
      heartbeatStats.connectionQuality = '良好';
    } else if (latency < 300) {
      heartbeatStats.connectionQuality = '一般';
    } else {
      heartbeatStats.connectionQuality = '較差';
    }
    
    console.log(`💓 Alice 與的連線品質: ${heartbeatStats.connectionQuality} (${latency}ms)`);
    
    // 更新 UI
    updateAliceConnectionStatus(heartbeatStats);
  });
}

// Alice 的重連機制
function setupAliceReconnection(socket) {
  socket.on('connect', () => {
    console.log('✅ Alice 已成功連接到聊天伺服器');
    showAliceNotification('✅ 已連接到聊天伺服器', 'success');
  });
  
  socket.on('disconnect', (reason) => {
    console.warn(`🔌 Alice 與伺服器的連線已斷開: ${reason}`);
    showAliceNotification('🔌 與伺服器連線已斷開，正在嘗試重連...', 'warning');
  });
  
  socket.on('reconnect_attempt', (attemptNumber) => {
    console.log(`🔄 Alice 正在進行第 ${attemptNumber} 次重連嘗試... (最多 5 次)`);
    showAliceNotification(`🔄 正在進行第 ${attemptNumber} 次重連嘗試...`, 'info');
  });
  
  socket.on('reconnect', (attemptNumber) => {
    console.log(`✅ Alice 已成功重新連接 (第 ${attemptNumber} 次嘗試)`);
    showAliceNotification('✅ 重新連線成功！', 'success');
  });
  
  socket.on('force_disconnect', (data) => {
    if (data.reason === 'connection_limit_exceeded') {
      console.warn('⚠️ Alice 在其他設備上登入，此設備連線被斷開');
      const shouldReconnect = confirm('您已在其他設備登入，是否要斷開其他設備並在此設備繼續使用？');
      if (shouldReconnect) {
        setTimeout(() => socket.connect(), 2000);
      }
    }
  });
}

// 顯示通知
function showAliceNotification(message, type = 'info') {
  const notification = document.getElementById('notification-area');
  if (notification) {
    notification.innerHTML = `
      <div class="notification ${type}">
        ${message}
      </div>
    `;
    setTimeout(() => {
      notification.innerHTML = '';
    }, 3000);
  }
}
```

### 3️⃣ 加入聊天室與發送訊息

```javascript
// Alice 加入開發團隊群聊
function aliceJoinDevTeamChat(socket) {
  const devTeamConversationId = 'conv_dev_team_huatong';
  
  console.log('👥 Alice 正在加入開發團隊群聊...');
  
  // 加入聊天室
  socket.emit('joinRoom', {
    conversationId: devTeamConversationId
  });
  
  // 監聽加入確認
  socket.on('joinedRoom', (data) => {
    if (data.conversationId === devTeamConversationId) {
      console.log('✅ Alice 已加入開發團隊群聊');
      
      // 發送打招呼訊息
      aliceSendGreeting(socket, devTeamConversationId);
    }
  });
  
  // 監聽新訊息
  socket.on('newMessage', (message) => {
    console.log(`💬 Alice 收到新訊息:`);
    console.log(`   • 寄件者: ${message.senderName}`);
    console.log(`   • 內容: ${message.content}`);
    console.log(`   • 時間: ${new Date(message.timestamp).toLocaleString('zh-TW')}`);
    
    // 更新聊天介面
    addMessageToAliceChat(message);
  });
}

// Alice 發送打招呼訊息
function aliceSendGreeting(socket, conversationId) {
  const greetingMessage = {
    content: '👋 大家好！我是user，剛剛上線了，請多多指教！',
    conversationId: conversationId,
    senderId: 'alice',
    senderName: 'user',
    senderProfilePicture: localStorage.getItem('userAvatar')
  };
  
  console.log('📤 Alice 正在發送打招呼訊息...');
  socket.emit('sendMessage', greetingMessage);
}

// Alice 發送工作相關訊息
function aliceSendWorkUpdate(socket, conversationId, workContent) {
  const workMessage = {
    content: `💼 ${workContent}`,
    conversationId: conversationId,
    senderId: 'alice',
    senderName: 'user',
    senderProfilePicture: localStorage.getItem('userAvatar')
  };
  
  console.log('💼 Alice 正在分享工作進度...');
  socket.emit('sendMessage', workMessage);
}

// 更新聊天介面
function addMessageToAliceChat(message) {
  const chatArea = document.getElementById('chat-messages');
  if (chatArea) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.senderId === 'alice' ? 'own' : 'other'}`;
    
    const time = new Date(message.timestamp).toLocaleTimeString('zh-TW', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    messageElement.innerHTML = `
      <div class="message-header">
        <img src="${message.senderProfilePicture || '/default-avatar.png'}" 
             alt="${message.senderName}" class="avatar">
        <span class="sender-name">${message.senderName}</span>
        <span class="message-time">${time}</span>
      </div>
      <div class="message-content">${message.content}</div>
    `;
    
    chatArea.appendChild(messageElement);
    chatArea.scrollTop = chatArea.scrollHeight;
    
    // 如果不是自己的訊息，顯示桂面通知
    if (message.senderId !== 'alice') {
      showAliceNotification(`${message.senderName}: ${message.content}`, 'message');
    }
  }
}
```

### 4️⃣ 檔案上傳與分享

```javascript
// Alice 上傳工作文件到開發團隊群
async function aliceUploadWorkFile(file, conversationId) {
  const accessToken = localStorage.getItem('accessToken');
  
  try {
    console.log('📦 Alice 正在上傳文件:', file.name);
    
    // 步驟 1: 請求上傳許可
    const requestResponse = await fetch('http://localhost:3050/api/files/request-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
        contentType: file.type,
        category: 'message',
        conversationId: conversationId
      })
    });
    
    const requestData = await requestResponse.json();
    if (!requestData.success) {
      throw new Error(requestData.message);
    }
    
    const { fileId, uploadUrl, expiresAt } = requestData.data;
    console.log(`🎫 Alice 已取得上傳許可 (ID: ${fileId})`);
    
    // 步驟 2: 直接上傳到 MinIO
    console.log('🚀 Alice 正在上傳文件到儲存伺服器...');
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'PUT',
      body: file,
      headers: {
        'Content-Type': file.type
      }
    });
    
    if (!uploadResponse.ok) {
      throw new Error(`上傳失敗: ${uploadResponse.statusText}`);
    }
    
    console.log('✅ 文件已上傳到儲存伺服器');
    
    // 步驟 3: 確認上傳完成
    const confirmResponse = await fetch('http://localhost:3050/api/files/confirm-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({ fileId })
    });
    
    const confirmData = await confirmResponse.json();
    if (!confirmData.success) {
      throw new Error(confirmData.message);
    }
    
    console.log('✅ Alice 的文件上傳完成！');
    
    // 在聊天中分享文件連結
    aliceShareFile(socket, conversationId, confirmData.data);
    
    return confirmData.data;
  } catch (error) {
    console.error('❌ Alice 文件上傳失敗:', error);
    alert(`文件上傳失敗: ${error.message}`);
    throw error;
  }
}

// Alice 在聊天中分享文件
function aliceShareFile(socket, conversationId, fileData) {
  const fileMessage = {
    content: `📁 我分享了一個文件: ${fileData.originalName || '文件'}\n🔗 下載連結: ${fileData.fileUrl}`,
    conversationId: conversationId,
    senderId: 'alice',
    senderName: 'user',
    senderProfilePicture: localStorage.getItem('userAvatar')
  };
  
  console.log('📁 Alice 正在分享文件連結...');
  socket.emit('sendMessage', fileMessage);
}

// 文件上傳表單事件
document.getElementById('file-upload')?.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file) {
    const conversationId = 'conv_dev_team_huatong';
    try {
      await aliceUploadWorkFile(file, conversationId);
      event.target.value = ''; // 清空輸入
    } catch (error) {
      console.error('上傳失敗:', error);
    }
  }
});
```

### 5️⃣ 推播通知設定

```javascript
// Alice 設定推播通知
async function aliceSetupNotifications() {
  const accessToken = localStorage.getItem('accessToken');
  
  try {
    // 1. 註冊設備推播 Token
    console.log('📱 Alice 正在註冊設備推播通知...');
    
    const deviceToken = 'alice_web_device_token_' + Date.now();
    
    const registerResponse = await fetch('http://localhost:3050/notifications/register-device', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        token: deviceToken,
        platform: 'web',
        deviceId: 'alice-laptop-001',
        appVersion: '1.0.0'
      })
    });
    
    const registerData = await registerResponse.json();
    if (!registerData.success) {
      throw new Error(registerData.message);
    }
    
    console.log('✅ Alice 的設備已註冊推播通知');
    
    // 2. 設定通知偏好
    const settingsResponse = await fetch('http://localhost:3050/notifications/settings', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        newMessage: true,        // 接收私人訊息通知
        groupInvite: true,       // 接收群組邀請通知
        groupMessage: true       // 接收群組訊息通知
      })
    });
    
    const settingsData = await settingsResponse.json();
    if (settingsData.success) {
      console.log('✅ Alice 的推播通知設定已更新');
      console.log('   • 私人訊息通知: 開啟');
      console.log('   • 群組邀請通知: 開啟');
      console.log('   • 群組訊息通知: 開啟');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Alice 設定推播通知失敗:', error);
    return false;
  }
}

// 監聽全域通知
function setupAliceGlobalNotifications(socket) {
  socket.on('globalNotification', (notification) => {
    console.log('🔔 Alice 收到全域通知:', notification.title);
    
    // 顯示瀟覽器通知
    if (Notification.permission === 'granted') {
      const browserNotification = new Notification(notification.title, {
        body: notification.body,
        icon: '/alice-avatar.png',
        data: notification.data
      });
      
      browserNotification.onclick = () => {
        // 跳轉到相關對話
        if (notification.data.conversationId) {
          aliceNavigateToConversation(notification.data.conversationId);
        }
        browserNotification.close();
      };
    }
    
    // 顯示應用內通知
    showAliceNotification(`🔔 ${notification.title}: ${notification.body}`, 'notification');
  });
}
```

### 6️⃣ 完整初始化流程

```javascript
// Alice 開啟聊天系統的完整流程
async function initializeAliceChatSystem() {
  try {
    console.log('🚀 Alice 正在啟動聊天系統...');
    
    // 1. 登入
    const loginResult = await aliceLoginFlow();
    
    // 2. 連接 WebSocket
    const socket = await aliceConnectWebSocket(loginResult.accessToken);
    
    // 3. 設定推播通知
    await aliceSetupNotifications();
    
    // 4. 設定全域通知監聽
    setupAliceGlobalNotifications(socket);
    
    // 5. 加入開發團隊群聊
    aliceJoinDevTeamChat(socket);
    
    // 6. 設定伺服器狀態監控
    setInterval(() => {
      checkServerStatus(socket);
    }, 30000); // 每 30 秒檢查一次
    
    console.log('✅ Alice 的聊天系統初始化完成！');
    console.log('🎉 歡迎使用內部聊天系統');
    
    // 顯示歡迎訊息
    showAliceWelcomeMessage(loginResult.user);
    
    return { socket, user: loginResult.user };
  } catch (error) {
    console.error('❌ Alice 的聊天系統初始化失敗:', error);
    alert('系統初始化失敗，請重新整理頁面');
    throw error;
  }
}

// 顯示歡迎訊息
function showAliceWelcomeMessage(user) {
  const welcomeArea = document.getElementById('welcome-message');
  if (welcomeArea) {
    welcomeArea.innerHTML = `
      <div class="welcome-card">
        <h2>🎉 歡迎使用聊天系統</h2>
        <div class="user-info">
          <img src="${user.profilePicture}" alt="${user.name}" class="user-avatar">
          <div class="user-details">
            <h3>${user.name}</h3>
            <p>${user.department}</p>
          </div>
        </div>
        <div class="system-status">
          <p>✅ 登入成功</p>
          <p>✅ WebSocket 連線成功</p>
          <p>✅ 推播通知已啟用</p>
          <p>✅ 心跳監控正常</p>
        </div>
        <p class="welcome-tip">
          💡 小提示: 您可以在左側選擇同事開始聊天，或者加入群組對話。
        </p>
      </div>
    `;
  }
}

// 應用程式啟動
document.addEventListener('DOMContentLoaded', async () => {
  console.log('🏢 聊天系統正在啟動...');
  
  try {
    const chatSystem = await initializeAliceChatSystem();
    
    // 儲存全域參考
    window.aliceChat = {
      socket: chatSystem.socket,
      user: chatSystem.user,
      sendMessage: (content, conversationId) => aliceSendWorkUpdate(chatSystem.socket, conversationId, content),
      uploadFile: (file, conversationId) => aliceUploadWorkFile(file, conversationId)
    };
    
    console.log('🎉 Alice 可以開始使用聊天系統了！');
  } catch (error) {
    console.error('系統啟動失敗:', error);
  }
});

// 登出功能
function aliceLogout() {
  console.log('👋 Alice 正在登出聊天系統...');
  
  // 斷開 WebSocket 連線
  if (window.aliceChat?.socket) {
    window.aliceChat.socket.disconnect();
  }
  
  // 清除本地儲存
  localStorage.removeItem('accessToken');
  localStorage.removeItem('currentUser');
  localStorage.removeItem('userAvatar');
  
  // 跳轉到登入頁面
  window.location.href = '/login';
  
  console.log('✅ Alice 已成功登出');
}
```

### 7️⃣ CSS 樣式範例

```css
/* Alice 使用的聊天系統樣式 */
.welcome-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px;
  border-radius: 10px;
  margin: 20px;
  text-align: center;
}

.user-info {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 20px 0;
}

.user-avatar {
  width: 60px;
  height: 60px;
  border-radius: 50%;
  margin-right: 15px;
  border: 3px solid white;
}

.connection-status {
  padding: 10px;
  border-radius: 5px;
  margin: 10px 0;
  text-align: center;
  font-weight: bold;
}

.connection-status.excellent {
  background-color: #d4edda;
  color: #155724;
  border: 1px solid #c3e6cb;
}

.connection-status.good {
  background-color: #fff3cd;
  color: #856404;
  border: 1px solid #ffeaa7;
}

.connection-status.fair {
  background-color: #f8d7da;
  color: #721c24;
  border: 1px solid #f5c6cb;
}

.message {
  margin: 10px 0;
  padding: 10px;
  border-radius: 10px;
}

.message.own {
  background-color: #007bff;
  color: white;
  margin-left: 20%;
  text-align: right;
}

.message.other {
  background-color: #f8f9fa;
  color: #333;
  margin-right: 20%;
}

.notification {
  padding: 10px;
  border-radius: 5px;
  margin: 5px 0;
}

.notification.success {
  background-color: #d4edda;
  color: #155724;
}

.notification.warning {
  background-color: #fff3cd;
  color: #856404;
}

.notification.info {
  background-color: #d1ecf1;
  color: #0c5460;
}

.server-status-panel {
  background-color: #f8f9fa;
  border: 1px solid #dee2e6;
  border-radius: 8px;
  padding: 15px;
  margin: 10px 0;
}

.status-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.status-item {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid #eee;
}

.status-item .label {
  font-weight: bold;
  color: #666;
}

.status-item .value {
  color: #333;
}
```

這個完整的範例包含了Alice 使用聊天系統的所有流程，從登入、WebSocket 連線、心跳監控、斷線重連、訊息傳送、檔案上傳到推播通知設定，都有詳細的程式碼範例和說明。前端開發人員可以直接參考這些範例來開發自己的聊天應用程式。

---

## 重要說明

### 架構特點
1. **純 gRPC 微服務**：所有後端服務僅暴露 gRPC 接口，確保高效能內部通訊
2. **API Gateway 單一入口**：統一的 HTTP 接口，自動處理 gRPC 轉換和認證
3. **Email / 密碼 + JWT 認證**：密碼以 bcrypt 雜湊保存，登入後所有請求以 JWT 驗證
4. **智能通知分發**：根據用戶狀態自動選擇 WebSocket 即時通知或推播通知

### 安全特性
1. **JWT 全面保護**：除註冊、登入外，所有 API 都需要 JWT 認證
2. **檔案權限控制**：基於對話成員身份的檔案存取權限
3. **短期 WebSocket 票證**：WebSocket 連線使用短期票證，提升安全性

### 效能特色
1. **預簽名 URL 上傳**：直接上傳到 MinIO，減少 API Gateway 負載
2. **多設備支援**：每用戶最多 5 個設備同時在線，智能負載分散
3. **自動重連機制**：WebSocket 斷線自動重連，指數退避算法
4. **統一錯誤處理**：標準化的錯誤回應格式，便於前端處理

### 開發建議
1. **統一響應格式**：所有 API 都使用 `{success, message, data}` 格式
2. **權限自動檢查**：後端自動從 JWT 解析用戶身份，前端無需傳遞
3. **分階段載入**：先載入核心功能，再逐步載入次要服務
4. **降級處理**：WebSocket 不可用時自動降級到 HTTP API

此文檔涵蓋了整個微服務聊天系統的完整 API 規範，包括所有端點的詳細請求/響應格式、完整的程式碼範例，以及實際的整合指南。開發者可以直接參考此文檔進行前端整合開發。