# WebSocket API 文檔

這份文件詳細說明了 WebSocket 伺服器提供的 API，供前端開發人員參考。

## 伺服器設置

- **伺服器埠**: `3001` (預設)
- **命名空間**: `/` (預設，未使用自定義命名空間)
- **CORS**: 允許所有來源 (`*`)

## 認證流程

1. 客戶端在連接時必須提供 JWT token:
   ```javascript
   const socket = io('http://localhost:3001', {
     auth: {
       token: 'your-jwt-token'
     }
   });
   ```
2. Token 必須包含以下資訊:
   - `sub` (用戶 ID)
   - `jti` (Token ID)
   - `aud` (audience, 必須為 'websocket')
3. 伺服器會驗證 token，驗證失敗則斷開連接。
4. 驗證成功後，伺服器會發送 `authenticated` 事件。

## 事件列表

### 連接事件

#### 伺服器發送

- **authenticated**
  - **描述**: 客戶端成功認證後發送。
  - **資料**:
    ```json
    {
      "userId": "用戶ID",
      "tokenId": "Token ID (部分顯示)",
      "platform": "平台類型 (web/ios/android)",
      "serverTime": "伺服器時間",
      "connectionId": "連接ID",
      "initialTransport": "初始傳輸方式 (polling/websocket)"
    }
    ```

- **transportUpgraded**
  - **描述**: 傳輸方式升級時發送。
  - **資料**:
    ```json
    {
      "transport": "新的傳輸方式",
      "timestamp": "時間戳"
    }
    ```

- **transportUpgradeError**
  - **描述**: 傳輸方式升級失敗時發送。
  - **資料**:
    ```json
    {
      "error": "錯誤訊息",
      "timestamp": "時間戳"
    }
    ```

### 心跳機制

#### 客戶端發送

- **heartbeat_pong**
  - **描述**: 回應伺服器的心跳請求。
  - **資料**:
    ```json
    {
      "timestamp": "伺服器發送ping時的時間戳"
    }
    ```

#### 伺服器發送

- **heartbeat_ping**
  - **描述**: 伺服器定時發送心跳請求。
  - **資料**:
    ```json
    {
      "timestamp": "時間戳",
      "serverTime": "伺服器時間",
      "tokenId": "Token ID (部分顯示)"
    }
    ```

- **heartbeat_ack**
  - **描述**: 回應客戶端的pong訊息。
  - **資料**:
    ```json
    {
      "latency": "延遲毫秒數",
      "serverTime": "伺服器時間",
      "tokenId": "Token ID (部分顯示)"
    }
    ```

### 聊天訊息

#### 客戶端發送

- **sendMessage**
  - **描述**: 發送訊息。
  - **資料**:
    ```json
    {
      "content": "訊息內容",
      "conversationId": "聊天室 ID",
      "senderName": "發送者名稱 (可選)",
      "senderProfilePicture": "發送者頭像 (可選)",
      "messageType": "訊息類型 (text/image/document/file/video, 可選，預設為text)",
      "fileInfo": {
        "fileId": "檔案 ID",
        "originalName": "原始檔案名稱",
        "fileSize": "檔案大小",
        "contentType": "內容類型",
        "downloadUrl": "下載 URL",
        "previewUrl": "預覽 URL (可選)"
      }
    }
    ```

#### 伺服器發送

- **newMessage**
  - **描述**: 收到新訊息時廣播給聊天室成員。
  - **資料**:
    ```json
    {
      "messageId": "訊息 ID",
      "content": "訊息內容",
      "conversationId": "聊天室 ID",
      "senderId": "發送者 ID",
      "senderName": "發送者名稱",
      "senderProfilePicture": "發送者頭像",
      "timestamp": "時間戳",
      "messageType": "訊息類型 (text/image/document/file/video)",
      "read_count": 0,
      "fileInfo": {
        "fileId": "檔案 ID",
        "originalName": "原始檔案名稱",
        "fileSize": "檔案大小",
        "contentType": "內容類型",
        "downloadUrl": "下載 URL",
        "previewUrl": "預覽 URL (可選)"
      }
    }
    ```

- **globalNotification**
  - **描述**: 給在線但不在聊天室的用戶發送通知。
  - **資料**:
    ```json
    {
      "type": "new_message",
      "title": "發送者名稱",
      "body": "通知內容",
      "data": {
        "conversationId": "聊天室 ID",
        "senderId": "發送者 ID",
        "messageId": "訊息 ID",
        "timestamp": "時間戳"
      }
    }
    ```

### 已讀功能

#### 客戶端發送

- **markAsRead**
  - **描述**: 標記訊息為已讀
  - **資料**:
    ```json
    {
      "conversationId": "對話 ID",
      "lastReadMessageId": "最後已讀訊息 ID"
    }
    ```

- **getReadReceipts**
  - **描述**: 查詢訊息的已讀列表（點擊「已讀 5」時使用）
  - **資料**:
    ```json
    {
      "messageId": "訊息 ID",
      "limit": 20,
      "offset": 0
    }
    ```

- **getConversationState**
  - **描述**: 查詢對話狀態（未讀數、最後已讀訊息 ID）
  - **資料**:
    ```json
    {
      "conversationId": "對話 ID"
    }
    ```

#### 伺服器發送

- **readCountUpdated**
  - **描述**: 已讀計數更新（房間廣播）
  - **資料**:
    ```json
    {
      "conversationId": "對話 ID",
      "messageIds": ["msg1", "msg2"],
      "incrementBy": 1
    }
    ```

- **markAsReadSuccess**
  - **描述**: 標記已讀成功確認
  - **資料**:
    ```json
    {
      "success": true,
      "conversationId": "對話 ID",
      "newlyReadCount": 5,
      "unreadCount": 0
    }
    ```

- **readReceipts**
  - **描述**: 已讀列表回應
  - **資料**:
    ```json
    {
      "receipts": [
        {
          "userId": "用戶 ID",
          "username": "用戶名",
          "profilePicture": "頭像 URL",
          "readAt": "2025-10-22T10:30:00Z"
        }
      ],
      "totalCount": 10
    }
    ```

- **conversationState**
  - **描述**: 對話狀態回應
  - **資料**:
    ```json
    {
      "conversationId": "對話 ID",
      "unreadCount": 5,
      "lastReadMessageId": "msg_100",
      "lastReadAt": "2025-10-22T10:30:00Z"
    }
    ```

### 聊天室管理

#### 客戶端發送

- **joinRoom**
  - **描述**: 加入聊天室。
  - **資料**:
    ```json
    {
      "conversationId": "聊天室 ID"
    }
    ```

- **leaveRoom**
  - **描述**: 離開聊天室。
  - **資料**:
    ```json
    {
      "conversationId": "聊天室 ID"
    }
    ```

#### 伺服器發送

- **joinedRoom**
  - **描述**: 成功加入聊天室後發送。
  - **資料**:
    ```json
    {
      "success": true,
      "conversationId": "聊天室 ID"
    }
    ```

- **leftRoom**
  - **描述**: 成功離開聊天室後發送。
  - **資料**:
    ```json
    {
      "success": true,
      "conversationId": "聊天室 ID"
    }
    ```

### 統計和監控

#### 客戶端發送

- **getConnectionStats**
  - **描述**: 請求伺服器連線統計資訊。

- **getUserConnections**
  - **描述**: 請求當前用戶的所有連線資訊。

- **isUserOnline**
  - **描述**: 檢查指定用戶是否在線。
  - **資料**:
    ```json
    {
      "userId": "用戶 ID"
    }
    ```

#### 伺服器發送

- **connectionStats**
  - **描述**: 回應連線統計資訊請求。
  - **資料**:
    ```json
    {
      "totalConnections": "總連線數",
      "totalUsers": "總用戶數",
      "totalTokens": "總Token數",
      "serverUptime": "伺服器運行時間(秒)",
      "memoryUsage": "記憶體使用情況",
      "platformStats": "平台統計",
      "timestamp": "時間戳"
    }
    ```

- **userConnections**
  - **描述**: 回應用戶連線資訊請求。
  - **資料**:
    ```json
    {
      "userId": "用戶 ID",
      "connections": [
        {
          "tokenId": "Token ID (部分顯示)",
          "platform": "平台類型",
          "connectedAt": "連接時間",
          "userAgent": "User Agent",
          "ipAddress": "IP 位址",
          "isCurrent": "是否為當前連接"
        }
      ],
      "totalConnections": "連線總數"
    }
    ```

- **userOnlineStatus**
  - **描述**: 回應用戶在線狀態請求。
  - **資料**:
    ```json
    {
      "userId": "用戶 ID",
      "isOnline": "是否在線",
      "connectionCount": "連線數量",
      "timestamp": "時間戳"
    }
    ```

### 系統通知

#### 伺服器發送

- **systemNotification**
  - **描述**: 系統廣播通知。
  - **資料**:
    ```json
    {
      "type": "system/maintenance/announcement",
      "title": "標題",
      "body": "內容",
      "data": "附加數據 (可選)"
    }
    ```

- **force_disconnect**
  - **描述**: 伺服器強制斷開連接。
  - **資料**:
    ```json
    {
      "reason": "斷開原因"
    }
    ```

- **server_shutdown**
  - **描述**: 伺服器關閉通知。
  - **資料**:
    ```json
    {
      "message": "關閉訊息",
      "timestamp": "時間戳"
    }
    ```

### 錯誤處理

#### 伺服器發送

- **error**
  - **描述**: 發生錯誤時發送。
  - **資料**:
    ```json
    {
      "message": "錯誤訊息"
    }
    ```

## 實作範例

### 連接並認證

```javascript
const socket = io('http://localhost:3001', {
  auth: {
    token: 'your-jwt-token'
  }
});

socket.on('authenticated', (data) => {
  console.log('認證成功', data);
});

socket.on('error', (data) => {
  console.error('錯誤', data);
});
```

### 發送訊息

```javascript
socket.emit('sendMessage', {
  content: 'Hello, world!',
  conversationId: 'conv-123',
  senderName: 'Alice',
  messageType: 'text'
});
```

### 加入聊天室

```javascript
socket.emit('joinRoom', {
  conversationId: 'conv-123'
});

socket.on('joinedRoom', (data) => {
  console.log('已加入聊天室', data);
});
```

### 處理新訊息

```javascript
socket.on('newMessage', (data) => {
  console.log('收到新訊息', data);
  // 更新UI
});
```

### 心跳處理

```javascript
socket.on('heartbeat_ping', (data) => {
  console.log('收到心跳請求', data);
  // 回應心跳
  socket.emit('heartbeat_pong', { timestamp: data.timestamp });
});

socket.on('heartbeat_ack', (data) => {
  console.log(`心跳延遲: ${data.latency}ms`);
});
```

## 注意事項

1. **連線限制**: 每個用戶最多允許5個同時連線，超過時會斷開最舊的連線。
2. **Token 唯一性**: 每個 Token 只能有一個連線，重複使用會斷開舊連線。
3. **離線處理**: 對於離線用戶，系統會自動發送推播通知。
4. **房間概念**: 所有聊天（私人或群組）都使用房間機制來管理。
5. **訊息廣播**: 訊息會同時發送給房間內的用戶和通過全局通知發送給在線但不在房間的用戶。