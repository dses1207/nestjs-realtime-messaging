# 聊天室管理 API 文檔

## 概述

本文檔說明聊天室管理相關的 4 個新 API，包含：移除成員、新增成員、刪除聊天室、更改聊天室名稱。

**Base URL:** `http://localhost:3000/chat`

**認證方式:** 所有 API 都需要 JWT Token 認證
```
Authorization: Bearer <your_jwt_token>
```

---

## 通用規則

### 權限驗證
所有 API 都會進行以下驗證：
1. JWT Token 必須有效
2. 操作者必須是聊天室成員
3. 私聊（`type === 'private'`）禁止以下操作：
   - 新增成員
   - 移除成員
   - 更改名稱
4. 群聊（`type === 'group'`）允許所有操作

### 軟刪除機制
- 刪除的聊天室會標記 `isDeleted: true`
- 已刪除的聊天室不會出現在對話列表中
- 訊息歷史會完整保留（不實際刪除）

### 回應格式
所有 API 統一使用以下格式：
```json
{
  "success": true,
  "message": "操作成功訊息",
  "data": { /* 回應資料 */ },
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z",
    "requestId": "optional-request-id"
  }
}
```

---

## API 端點

### 1️⃣ 移除聊天室成員

從群聊中移除指定成員。

**HTTP 方法:** `DELETE`
**路徑:** `/rooms/:conversationId/members/:userId`

#### Request Parameters

| 參數 | 類型 | 位置 | 必填 | 說明 |
|------|------|------|------|------|
| `conversationId` | string | Path | 是 | 聊天室 ID |
| `userId` | string | Path | 是 | 要移除的使用者 ID |

#### Request Headers
```
Authorization: Bearer <jwt_token>
```

#### Response (成功)
```json
{
  "success": true,
  "message": "User removed from conversation successfully",
  "data": {
    "removedUserId": "673e1234567890abcdef1234",
    "conversationDeleted": false
  },
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### Response (最後成員退出，自動刪除聊天室)
```json
{
  "success": true,
  "message": "User removed and conversation deleted (last member)",
  "data": {
    "removedUserId": "673e1234567890abcdef1234",
    "conversationDeleted": true
  },
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### 錯誤回應

**400 Bad Request** - 私聊無法移除成員
```json
{
  "success": false,
  "message": "Cannot remove members from private conversations",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

**403 Forbidden** - 操作者不在聊天室中
```json
{
  "success": false,
  "message": "You are not a member of this conversation",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

**404 Not Found** - 聊天室不存在
```json
{
  "success": false,
  "message": "Conversation not found",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### 業務邏輯

1. 驗證聊天室存在且未被刪除
2. 驗證是群聊（私聊禁止）
3. 驗證操作者在聊天室中
4. 驗證目標用戶在聊天室中
5. 從 `participants` 陣列移除目標用戶
6. 刪除目標用戶的 `ConversationState` 記錄
7. **特殊處理：** 如果是最後一個成員退出，自動軟刪除聊天室
8. （未來可擴展）透過 WebSocket 通知其他成員

#### 使用範例

```bash
# 使用 curl
curl -X DELETE \
  'http://localhost:3000/chat/rooms/673e1234567890abcdef5678/members/673e1234567890abcdef1234' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

# 使用 httpie
http DELETE \
  http://localhost:3000/chat/rooms/673e1234567890abcdef5678/members/673e1234567890abcdef1234 \
  "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 2️⃣ 新增成員到聊天室

批次新增成員到群聊。支援一次新增多位成員。

**HTTP 方法:** `POST`
**路徑:** `/rooms/:conversationId/members`

#### Request Parameters

| 參數 | 類型 | 位置 | 必填 | 說明 |
|------|------|------|------|------|
| `conversationId` | string | Path | 是 | 聊天室 ID |

#### Request Body

| 欄位 | 類型 | 必填 | 驗證規則 | 說明 |
|------|------|------|----------|------|
| `userIds` | string[] | 是 | 非空陣列，至少 1 個元素 | 要新增的使用者 ID 列表 |

```json
{
  "userIds": [
    "673e1234567890abcdef1234",
    "673e1234567890abcdef5678"
  ]
}
```

#### Request Headers
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Response (成功)
```json
{
  "success": true,
  "message": "Successfully added 2 user(s) to conversation",
  "data": {
    "addedUserIds": [
      "673e1234567890abcdef1234",
      "673e1234567890abcdef5678"
    ],
    "addedCount": 2
  },
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### Response (部分成員已存在)
```json
{
  "success": true,
  "message": "Successfully added 1 user(s) to conversation",
  "data": {
    "addedUserIds": [
      "673e1234567890abcdef5678"
    ],
    "addedCount": 1
  },
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### Response (所有成員已存在)
```json
{
  "success": true,
  "message": "All users are already in the conversation",
  "data": {
    "addedUserIds": [],
    "addedCount": 0
  },
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### 錯誤回應

**400 Bad Request** - 請求格式錯誤
```json
{
  "success": false,
  "message": "userIds 不可為空陣列",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

**400 Bad Request** - 私聊無法新增成員
```json
{
  "success": false,
  "message": "Cannot add members to private conversations",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### 業務邏輯

1. 驗證請求格式（DTO 驗證）
2. 驗證聊天室存在且未被刪除
3. 驗證是群聊（私聊禁止）
4. 驗證操作者在聊天室中
5. 過濾已存在的成員（去重）
6. 將新成員加入 `participants` 陣列
7. 為每個新成員建立 `ConversationState`（初始 `unread_count: 0`）
8. （未來可擴展）透過 WebSocket 通知所有成員

#### 使用範例

```bash
# 使用 curl
curl -X POST \
  'http://localhost:3000/chat/rooms/673e1234567890abcdef5678/members' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -H 'Content-Type: application/json' \
  -d '{
    "userIds": [
      "673e1234567890abcdef1234",
      "673e1234567890abcdef5678"
    ]
  }'

# 使用 httpie
http POST \
  http://localhost:3000/chat/rooms/673e1234567890abcdef5678/members \
  "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  userIds:='["673e1234567890abcdef1234", "673e1234567890abcdef5678"]'
```

---

### 3️⃣ 刪除聊天室（軟刪除）

標記聊天室為已刪除，保留訊息歷史。群聊和私聊皆可刪除。

**HTTP 方法:** `DELETE`
**路徑:** `/rooms/:conversationId`

#### Request Parameters

| 參數 | 類型 | 位置 | 必填 | 說明 |
|------|------|------|------|------|
| `conversationId` | string | Path | 是 | 聊天室 ID |

#### Request Headers
```
Authorization: Bearer <jwt_token>
```

#### Response (成功)
```json
{
  "success": true,
  "message": "Conversation deleted successfully",
  "data": {
    "deletedAt": "2025-11-11T10:30:00.000Z"
  },
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### 錯誤回應

**403 Forbidden** - 操作者不在聊天室中
```json
{
  "success": false,
  "message": "You are not a member of this conversation",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

**404 Not Found** - 聊天室不存在或已刪除
```json
{
  "success": false,
  "message": "Conversation not found or already deleted",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### 業務邏輯

1. 驗證聊天室存在且未被刪除
2. 驗證操作者在聊天室中
3. 標記 `isDeleted: true`
4. 記錄 `deletedAt` 和 `deletedBy`
5. **保留所有資料：**
   - Message 不刪除（保留歷史）
   - ConversationState 不刪除（可能需要恢復）
   - ReadReceipt 不刪除（完整性）
6. （未來可擴展）透過 WebSocket 通知所有成員

#### 資料一致性

- 已刪除的聊天室不會出現在 `getUserConversations` 列表中
- 所有查詢都會自動過濾 `isDeleted: false`
- 訊息歷史完整保留，便於稽核或恢復

#### 使用範例

```bash
# 使用 curl
curl -X DELETE \
  'http://localhost:3000/chat/rooms/673e1234567890abcdef5678' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'

# 使用 httpie
http DELETE \
  http://localhost:3000/chat/rooms/673e1234567890abcdef5678 \
  "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

---

### 4️⃣ 更改聊天室名稱

更改群聊的名稱。僅限群聊，私聊無名稱。

**HTTP 方法:** `PATCH`
**路徑:** `/rooms/:conversationId/name`

#### Request Parameters

| 參數 | 類型 | 位置 | 必填 | 說明 |
|------|------|------|------|------|
| `conversationId` | string | Path | 是 | 聊天室 ID |

#### Request Body

| 欄位 | 類型 | 必填 | 驗證規則 | 說明 |
|------|------|------|----------|------|
| `name` | string | 是 | 1-50 字元，非空白 | 新的聊天室名稱 |

```json
{
  "name": "團隊討論群組"
}
```

#### Request Headers
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Response (成功)
```json
{
  "success": true,
  "message": "Conversation name updated successfully",
  "data": {
    "newName": "團隊討論群組"
  },
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### 錯誤回應

**400 Bad Request** - 名稱格式錯誤
```json
{
  "success": false,
  "message": "名稱長度必須在 1-50 字元之間",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

**400 Bad Request** - 私聊無法更改名稱
```json
{
  "success": false,
  "message": "Cannot rename private conversations",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

**403 Forbidden** - 操作者不在聊天室中
```json
{
  "success": false,
  "message": "You are not a member of this conversation",
  "data": null,
  "meta": {
    "timestamp": "2025-11-11T10:30:00.000Z"
  }
}
```

#### 業務邏輯

1. 驗證請求格式（DTO 驗證）
2. Trim 名稱並驗證長度（1-50 字元）
3. 驗證聊天室存在且未被刪除
4. 驗證是群聊（私聊禁止）
5. 驗證操作者在聊天室中
6. 更新 `name` 欄位
7. 更新 `updatedAt` 時間戳
8. （未來可擴展）透過 WebSocket 通知所有成員

#### 使用範例

```bash
# 使用 curl
curl -X PATCH \
  'http://localhost:3000/chat/rooms/673e1234567890abcdef5678/name' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "團隊討論群組"
  }'

# 使用 httpie
http PATCH \
  http://localhost:3000/chat/rooms/673e1234567890abcdef5678/name \
  "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." \
  name="團隊討論群組"
```

---

## 資料庫變更

### Conversation Schema 新增欄位

```typescript
{
  // ... 現有欄位 ...

  // 🆕 軟刪除相關欄位
  isDeleted: boolean;           // 預設: false
  deletedAt?: Date;             // 刪除時間
  deletedBy?: ObjectId;         // 刪除者 ID (ref: User)
}
```

### 新增的索引

```typescript
// 優化軟刪除過濾查詢
ConversationSchema.index({ isDeleted: 1, lastMessageAt: -1 });
ConversationSchema.index({ participants: 1, isDeleted: 1 });
```

### 資料遷移

**無需手動遷移**
- 新欄位使用 `default: false`，現有文件會自動套用預設值
- 索引會在服務重啟後自動建立（Mongoose 自動處理）
- 完全向後相容

---

## 更新的查詢邏輯

所有現有查詢方法都已更新，自動過濾已刪除的對話：

### 受影響的方法

1. **`getUserConversations`** - 取得使用者對話列表
   ```typescript
   find({ participants: userId, isDeleted: false })
   ```

2. **`getConversationMessages`** - 取得對話訊息
   ```typescript
   findOne({ _id, participants: userId, isDeleted: false })
   ```

3. **`checkUserInConversation`** - 檢查使用者權限
   ```typescript
   findOne({ _id, participants: userId, isDeleted: false })
   ```

4. **`getOrCreatePrivateConversation`** - 取得或建立私訊
   ```typescript
   findOne({ type: 'private', participants: { $all, $size: 2 }, isDeleted: false })
   ```

---

## 測試指南

### 測試帳號

先用 `POST /auth/register` 建立測試帳號，例如：
- `alice@example.com` / `Passw0rd!`
- `bob@example.com` / `Passw0rd!`

### 測試流程

#### 1. 取得 JWT Token
```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "alice@example.com",
    "password": "Passw0rd!"
  }'
```

#### 2. 建立測試群組
```bash
curl -X POST http://localhost:3000/chat/rooms \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "memberIds": ["<user1_id>", "<user2_id>", "<user3_id>"],
    "name": "測試群組"
  }'
```

#### 3. 測試新增成員
```bash
curl -X POST http://localhost:3000/chat/rooms/<conversation_id>/members \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "userIds": ["<new_user_id>"]
  }'
```

#### 4. 測試更改名稱
```bash
curl -X PATCH http://localhost:3000/chat/rooms/<conversation_id>/name \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "新名稱"
  }'
```

#### 5. 測試移除成員
```bash
curl -X DELETE http://localhost:3000/chat/rooms/<conversation_id>/members/<user_id> \
  -H 'Authorization: Bearer <token>'
```

#### 6. 測試刪除聊天室
```bash
curl -X DELETE http://localhost:3000/chat/rooms/<conversation_id> \
  -H 'Authorization: Bearer <token>'
```

#### 7. 驗證軟刪除
```bash
# 查詢對話列表，已刪除的聊天室不應出現
curl -X GET http://localhost:3000/chat/conversations \
  -H 'Authorization: Bearer <token>'
```

---

## 注意事項

### 1. 私聊限制
- 私聊不可新增成員
- 私聊不可移除成員
- 私聊不可更改名稱
- 私聊可以刪除

### 2. 最後成員退出
當群聊的最後一個成員退出時：
- 聊天室會自動標記為已刪除
- `conversationDeleted` 欄位返回 `true`
- 訊息歷史完整保留

### 3. 權限管理
目前所有聊天室成員擁有相同權限：
- 可以新增成員
- 可以移除成員
- 可以更改名稱
- 可以刪除聊天室

**未來擴展：** 可實作角色權限系統（Owner、Admin、Member）

### 4. WebSocket 通知
目前 API 僅處理資料層面，尚未整合 WebSocket 即時通知。

**未來擴展：** 在 API Gateway 完成操作後，呼叫 WebSocket Server 廣播事件：
- `member_removed` - 成員被移除
- `member_added` - 新增成員
- `room_deleted` - 聊天室被刪除
- `room_name_updated` - 聊天室名稱更新

### 5. 資料一致性
- ConversationState 會隨成員增刪動態更新
- 移除成員時會刪除其 ConversationState
- 新增成員時會建立初始 ConversationState（`unread_count: 0`）
- 軟刪除時保留所有關聯資料

---

## 錯誤碼對照表

| HTTP 狀態碼 | 說明 | 常見原因 |
|------------|------|---------|
| 200 | 成功 | 操作成功完成 |
| 400 | 請求錯誤 | DTO 驗證失敗、私聊操作限制 |
| 401 | 未授權 | JWT Token 無效或過期 |
| 403 | 禁止訪問 | 操作者不在聊天室中 |
| 404 | 找不到資源 | 聊天室不存在或已刪除 |
| 500 | 伺服器錯誤 | 內部錯誤（資料庫、gRPC 連接等） |

---

## 部署建議

### 1. 重啟相關服務
```bash
docker compose restart chat-service api-gateway
```

### 2. 驗證服務狀態
```bash
docker compose ps
docker compose logs -f chat-service api-gateway
```

### 3. 檢查 MongoDB 索引
```javascript
// 連接到 MongoDB
use im_chat_db

// 檢查索引是否建立成功
db.conversations.getIndexes()

// 應該看到以下索引：
// { "isDeleted": 1, "lastMessageAt": -1 }
// { "participants": 1, "isDeleted": 1 }
```

### 4. 驗證 gRPC 連接
```bash
# 檢查 API Gateway 是否成功連接到 Chat Service
docker compose logs api-gateway | grep "chat-service"
```

---

## 變更日誌

### 2025-11-11
- 新增移除聊天室成員 API
- 新增批次新增成員 API
- 新增刪除聊天室 API（軟刪除）
- 新增更改聊天室名稱 API
- 更新 Conversation Schema（軟刪除欄位）
- 更新所有查詢邏輯（過濾已刪除對話）
- 建立 MongoDB 索引優化查詢效能

---

## 相關文件

- [後端架構說明](/後端架構說明.md)
- [系統訊息 API 文檔](./SYSTEM-MESSAGE-API.md)
- [Proto 定義](/services/protos/chat.proto)
- [CLAUDE.md](/CLAUDE.md)
