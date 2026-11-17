# 系統訊息 API 規格文件

## 概述

本文件提供系統訊息功能的完整 API 規格，供前端開發者整合使用。

### 功能說明

系統訊息功能允許授權管理員：
- 管理系統訊息發送權限（授予、撤銷、查詢）
- 發送系統訊息到特定對話或廣播給所有使用者
- 將 System 使用者加入群組對話

### 認證機制

所有 API 都需要以下認證：
1. **JWT Token 認證**：在 HTTP Header 中提供 `Authorization: Bearer {token}`
2. **系統訊息權限**：使用者必須擁有系統訊息發送權限

### 基礎 URL

```
http://your-api-gateway-host:3000
```

---

## 權限管理 API

### 1. 授予系統訊息權限

授予指定使用者發送系統訊息的權限。

#### 請求

```http
POST /api/system/permissions
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
```

#### 請求參數

| 參數名 | 類型 | 必填 | 說明 |
|--------|------|------|------|
| userId | string | 是 | 要授予權限的使用者 ID |

#### 請求範例

```json
{
  "userId": "507f1f77bcf86cd799439012"
}
```

**說明**：系統會自動從資料庫查詢該使用者的 username，您只需提供 userId 即可。

#### 回應格式

**成功回應 (200 OK)**

```json
{
  "success": true,
  "message": "Permission granted to devops successfully",
  "grantedBy": "admin"
}
```

| 欄位 | 類型 | 說明 |
|------|------|------|
| success | boolean | 操作是否成功 |
| message | string | 成功訊息，包含被授權使用者的 username |
| grantedBy | string | 執行授權操作的管理員 username |

#### 錯誤回應

**404 Not Found** - 使用者不存在
```json
{
  "statusCode": 404,
  "message": "User not found"
}
```

**403 Forbidden** - 當前使用者無權限
```json
{
  "statusCode": 403,
  "message": "You do not have permission to send system messages"
}
```

**401 Unauthorized** - JWT Token 無效或過期
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

---

### 2. 撤銷系統訊息權限

撤銷指定使用者的系統訊息發送權限。

#### 請求

```http
DELETE /api/system/permissions/{userId}
Authorization: Bearer {JWT_TOKEN}
```

#### 路徑參數

| 參數名 | 類型 | 必填 | 說明 |
|--------|------|------|------|
| userId | string | 是 | 要撤銷權限的使用者 ID |

#### 請求範例

```bash
DELETE /api/system/permissions/507f1f77bcf86cd799439012
```

#### 回應格式

**成功回應 (200 OK)**

```json
{
  "success": true,
  "message": "Permission revoked successfully",
  "revokedBy": "admin"
}
```

| 欄位 | 類型 | 說明 |
|------|------|------|
| success | boolean | 操作是否成功 |
| message | string | 成功訊息 |
| revokedBy | string | 執行撤銷操作的管理員 username |

#### 錯誤回應

**400 Bad Request** - 嘗試撤銷自己的權限
```json
{
  "statusCode": 400,
  "message": "Cannot revoke your own permission"
}
```

**404 Not Found** - 權限記錄不存在
```json
{
  "statusCode": 404,
  "message": "Permission not found"
}
```

---

### 3. 列出所有系統訊息權限

查詢所有擁有系統訊息發送權限的使用者列表。

#### 請求

```http
GET /api/system/permissions
Authorization: Bearer {JWT_TOKEN}
```

#### 請求參數

無

#### 回應格式

**成功回應 (200 OK)**

```json
{
  "success": true,
  "permissions": [
    {
      "userId": "507f1f77bcf86cd799439011",
      "username": "admin",
      "isActive": true,
      "grantedBy": "system",
      "grantedAt": "2024-01-01T00:00:00.000Z"
    },
    {
      "userId": "507f1f77bcf86cd799439012",
      "username": "devops",
      "isActive": true,
      "grantedBy": "admin",
      "grantedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "totalCount": 2
}
```

| 欄位 | 類型 | 說明 |
|------|------|------|
| success | boolean | 操作是否成功 |
| permissions | array | 權限列表 |
| permissions[].userId | string | 使用者 ID |
| permissions[].username | string | 使用者名稱 |
| permissions[].isActive | boolean | 權限是否啟用 |
| permissions[].grantedBy | string | 授權者 username |
| permissions[].grantedAt | string | 授權時間 (ISO 8601 格式) |
| totalCount | number | 權限總數 |

---

## 訊息發送 API

### 4. 發送系統訊息

發送系統訊息到指定對話或廣播給所有使用者。

#### 請求

```http
POST /api/system/send-messages
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
```

#### 請求參數

| 參數名 | 類型 | 必填 | 說明 |
|--------|------|------|------|
| conversationIds | string[] | 否 | 對話 ID 陣列。空陣列或不提供 = 廣播給所有使用者 |
| content | string | 是 | 訊息內容 |
| messageType | string | 否 | 訊息類型，可選值：'text'、'file'、'image'、'document'、'video'，預設為 'text' |
| fileId | string | 否 | 檔案 ID（當 messageType 為 'file'、'image'、'document' 或 'video' 時使用） |
| metadata | object | 否 | 自訂元資料 |

#### 請求範例

**範例 1：廣播給所有使用者**

```json
{
  "content": "【重要公告】系統將於今晚 22:00-00:00 進行維護",
  "messageType": "text"
}
```

或明確指定空陣列：

```json
{
  "conversationIds": [],
  "content": "【重要公告】系統將於今晚 22:00-00:00 進行維護",
  "messageType": "text"
}
```

**範例 2：發送到特定對話**

```json
{
  "conversationIds": ["conv_123", "conv_456", "conv_789"],
  "content": "【部門通知】請查收本週工作報告",
  "messageType": "text"
}
```

**範例 3：發送檔案訊息**

```json
{
  "conversationIds": ["conv_123"],
  "content": "請查收附件文件",
  "messageType": "file",
  "fileId": "file_abc123xyz"
}
```

#### 回應格式

**成功回應 (200 OK)**

```json
{
  "success": true,
  "sentBy": "admin",
  "totalTargets": 150,
  "succeeded": 148,
  "failed": 2,
  "results": [
    {
      "conversationId": "conv_123",
      "success": true,
      "messageId": "msg_456"
    },
    {
      "conversationId": "conv_789",
      "success": false,
      "error": "System user not in conversation"
    }
  ]
}
```

| 欄位 | 類型 | 說明 |
|------|------|------|
| success | boolean | 整體操作是否成功 |
| sentBy | string | 發送者 username |
| totalTargets | number | 目標對話總數 |
| succeeded | number | 成功發送的對話數 |
| failed | number | 失敗的對話數 |
| results | array | 詳細結果列表 |
| results[].conversationId | string | 對話 ID |
| results[].success | boolean | 此對話發送是否成功 |
| results[].messageId | string | 訊息 ID（成功時返回） |
| results[].error | string | 錯誤訊息（失敗時返回） |

#### 常見錯誤

**500 Internal Server Error** - System 使用者未設定
```json
{
  "statusCode": 500,
  "message": "System user not found"
}
```

---

### 5. 將 System 使用者加入群組

將 System 使用者加入指定的群組對話，之後才能發送訊息到該群組。

#### 請求

```http
POST /api/system/join-group
Authorization: Bearer {JWT_TOKEN}
Content-Type: application/json
```

#### 請求參數

| 參數名 | 類型 | 必填 | 說明 |
|--------|------|------|------|
| conversationId | string | 是 | 要加入的群組對話 ID |

#### 請求範例

```json
{
  "conversationId": "group_conv_123"
}
```

#### 回應格式

**成功回應 (200 OK)**

```json
{
  "success": true,
  "message": "User added to conversation successfully"
}
```

| 欄位 | 類型 | 說明 |
|------|------|------|
| success | boolean | 操作是否成功 |
| message | string | 成功訊息 |

#### 錯誤回應

**400 Bad Request** - 對話不存在或不是群組
```json
{
  "statusCode": 400,
  "message": "Invalid conversation"
}
```

**500 Internal Server Error** - System 使用者未設定
```json
{
  "statusCode": 500,
  "message": "System user not found"
}
```

---

## 錯誤處理

### HTTP 狀態碼

| 狀態碼 | 說明 | 常見原因 |
|--------|------|----------|
| 200 | 成功 | 請求成功執行 |
| 400 | 錯誤的請求 | 參數格式錯誤、嘗試撤銷自己的權限 |
| 401 | 未授權 | JWT Token 無效或過期 |
| 403 | 禁止訪問 | 使用者無系統訊息權限 |
| 404 | 找不到資源 | 使用者或權限記錄不存在 |
| 500 | 伺服器錯誤 | System 使用者未設定、gRPC 服務錯誤 |

### 錯誤回應格式

所有錯誤回應都遵循以下格式：

```json
{
  "statusCode": 400,
  "message": "錯誤描述訊息",
  "error": "Bad Request"
}
```

---

## 注意事項

### 1. 權限管理

- 至少要有一位使用者擁有系統訊息權限
- 管理員不能撤銷自己的權限（防止系統無管理員）
- 授予權限前會自動驗證目標使用者是否存在

### 2. 訊息發送

- **群組訊息**：發送到群組前，System 必須先使用 `/api/system/join-group` 加入該群組
- **私人訊息**：System 無法手動加入私人對話（type: 'private'）
- **廣播訊息**：不提供 `conversationIds` 或提供空陣列時，會自動發送給所有使用者
- **使用者登入**：使用者登入時會自動建立與 System 的私訊對話

### 3. 效能考量

- 廣播訊息會逐一發送，大量使用者時可能需要時間
- 建議在低峰時段進行大規模廣播
- API 回應會立即返回，訊息在背景處理
- 回應中包含詳細的成功/失敗統計

### 4. 初始化要求

使用系統訊息功能前，需要完成以下設定：

1. **執行初始化腳本**
   ```bash
   bash services/chat-service/scripts/INIT-SYSTEM-MESSAGE.sh
   ```

2. **設定環境變數**
   在 `.env.test` 中設定：
   ```
   SYSTEM_USER_ID=<從腳本輸出取得的 ID>
   ```

3. **新增第一個管理員**
   手動在資料庫中新增第一個擁有權限的管理員

4. **重啟服務**
   ```bash
   docker-compose restart api-gateway
   ```

詳細步驟請參考：`services/chat-service/scripts/SYSTEM-MESSAGE-GUIDE.md`

---

## 相關文件

- [系統訊息功能完整指南](../../chat-service/scripts/SYSTEM-MESSAGE-GUIDE.md)
- [初始化腳本](../../chat-service/scripts/INIT-SYSTEM-MESSAGE.sh)
- [WebSocket API 指南](../../chat-service/scripts/WEBSOCKET-API-GUIDE.md)

---

## 🆘 疑難排解

### Q: 401 Unauthorized 錯誤

**原因**：JWT Token 無效或過期

**解決方法**：
1. 檢查 Token 是否正確
2. 重新登入取得新的 Token
3. 確認 Token 格式：`Authorization: Bearer {token}`

### Q: 403 Forbidden 錯誤

**原因**：使用者沒有系統訊息權限

**解決方法**：
1. 呼叫 `GET /api/system/permissions` 確認當前使用者是否在列表中
2. 請有權限的管理員使用 `POST /api/system/permissions` 授予權限

### Q: System user not found 錯誤

**原因**：System 使用者未建立或環境變數未設定

**解決方法**：
1. 執行初始化腳本：`bash services/chat-service/scripts/INIT-SYSTEM-MESSAGE.sh`
2. 設定 `SYSTEM_USER_ID` 環境變數
3. 重啟 API Gateway 服務

### Q: System user not in conversation 錯誤

**原因**：System 使用者不在目標群組中

**解決方法**：
1. 先呼叫 `POST /api/system/join-group` 將 System 加入群組
2. 再發送訊息到該群組

### Q: 部分訊息發送失敗

**原因**：某些對話可能存在問題（例如已刪除、System 未加入等）

**處理方式**：
1. 檢查回應中的 `results` 陣列
2. 找出 `success: false` 的項目
3. 根據 `error` 欄位的訊息進行對應處理

---

## 技術支援

如有問題，請聯繫：
- 系統管理員
- IT 部門
- 後端開發團隊

**文件版本**：v1.0
**最後更新**：2024-01-20
