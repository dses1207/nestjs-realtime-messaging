# 系統訊息功能使用指南

## 概述

這是一個基於 JWT + 權限 Collection 的系統訊息發送機制，允許授權使用者：
- 批量發送系統訊息到使用者私訊或群組
- 管理系統訊息權限（授予/撤銷/列出）
- 將 System 使用者加入群組

## 初始化步驟

### 方式一：使用自動化腳本（推薦）

在專案根目錄執行以下指令：

```bash
bash services/chat-service/scripts/INIT-SYSTEM-MESSAGE.sh
```

此腳本會自動：
- 識別 MongoDB 容器名稱（不同環境自動適配）
- 建立 `system_message_permissions` collection 和索引
- 建立 System 使用者（username: system）
- 輸出 System User ID 供後續設定
- 提供清楚的後續步驟指示

**執行完成後，請按照腳本輸出的指示完成以下設定：**

1. **設定環境變數**

   在專案根目錄的 `.env.test` 檔案中加入：
   ```bash
   SYSTEM_USER_ID=腳本輸出的ID
   ```

   此環境變數用於：
   - 系統訊息推送功能（API Gateway 的 system-message.controller.ts）

2. **重啟服務**
   ```bash
   docker-compose restart api-gateway
   ```

---

### 方式二：手動執行（適用於不同環境）

如果您的環境無法使用自動化腳本，可以手動執行以下步驟：

#### 1. 建立 Collection

```bash
docker exec -i {您的MongoDB容器名稱} mongosh messageapp \
  --username admin --password admin_password --authenticationDatabase admin \
  < services/chat-service/scripts/init-permissions-collection.js
```

#### 2. 建立 System 使用者

```bash
docker exec -i {您的MongoDB容器名稱} mongosh messageapp \
  --username admin --password admin_password --authenticationDatabase admin \
  < services/chat-service/scripts/create-system-user.js
```

**記下輸出的 System User ID**，並按照方式一的步驟 1-2 完成設定。

---

### 3. 新增第一個管理員權限

由於系統需要權限才能管理權限，所以需要手動新增第一個管理員。

**連接到 MongoDB：**

```bash
# 使用自動化腳本輸出的容器名稱
docker exec -it {容器名稱} mongosh messageapp \
  --username admin --password admin_password --authenticationDatabase admin

# 或者直接查詢容器名稱
docker ps | grep mongodb
docker exec -it {查到的容器名稱} mongosh messageapp \
  --username admin --password admin_password --authenticationDatabase admin
```

**在 mongosh 中執行：**

```javascript
// 新增第一個管理員（替換成你的管理員資料）
db.system_message_permissions.insertOne({
  userId: ObjectId("你的管理員user_id"),
  username: "admin",
  isActive: true,
  grantedBy: "system",
  grantedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date()
})
```

**如何取得使用者 ID：**

在同一個 mongosh 連線中查詢：

```javascript
// 查詢使用者 ID
db.users.findOne({ username: "admin" })

// 或使用 email 查詢
db.users.findOne({ email: "admin@example.com" })
```

或透過 API 查詢：

```bash
curl http://localhost:3000/users/admin \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

完成後離開 mongosh：
```javascript
exit
```

---

## API 使用方式

### 認證

所有 API 都需要 JWT Token 認證，且使用者必須有系統訊息權限。

```bash
# 1. 先登入取得 JWT Token
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "your_password"
  }'

# 回應會包含 accessToken
# { "data": { "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." } }

# 2. 使用 Token 呼叫 API
curl -X POST http://localhost:3000/api/system/send-messages \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

---

## 權限管理 API

### 1. 列出所有權限使用者

```bash
curl -X GET http://localhost:3000/api/system/permissions \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**回應範例：**

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
    }
  ],
  "totalCount": 1
}
```

### 2. 授予權限給使用者

```bash
curl -X POST http://localhost:3000/api/system/permissions \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "507f1f77bcf86cd799439012"
  }'
```

**說明：** API 會自動從 User Service 查詢該使用者的 username，您只需提供 userId 即可。

**回應範例：**

```json
{
  "success": true,
  "message": "Permission granted to devops successfully",
  "grantedBy": "admin"
}
```

### 3. 撤銷權限

```bash
curl -X DELETE http://localhost:3000/api/system/permissions/507f1f77bcf86cd799439012 \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

**回應範例：**

```json
{
  "success": true,
  "message": "Permission revoked successfully",
  "revokedBy": "admin"
}
```

**注意：** 不能撤銷自己的權限！

---

## 系統訊息 API

### 1. 發送到特定對話（單一或多個）

```bash
curl -X POST http://localhost:3000/api/system/send-messages \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationIds": ["conv_123", "conv_456"],
    "content": "【重要公告】系統將於今晚 10:00 進行維護",
    "messageType": "text"
  }'
```

### 2. 群發給所有使用者（System 私訊）

```bash
curl -X POST http://localhost:3000/api/system/send-messages \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "【全體公告】公司春節假期通知：2月9日至2月17日放假",
    "messageType": "text"
  }'
```

**或明確指定空陣列：**

```bash
curl -X POST http://localhost:3000/api/system/send-messages \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationIds": [],
    "content": "全體公告內容",
    "messageType": "text"
  }'
```

### 3. 發送檔案訊息

```bash
curl -X POST http://localhost:3000/api/system/send-messages \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationIds": ["conv_123"],
    "content": "請查收附件",
    "messageType": "file",
    "fileId": "file_id_from_upload"
  }'
```

**回應範例：**

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

---

## 群組管理 API

### 將 System 加入群組

在發送訊息到群組之前，System 必須先加入該群組：

```bash
curl -X POST http://localhost:3000/api/system/join-group \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "group_conversation_id"
  }'
```

**回應範例：**

```json
{
  "success": true,
  "message": "User added to conversation successfully"
}
```

**之後就可以發送訊息到該群組：**

```bash
curl -X POST http://localhost:3000/api/system/send-messages \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "conversationIds": ["group_conversation_id"],
    "content": "群組公告內容"
  }'
```

---

## 使用場景範例

### 場景 1：維護通知

```bash
# 發送給所有使用者
curl -X POST http://localhost:3000/api/system/send-messages \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "【系統維護通知】\n\n時間：今晚 22:00 - 00:00\n影響：系統將暫停服務\n請提前儲存工作內容。",
    "messageType": "text"
  }'
```

### 場景 2：部門通知

```bash
# 1. 先取得部門群組的 conversationId
# 2. 確保 System 已加入該群組
curl -X POST http://localhost:3000/api/system/join-group \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{ "conversationId": "dept_group_id" }'

# 3. 發送訊息
curl -X POST http://localhost:3000/api/system/send-messages \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "conversationIds": ["dept_group_id"],
    "content": "【IT部門】本週五下午將進行網路設備升級"
  }'
```

### 場景 3：緊急公告

```bash
# 立即群發給所有人
curl -X POST http://localhost:3000/api/system/send-messages \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d '{
    "content": "🚨【緊急通知】\n\n發現系統異常，請所有使用者立即登出並重新登入。\n\n如有問題請聯繫 IT 部門。"
  }'
```

---

## 注意事項

1. **權限管理**
   - 至少要有一個使用者擁有權限
   - 不能撤銷自己的權限
   - 授予權限需要驗證目標使用者是否存在

2. **訊息發送**
   - 發送到群組前，System 必須先加入該群組
   - System 無法加入私人對話（type: 'private'）
   - 群發訊息時，系統會自動為每個使用者建立與 System 的對話

3. **效能考量**
   - 群發訊息會逐一發送，大量使用者時可能需要時間
   - 建議在低峰時段進行大規模群發
   - API 回應會立即返回，訊息在背景處理

4. **錯誤處理**
   - 如果部分訊息發送失敗，不會影響其他訊息
   - 回應中會包含詳細的成功/失敗統計

---

## 疑難排解

### 問題 1：401 Unauthorized

**原因：** JWT Token 無效或過期

**解決：** 重新登入取得新的 Token

### 問題 2：403 Forbidden - "You do not have permission to send system messages"

**原因：** 使用者沒有系統訊息權限

**解決：**
1. 確認使用者是否在權限列表中
2. 請有權限的管理員授予權限

### 問題 3：System user not found

**原因：** 沒有建立 System 使用者或環境變數未設定

**解決：**
1. 執行 `create-system-user.js` 腳本
2. 設定 `SYSTEM_USER_ID` 環境變數

### 問題 4：System user not in conversation

**原因：** System 不在該群組中

**解決：** 使用 `/api/system/join-group` API 將 System 加入群組

---

## 聯絡支援

如有問題，請聯繫系統管理員或 IT 部門。
