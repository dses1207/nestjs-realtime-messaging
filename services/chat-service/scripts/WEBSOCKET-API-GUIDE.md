# WebSocket 已讀系統 API 使用指南

## 概述

此文檔說明如何使用 WebSocket API 實現已讀/未讀訊息功能。

**WebSocket Server 位置：** `ws://{host}:3001` (測試環境使用 .env.test 配置)

**支援平台：**
- Flutter (Dart) - 使用 `socket_io_client: ^3.1.2`
- Web (JavaScript/TypeScript) - 使用 `socket.io-client`
- React / Vue / Angular

---

## 快速導航

- [Flutter 整合指南](#-flutter-整合指南) **推薦 Flutter 開發者直接跳到此章節**
- [JavaScript/TypeScript 整合指南](#-連線與認證-javascripttypescript)

---

## 連線與認證 (JavaScript/TypeScript)

### 建立 WebSocket 連線

```javascript
import io from 'socket.io-client';

const socket = io('ws://localhost:3001', {
  auth: {
    token: 'YOUR_JWT_TOKEN'  // 從登入 API 取得的 JWT token
  },
  transports: ['websocket']
});

// 連線成功
socket.on('connect', () => {
  console.log('✅ WebSocket 已連線');
});

// 連線錯誤
socket.on('connect_error', (error) => {
  console.error('❌ WebSocket 連線失敗:', error);
});
```

### 加入對話房間

在操作已讀功能之前，必須先加入對話房間：

```javascript
socket.emit('joinRoom', {
  conversationId: '67890abc...'
});

socket.on('joinedRoom', (data) => {
  console.log('已加入房間:', data.conversationId);
});
```

---

## 已讀系統 API

### 1. 標記訊息為已讀

**客戶端發送：** `markAsRead`

**使用時機：**
- 用戶進入對話視窗時
- 用戶滑動到訊息列表底部時
- 用戶切換回應用程式時（從背景返回）

**請求格式：**
```typescript
interface MarkAsReadRequest {
  conversationId: string;      // 對話 ID
  lastReadMessageId: string;   // 最後已讀的訊息 ID
}
```

**範例程式碼：**
```javascript
// 當用戶看到某則訊息時，標記為已讀
socket.emit('markAsRead', {
  conversationId: '67890abc...',
  lastReadMessageId: '12345def...'  // 當前畫面上最新的訊息 ID
});
```

**伺服器回應：** `markAsReadSuccess`

```typescript
interface MarkAsReadResponse {
  success: boolean;
  newlyReadCount: number;      // 本次新標記的訊息數量
  unreadCount: number;         // 更新後的未讀數量（應為 0）
}
```

**監聽回應：**
```javascript
socket.on('markAsReadSuccess', (data) => {
  console.log(`✅ 已標記 ${data.newlyReadCount} 則訊息為已讀`);
  console.log(`未讀數量: ${data.unreadCount}`);

  // 更新 UI 的未讀計數
  updateUnreadBadge(data.unreadCount);
});
```

**廣播事件：** `readCountUpdated`

**重要：** 當你標記訊息為已讀時，房間內所有其他用戶會收到此廣播，用於即時更新 "已讀 X" 的顯示。

```typescript
interface ReadCountUpdatedEvent {
  conversationId: string;
  messageIds: string[];        // 受影響的訊息 ID 列表
  incrementBy: number;         // 已讀數增加量（通常是 1）
}
```

**監聽廣播：**
```javascript
socket.on('readCountUpdated', (data) => {
  console.log(`訊息已讀數更新: ${data.messageIds.length} 則訊息`);

  // 更新訊息列表中的已讀計數
  data.messageIds.forEach(messageId => {
    updateMessageReadCount(messageId, data.incrementBy);
  });
});
```

---

### 2. 查詢已讀列表（"已讀 5" 點擊詳情）

**客戶端發送：** `getReadReceipts`

**使用時機：**
- 用戶點擊 "已讀 5" 查看詳細名單
- 需要分頁加載更多已讀用戶

**請求格式：**
```typescript
interface GetReadReceiptsRequest {
  messageId: string;           // 訊息 ID
  limit?: number;              // 每頁數量（預設 20）
  offset?: number;             // 偏移量（預設 0）
}
```

**範例程式碼：**
```javascript
// 點擊 "已讀 5" 時
function showReadReceipts(messageId) {
  socket.emit('getReadReceipts', {
    messageId: messageId,
    limit: 20,
    offset: 0
  });
}

// 加載更多（分頁）
function loadMoreReadReceipts(messageId, currentPage) {
  socket.emit('getReadReceipts', {
    messageId: messageId,
    limit: 20,
    offset: currentPage * 20
  });
}
```

**伺服器回應：** `readReceipts`

```typescript
interface ReadReceipt {
  user_id: string;             // 用戶 ID
  username: string;            // 用戶名稱
  profile_picture?: string;    // 用戶頭像 URL
  read_at: Date;               // 已讀時間
}

interface ReadReceiptsResponse {
  receipts: ReadReceipt[];     // 已讀用戶列表
  totalCount: number;          // 總已讀人數
}
```

**監聽回應：**
```javascript
socket.on('readReceipts', (data) => {
  console.log(`總共 ${data.totalCount} 人已讀`);

  // 顯示已讀列表
  data.receipts.forEach(receipt => {
    console.log(`${receipt.username} 於 ${receipt.read_at} 已讀`);
  });

  // 渲染 UI
  renderReadReceiptsList(data.receipts, data.totalCount);
});
```

---

### 3. 查詢對話狀態（未讀數、最後已讀位置）

**客戶端發送：** `getConversationState`

**使用時機：**
- 進入對話時獲取未讀數量
- 需要知道用戶上次讀到哪裡

**請求格式：**
```typescript
interface GetConversationStateRequest {
  conversationId: string;      // 對話 ID
}
```

**範例程式碼：**
```javascript
// 進入對話時
function enterConversation(conversationId) {
  socket.emit('getConversationState', {
    conversationId: conversationId
  });
}
```

**伺服器回應：** `conversationState`

```typescript
interface ConversationStateResponse {
  unreadCount: number;         // 未讀訊息數量
  lastReadMessageId: string | null;  // 最後已讀訊息 ID
  lastReadAt: Date | null;     // 最後已讀時間
}
```

**監聽回應：**
```javascript
socket.on('conversationState', (data) => {
  console.log(`未讀數量: ${data.unreadCount}`);
  console.log(`最後已讀訊息 ID: ${data.lastReadMessageId}`);

  // 更新 UI
  updateUnreadBadge(data.unreadCount);

  // 滾動到上次閱讀位置
  if (data.lastReadMessageId) {
    scrollToMessage(data.lastReadMessageId);
  }
});
```

---

## 完整使用範例

### React/Vue 前端整合範例

```typescript
import { useEffect, useState } from 'react';
import io, { Socket } from 'socket.io-client';

interface Message {
  _id: string;
  content: string;
  senderId: string;
  read_count: number;
  // ... 其他欄位
}

function ChatRoom({ conversationId, currentUserId, jwtToken }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  // 1. 建立 WebSocket 連線
  useEffect(() => {
    const newSocket = io('ws://localhost:3001', {
      auth: { token: jwtToken },
      transports: ['websocket']
    });

    newSocket.on('connect', () => {
      console.log('✅ WebSocket 已連線');

      // 加入房間
      newSocket.emit('joinRoom', { conversationId });
    });

    newSocket.on('joinedRoom', () => {
      console.log('✅ 已加入對話房間');

      // 查詢對話狀態
      newSocket.emit('getConversationState', { conversationId });
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, [conversationId, jwtToken]);

  // 2. 監聽對話狀態
  useEffect(() => {
    if (!socket) return;

    socket.on('conversationState', (data) => {
      setUnreadCount(data.unreadCount);
      console.log(`未讀數量: ${data.unreadCount}`);
    });

    return () => {
      socket.off('conversationState');
    };
  }, [socket]);

  // 3. 監聽已讀計數更新（其他人讀了你的訊息）
  useEffect(() => {
    if (!socket) return;

    socket.on('readCountUpdated', (data) => {
      console.log('已讀數更新:', data);

      // 更新訊息的 read_count
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          data.messageIds.includes(msg._id)
            ? { ...msg, read_count: msg.read_count + data.incrementBy }
            : msg
        )
      );
    });

    return () => {
      socket.off('readCountUpdated');
    };
  }, [socket]);

  // 4. 當用戶滾動到底部時，標記為已讀
  const markAsRead = (lastMessageId: string) => {
    if (!socket) return;

    socket.emit('markAsRead', {
      conversationId,
      lastReadMessageId: lastMessageId
    });
  };

  // 5. 監聽標記成功
  useEffect(() => {
    if (!socket) return;

    socket.on('markAsReadSuccess', (data) => {
      console.log(`✅ 已標記 ${data.newlyReadCount} 則訊息為已讀`);
      setUnreadCount(data.unreadCount);
    });

    return () => {
      socket.off('markAsReadSuccess');
    };
  }, [socket]);

  // 6. 查詢已讀列表
  const showReadReceipts = (messageId: string) => {
    if (!socket) return;

    socket.emit('getReadReceipts', {
      messageId,
      limit: 20,
      offset: 0
    });

    socket.once('readReceipts', (data) => {
      console.log(`總共 ${data.totalCount} 人已讀`);
      // 顯示已讀列表 Modal/Drawer
      showReadReceiptsModal(data.receipts, data.totalCount);
    });
  };

  // 7. UI 渲染
  return (
    <div>
      <div className="chat-header">
        <h2>對話</h2>
        {unreadCount > 0 && (
          <span className="unread-badge">{unreadCount}</span>
        )}
      </div>

      <div className="messages">
        {messages.map(msg => (
          <div key={msg._id} className="message">
            <p>{msg.content}</p>

            {/* 只有自己發送的訊息才顯示已讀數 */}
            {msg.senderId === currentUserId && msg.read_count > 0 && (
              <span
                className="read-count"
                onClick={() => showReadReceipts(msg._id)}
                style={{ cursor: 'pointer', color: 'blue' }}
              >
                已讀 {msg.read_count}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* 滾動到底部時標記為已讀 */}
      <button onClick={() => {
        const lastMessage = messages[messages.length - 1];
        if (lastMessage) {
          markAsRead(lastMessage._id);
        }
      }}>
        標記為已讀
      </button>
    </div>
  );
}

export default ChatRoom;
```

---

## 判斷訊息是否已讀的邏輯

**重要：** 系統不會為每則訊息返回 `isReadByMe` 欄位，你需要在客戶端自行判斷。

### 判斷邏輯

```typescript
interface Message {
  _id: string;           // 訊息 ID (ObjectId)
  content: string;
  senderId: string;
  read_count: number;    // 已讀人數（不包含發送者自己）
  // ...
}

interface ConversationState {
  lastReadMessageId: string;  // 最後已讀訊息 ID
  unreadCount: number;
}

/**
 * 判斷訊息是否已讀
 * 邏輯：如果訊息 ID <= lastReadMessageId，則為已讀
 */
function isMessageReadByMe(
  messageId: string,
  lastReadMessageId: string | null
): boolean {
  if (!lastReadMessageId) return false;

  // MongoDB ObjectId 可以直接字串比較（因為包含時間戳）
  return messageId <= lastReadMessageId;
}

// 使用範例
function renderMessage(message: Message, conversationState: ConversationState) {
  const isRead = isMessageReadByMe(message._id, conversationState.lastReadMessageId);

  return (
    <div className={isRead ? 'message-read' : 'message-unread'}>
      <p>{message.content}</p>
      {isRead ? '✓✓' : '✓'}  {/* WhatsApp 風格的已讀標記 */}
    </div>
  );
}
```

---

## UI 設計建議

### 1. 訊息列表顯示

```jsx
{messages.map(msg => (
  <div key={msg._id} className="message">
    {/* 訊息內容 */}
    <p>{msg.content}</p>

    {/* 已讀狀態（只顯示在自己發送的訊息） */}
    {msg.senderId === currentUserId && (
      <div className="message-status">
        {isMessageReadByMe(msg._id, conversationState.lastReadMessageId) ? (
          // 已讀
          msg.read_count > 0 ? (
            <span
              onClick={() => showReadReceipts(msg._id)}
              style={{ cursor: 'pointer', color: '#4A90E2' }}
            >
              已讀 {msg.read_count}
            </span>
          ) : (
            <span style={{ color: '#999' }}>✓ 已傳送</span>
          )
        ) : (
          // 未讀
          <span style={{ color: '#999' }}>✓ 已傳送</span>
        )}
      </div>
    )}
  </div>
))}
```

### 2. 對話列表顯示未讀數

```jsx
{conversations.map(conv => (
  <div key={conv._id} className="conversation-item">
    <img src={conv.avatar} alt={conv.name} />
    <div>
      <h3>{conv.name}</h3>
      <p>{conv.lastMessage}</p>
    </div>

    {/* 未讀數 Badge */}
    {conv.unread_count > 0 && (
      <span className="unread-badge">{conv.unread_count}</span>
    )}
  </div>
))}
```

### 3. 已讀列表 Modal

```jsx
function ReadReceiptsModal({ messageId, socket }) {
  const [receipts, setReceipts] = useState([]);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    socket.emit('getReadReceipts', { messageId, limit: 20, offset: 0 });

    socket.once('readReceipts', (data) => {
      setReceipts(data.receipts);
      setTotalCount(data.totalCount);
    });
  }, [messageId, socket]);

  return (
    <div className="modal">
      <h2>已讀 {totalCount}</h2>
      <ul>
        {receipts.map(receipt => (
          <li key={receipt.user_id}>
            <img src={receipt.profile_picture} alt={receipt.username} />
            <div>
              <p>{receipt.username}</p>
              <small>{new Date(receipt.read_at).toLocaleString()}</small>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

---

## 性能優化建議

### 1. 批次標記已讀

避免每則訊息都發送一次 `markAsRead`，應該在適當時機批次標記：

```javascript
// ❌ 不好的做法
messages.forEach(msg => {
  socket.emit('markAsRead', { conversationId, lastReadMessageId: msg._id });
});

// ✅ 好的做法
const lastMessage = messages[messages.length - 1];
socket.emit('markAsRead', {
  conversationId,
  lastReadMessageId: lastMessage._id
});
```

### 2. 使用 Debounce 避免頻繁更新

```javascript
import { debounce } from 'lodash';

const markAsReadDebounced = debounce((lastMessageId) => {
  socket.emit('markAsRead', {
    conversationId,
    lastReadMessageId: lastMessageId
  });
}, 1000);  // 1 秒內只發送一次

// 滾動事件
onScroll(() => {
  const lastVisibleMessage = getLastVisibleMessage();
  markAsReadDebounced(lastVisibleMessage._id);
});
```

### 3. 離開頁面時標記已讀

```javascript
useEffect(() => {
  const handleBeforeUnload = () => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage) {
      socket.emit('markAsRead', {
        conversationId,
        lastReadMessageId: lastMessage._id
      });
    }
  };

  window.addEventListener('beforeunload', handleBeforeUnload);
  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
}, [messages, conversationId, socket]);
```

---

## 錯誤處理

```javascript
// 監聽錯誤事件
socket.on('error', (error) => {
  console.error('WebSocket 錯誤:', error);

  // 顯示錯誤提示
  showErrorToast('操作失敗，請重試');
});

// 標記已讀失敗處理
socket.on('markAsReadSuccess', (data) => {
  if (!data.success) {
    console.error('標記已讀失敗');
    showErrorToast('標記已讀失敗');
  }
});

// 斷線重連
socket.on('disconnect', (reason) => {
  console.warn('WebSocket 斷線:', reason);

  if (reason === 'io server disconnect') {
    // 伺服器主動斷線，需要手動重連
    socket.connect();
  }
  // 其他情況會自動重連
});

socket.on('reconnect', (attemptNumber) => {
  console.log('WebSocket 重連成功:', attemptNumber);

  // 重新加入房間
  socket.emit('joinRoom', { conversationId });
});
```

---

## TypeScript 型別定義

```typescript
// events.types.ts
export interface MarkAsReadRequest {
  conversationId: string;
  lastReadMessageId: string;
}

export interface MarkAsReadResponse {
  success: boolean;
  newlyReadCount: number;
  unreadCount: number;
}

export interface GetReadReceiptsRequest {
  messageId: string;
  limit?: number;
  offset?: number;
}

export interface ReadReceipt {
  user_id: string;
  username: string;
  profile_picture?: string;
  read_at: Date;
}

export interface ReadReceiptsResponse {
  receipts: ReadReceipt[];
  totalCount: number;
}

export interface GetConversationStateRequest {
  conversationId: string;
}

export interface ConversationStateResponse {
  unreadCount: number;
  lastReadMessageId: string | null;
  lastReadAt: Date | null;
}

export interface ReadCountUpdatedEvent {
  conversationId: string;
  messageIds: string[];
  incrementBy: number;
}

// Socket 事件型別定義
export interface ServerToClientEvents {
  markAsReadSuccess: (data: MarkAsReadResponse) => void;
  readReceipts: (data: ReadReceiptsResponse) => void;
  conversationState: (data: ConversationStateResponse) => void;
  readCountUpdated: (data: ReadCountUpdatedEvent) => void;
  joinedRoom: (data: { conversationId: string }) => void;
  error: (error: { message: string }) => void;
}

export interface ClientToServerEvents {
  markAsRead: (data: MarkAsReadRequest) => void;
  getReadReceipts: (data: GetReadReceiptsRequest) => void;
  getConversationState: (data: GetConversationStateRequest) => void;
  joinRoom: (data: { conversationId: string }) => void;
}
```

---

## Flutter 整合指南

### 安裝套件

在 `pubspec.yaml` 中新增：

```yaml
dependencies:
  socket_io_client: ^3.1.2
```

執行安裝：
```bash
flutter pub get
```

---

### 建立 Socket Service (推薦架構)

創建一個 `SocketService` 類別來管理 WebSocket 連線：

```dart
// lib/services/socket_service.dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

class SocketService {
  static final SocketService _instance = SocketService._internal();
  factory SocketService() => _instance;
  SocketService._internal();

  IO.Socket? _socket;
  IO.Socket get socket => _socket!;

  /// 連線到 WebSocket 伺服器
  void connect(String token) {
    _socket = IO.io(
      'http://localhost:3001',  // 測試環境位址
      IO.OptionBuilder()
          .setTransports(['websocket'])  // ⚠️ Flutter 必須設定此項
          .setAuth({'token': token})     // JWT 認證
          .enableForceNew()              // 強制建立新連線
          .setReconnectionAttempts(5)    // 重連次數
          .setReconnectionDelay(1000)    // 重連延遲 (毫秒)
          .build(),
    );

    // 連線成功
    _socket!.onConnect((_) {
      print('✅ WebSocket 已連線');
    });

    // 連線錯誤
    _socket!.onConnectError((error) {
      print('❌ WebSocket 連線失敗: $error');
    });

    // 斷線
    _socket!.onDisconnect((_) {
      print('⚠️ WebSocket 已斷線');
    });

    // 重連
    _socket!.onReconnect((_) {
      print('🔄 WebSocket 重新連線成功');
    });
  }

  /// 斷開連線
  void disconnect() {
    _socket?.disconnect();
    _socket?.dispose();
  }

  /// 加入對話房間
  void joinRoom(String conversationId) {
    _socket?.emit('joinRoom', {'conversationId': conversationId});
  }

  /// 離開對話房間
  void leaveRoom(String conversationId) {
    _socket?.emit('leaveRoom', {'conversationId': conversationId});
  }

  /// 標記訊息為已讀
  void markAsRead({
    required String conversationId,
    required String lastReadMessageId,
  }) {
    _socket?.emit('markAsRead', {
      'conversationId': conversationId,
      'lastReadMessageId': lastReadMessageId,
    });
  }

  /// 查詢已讀列表
  void getReadReceipts({
    required String messageId,
    int limit = 20,
    int offset = 0,
  }) {
    _socket?.emit('getReadReceipts', {
      'messageId': messageId,
      'limit': limit,
      'offset': offset,
    });
  }

  /// 查詢對話狀態
  void getConversationState(String conversationId) {
    _socket?.emit('getConversationState', {
      'conversationId': conversationId,
    });
  }

  /// 監聽事件
  void on(String event, Function(dynamic) handler) {
    _socket?.on(event, handler);
  }

  /// 取消監聽事件
  void off(String event) {
    _socket?.off(event);
  }
}
```

---

### 資料模型 (Data Models)

```dart
// lib/models/read_receipt.dart

class ReadReceipt {
  final String userId;
  final String username;
  final String? profilePicture;
  final DateTime readAt;

  ReadReceipt({
    required this.userId,
    required this.username,
    this.profilePicture,
    required this.readAt,
  });

  factory ReadReceipt.fromJson(Map<String, dynamic> json) {
    return ReadReceipt(
      userId: json['user_id'] as String,
      username: json['username'] as String,
      profilePicture: json['profile_picture'] as String?,
      readAt: DateTime.parse(json['read_at'] as String),
    );
  }
}

class ReadReceiptsResponse {
  final List<ReadReceipt> receipts;
  final int totalCount;

  ReadReceiptsResponse({
    required this.receipts,
    required this.totalCount,
  });

  factory ReadReceiptsResponse.fromJson(Map<String, dynamic> json) {
    return ReadReceiptsResponse(
      receipts: (json['receipts'] as List)
          .map((item) => ReadReceipt.fromJson(item as Map<String, dynamic>))
          .toList(),
      totalCount: json['totalCount'] as int,
    );
  }
}

class ConversationState {
  final int unreadCount;
  final String? lastReadMessageId;
  final DateTime? lastReadAt;

  ConversationState({
    required this.unreadCount,
    this.lastReadMessageId,
    this.lastReadAt,
  });

  factory ConversationState.fromJson(Map<String, dynamic> json) {
    return ConversationState(
      unreadCount: json['unreadCount'] as int,
      lastReadMessageId: json['lastReadMessageId'] as String?,
      lastReadAt: json['lastReadAt'] != null
          ? DateTime.parse(json['lastReadAt'] as String)
          : null,
    );
  }
}

class MarkAsReadResponse {
  final bool success;
  final int newlyReadCount;
  final int unreadCount;

  MarkAsReadResponse({
    required this.success,
    required this.newlyReadCount,
    required this.unreadCount,
  });

  factory MarkAsReadResponse.fromJson(Map<String, dynamic> json) {
    return MarkAsReadResponse(
      success: json['success'] as bool,
      newlyReadCount: json['newlyReadCount'] as int,
      unreadCount: json['unreadCount'] as int,
    );
  }
}

class ReadCountUpdatedEvent {
  final String conversationId;
  final List<String> messageIds;
  final int incrementBy;

  ReadCountUpdatedEvent({
    required this.conversationId,
    required this.messageIds,
    required this.incrementBy,
  });

  factory ReadCountUpdatedEvent.fromJson(Map<String, dynamic> json) {
    return ReadCountUpdatedEvent(
      conversationId: json['conversationId'] as String,
      messageIds: (json['messageIds'] as List).cast<String>(),
      incrementBy: json['incrementBy'] as int,
    );
  }
}

class Message {
  final String id;
  final String content;
  final String senderId;
  final int readCount;
  final DateTime timestamp;

  Message({
    required this.id,
    required this.content,
    required this.senderId,
    required this.readCount,
    required this.timestamp,
  });

  // 複製並更新 readCount
  Message copyWithReadCount(int newReadCount) {
    return Message(
      id: id,
      content: content,
      senderId: senderId,
      readCount: newReadCount,
      timestamp: timestamp,
    );
  }
}
```

---

### ChatRoom Widget 完整範例

```dart
// lib/screens/chat_room_screen.dart
import 'package:flutter/material.dart';
import '../services/socket_service.dart';
import '../models/read_receipt.dart';

class ChatRoomScreen extends StatefulWidget {
  final String conversationId;
  final String currentUserId;
  final String jwtToken;

  const ChatRoomScreen({
    Key? key,
    required this.conversationId,
    required this.currentUserId,
    required this.jwtToken,
  }) : super(key: key);

  @override
  State<ChatRoomScreen> createState() => _ChatRoomScreenState();
}

class _ChatRoomScreenState extends State<ChatRoomScreen> {
  final SocketService _socketService = SocketService();
  final ScrollController _scrollController = ScrollController();

  List<Message> _messages = [];
  int _unreadCount = 0;
  String? _lastReadMessageId;

  @override
  void initState() {
    super.initState();
    _initializeSocket();
    _setupSocketListeners();
    _scrollController.addListener(_onScroll);
  }

  void _initializeSocket() {
    // 建立連線
    _socketService.connect(widget.jwtToken);

    // 加入房間
    _socketService.on('connect', (_) {
      _socketService.joinRoom(widget.conversationId);
    });

    // 房間加入成功
    _socketService.on('joinedRoom', (data) {
      print('✅ 已加入房間: ${data['conversationId']}');
      // 查詢對話狀態
      _socketService.getConversationState(widget.conversationId);
    });
  }

  void _setupSocketListeners() {
    // 1. 監聽對話狀態
    _socketService.on('conversationState', (data) {
      final state = ConversationState.fromJson(data as Map<String, dynamic>);
      setState(() {
        _unreadCount = state.unreadCount;
        _lastReadMessageId = state.lastReadMessageId;
      });
      print('未讀數量: ${state.unreadCount}');
    });

    // 2. 監聽已讀計數更新（其他人讀了你的訊息）
    _socketService.on('readCountUpdated', (data) {
      final event = ReadCountUpdatedEvent.fromJson(data as Map<String, dynamic>);
      setState(() {
        for (var messageId in event.messageIds) {
          final index = _messages.indexWhere((msg) => msg.id == messageId);
          if (index != -1) {
            _messages[index] = _messages[index].copyWithReadCount(
              _messages[index].readCount + event.incrementBy,
            );
          }
        }
      });
    });

    // 3. 監聽標記已讀成功
    _socketService.on('markAsReadSuccess', (data) {
      final response = MarkAsReadResponse.fromJson(data as Map<String, dynamic>);
      if (response.success) {
        setState(() {
          _unreadCount = response.unreadCount;
        });
        print('✅ 已標記 ${response.newlyReadCount} 則訊息為已讀');
      }
    });

    // 4. 監聽新訊息
    _socketService.on('newMessage', (data) {
      // 處理新訊息邏輯
      setState(() {
        // 加入新訊息到列表
        _unreadCount++;
      });
    });
  }

  void _onScroll() {
    // 滾動到底部時標記為已讀
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 100) {
      if (_messages.isNotEmpty) {
        final lastMessage = _messages.last;
        _markAsRead(lastMessage.id);
      }
    }
  }

  void _markAsRead(String lastMessageId) {
    _socketService.markAsRead(
      conversationId: widget.conversationId,
      lastReadMessageId: lastMessageId,
    );
  }

  bool _isMessageReadByMe(String messageId) {
    if (_lastReadMessageId == null) return false;
    // MongoDB ObjectId 可以直接字串比較
    return messageId.compareTo(_lastReadMessageId!) <= 0;
  }

  void _showReadReceipts(String messageId) {
    _socketService.getReadReceipts(messageId: messageId);

    _socketService.on('readReceipts', (data) {
      final response = ReadReceiptsResponse.fromJson(data as Map<String, dynamic>);

      // 顯示已讀列表 Bottom Sheet
      showModalBottomSheet(
        context: context,
        builder: (context) => _buildReadReceiptsSheet(response),
      );

      // 用完後移除監聽器
      _socketService.off('readReceipts');
    });
  }

  Widget _buildReadReceiptsSheet(ReadReceiptsResponse response) {
    return Container(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '已讀 ${response.totalCount}',
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 16),
          Expanded(
            child: ListView.builder(
              itemCount: response.receipts.length,
              itemBuilder: (context, index) {
                final receipt = response.receipts[index];
                return ListTile(
                  leading: CircleAvatar(
                    backgroundImage: receipt.profilePicture != null
                        ? NetworkImage(receipt.profilePicture!)
                        : null,
                    child: receipt.profilePicture == null
                        ? Text(receipt.username[0].toUpperCase())
                        : null,
                  ),
                  title: Text(receipt.username),
                  subtitle: Text(
                    _formatDateTime(receipt.readAt),
                    style: const TextStyle(fontSize: 12),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  String _formatDateTime(DateTime dt) {
    return '${dt.year}/${dt.month}/${dt.day} ${dt.hour}:${dt.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('對話'),
        actions: [
          if (_unreadCount > 0)
            Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.red,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '$_unreadCount',
                    style: const TextStyle(color: Colors.white, fontSize: 12),
                  ),
                ),
              ),
            ),
        ],
      ),
      body: ListView.builder(
        controller: _scrollController,
        itemCount: _messages.length,
        itemBuilder: (context, index) {
          final message = _messages[index];
          final isMine = message.senderId == widget.currentUserId;
          final isRead = _isMessageReadByMe(message.id);

          return Align(
            alignment: isMine ? Alignment.centerRight : Alignment.centerLeft,
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: isMine ? Colors.blue[100] : Colors.grey[200],
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(message.content),
                  const SizedBox(height: 4),

                  // 已讀狀態（只顯示在自己發送的訊息）
                  if (isMine)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // 已讀計數
                        if (message.readCount > 0)
                          GestureDetector(
                            onTap: () => _showReadReceipts(message.id),
                            child: Text(
                              '已讀 ${message.readCount}',
                              style: const TextStyle(
                                fontSize: 12,
                                color: Colors.blue,
                                decoration: TextDecoration.underline,
                              ),
                            ),
                          )
                        else
                          const Text(
                            '✓ 已傳送',
                            style: TextStyle(fontSize: 12, color: Colors.grey),
                          ),
                      ],
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _socketService.off('conversationState');
    _socketService.off('readCountUpdated');
    _socketService.off('markAsReadSuccess');
    _socketService.off('newMessage');
    _socketService.disconnect();
    super.dispose();
  }
}
```

---

### 對話列表顯示未讀數 Badge

```dart
// lib/widgets/conversation_list_item.dart
class ConversationListItem extends StatelessWidget {
  final String conversationId;
  final String name;
  final String lastMessage;
  final String? avatar;
  final int unreadCount;

  const ConversationListItem({
    Key? key,
    required this.conversationId,
    required this.name,
    required this.lastMessage,
    this.avatar,
    required this.unreadCount,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: CircleAvatar(
        backgroundImage: avatar != null ? NetworkImage(avatar!) : null,
        child: avatar == null ? Text(name[0].toUpperCase()) : null,
      ),
      title: Text(name),
      subtitle: Text(
        lastMessage,
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      trailing: unreadCount > 0
          ? Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.red,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                '$unreadCount',
                style: const TextStyle(color: Colors.white, fontSize: 12),
              ),
            )
          : null,
      onTap: () {
        Navigator.push(
          context,
          MaterialPageRoute(
            builder: (context) => ChatRoomScreen(
              conversationId: conversationId,
              currentUserId: 'YOUR_USER_ID',
              jwtToken: 'YOUR_JWT_TOKEN',
            ),
          ),
        );
      },
    );
  }
}
```

---

### 使用 Provider 進行狀態管理（進階）

```dart
// lib/providers/chat_provider.dart
import 'package:flutter/foundation.dart';
import '../services/socket_service.dart';
import '../models/read_receipt.dart';

class ChatProvider with ChangeNotifier {
  final SocketService _socketService = SocketService();

  Map<String, int> _unreadCounts = {};  // conversationId -> unreadCount
  Map<String, List<Message>> _messages = {};

  int getUnreadCount(String conversationId) {
    return _unreadCounts[conversationId] ?? 0;
  }

  void initialize(String jwtToken) {
    _socketService.connect(jwtToken);
    _setupListeners();
  }

  void _setupListeners() {
    _socketService.on('conversationState', (data) {
      final state = ConversationState.fromJson(data as Map<String, dynamic>);
      final conversationId = data['conversationId'] as String;
      _unreadCounts[conversationId] = state.unreadCount;
      notifyListeners();
    });

    _socketService.on('readCountUpdated', (data) {
      final event = ReadCountUpdatedEvent.fromJson(data as Map<String, dynamic>);
      final messages = _messages[event.conversationId];
      if (messages != null) {
        for (var messageId in event.messageIds) {
          final index = messages.indexWhere((msg) => msg.id == messageId);
          if (index != -1) {
            messages[index] = messages[index].copyWithReadCount(
              messages[index].readCount + event.incrementBy,
            );
          }
        }
        notifyListeners();
      }
    });
  }

  void markAsRead(String conversationId, String lastMessageId) {
    _socketService.markAsRead(
      conversationId: conversationId,
      lastReadMessageId: lastMessageId,
    );
  }

  void dispose() {
    _socketService.disconnect();
  }
}

// 使用方式
// main.dart
void main() {
  runApp(
    ChangeNotifierProvider(
      create: (_) => ChatProvider()..initialize('YOUR_JWT_TOKEN'),
      child: const MyApp(),
    ),
  );
}

// 在 Widget 中使用
class ConversationListScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Consumer<ChatProvider>(
      builder: (context, chatProvider, child) {
        final unreadCount = chatProvider.getUnreadCount('conversationId');
        return Text('未讀: $unreadCount');
      },
    );
  }
}
```

---

### 性能優化建議

#### 1. 使用 Debounce 避免頻繁標記已讀

```dart
import 'dart:async';

class DebouncedMarkAsRead {
  Timer? _debounce;

  void markAsRead(String conversationId, String messageId, SocketService socket) {
    if (_debounce?.isActive ?? false) _debounce!.cancel();

    _debounce = Timer(const Duration(milliseconds: 1000), () {
      socket.markAsRead(
        conversationId: conversationId,
        lastReadMessageId: messageId,
      );
    });
  }

  void dispose() {
    _debounce?.cancel();
  }
}

// 使用
final _debouncedMarkAsRead = DebouncedMarkAsRead();

void _onScroll() {
  if (_messages.isNotEmpty) {
    _debouncedMarkAsRead.markAsRead(
      widget.conversationId,
      _messages.last.id,
      _socketService,
    );
  }
}
```

#### 2. 離開頁面時自動標記已讀

```dart
@override
void deactivate() {
  // 離開頁面時標記為已讀
  if (_messages.isNotEmpty) {
    _socketService.markAsRead(
      conversationId: widget.conversationId,
      lastReadMessageId: _messages.last.id,
    );
  }
  super.deactivate();
}
```

---

### 錯誤處理

```dart
void _initializeSocket() {
  _socketService.connect(widget.jwtToken);

  // 連線錯誤
  _socketService.on('connect_error', (error) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('連線失敗: $error')),
    );
  });

  // 伺服器錯誤
  _socketService.on('error', (data) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('錯誤: ${data['message']}')),
    );
  });

  // 重連失敗
  _socketService.on('reconnect_failed', (_) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('無法重新連線，請檢查網路')),
    );
  });
}
```

---

### 完整的型別安全 Extension (可選)

```dart
// lib/extensions/socket_extensions.dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

extension SocketExtensions on IO.Socket {
  void emitMarkAsRead({
    required String conversationId,
    required String lastReadMessageId,
  }) {
    emit('markAsRead', {
      'conversationId': conversationId,
      'lastReadMessageId': lastReadMessageId,
    });
  }

  void emitGetReadReceipts({
    required String messageId,
    int limit = 20,
    int offset = 0,
  }) {
    emit('getReadReceipts', {
      'messageId': messageId,
      'limit': limit,
      'offset': offset,
    });
  }

  void emitGetConversationState(String conversationId) {
    emit('getConversationState', {
      'conversationId': conversationId,
    });
  }
}
```

---

### Flutter 特別注意事項

1. **必須設定 `setTransports(['websocket'])`**
   ```dart
   // ❌ 錯誤：會導致連線失敗
   IO.io('http://localhost:3001');

   // ✅ 正確
   IO.io('http://localhost:3001',
     IO.OptionBuilder()
         .setTransports(['websocket'])  // 必須加這行！
         .build());
   ```

2. **生命週期管理**
   - 務必在 `dispose()` 中斷開連線和移除監聽器
   - 避免記憶體洩漏

3. **背景執行**
   - iOS/Android 背景限制可能導致 WebSocket 斷線
   - 建議使用 `flutter_background_service` 保持連線

4. **網路權限**
   - Android: 在 `AndroidManifest.xml` 加入 `INTERNET` 權限
   - iOS: 在 `Info.plist` 設定 `NSAppTransportSecurity`

---

## 測試建議

### 測試情境

1. **單人對話測試**
   - A 發送訊息給 B
   - B 進入對話，訊息自動標記為已讀
   - A 看到 "已讀 1"

2. **群組對話測試**
   - A 發送訊息到群組（3 人）
   - B 和 C 分別進入對話
   - A 看到 "已讀 2"
   - 點擊查看已讀列表

3. **離線/重連測試**
   - 斷開 WebSocket 連線
   - 重新連線後檢查未讀數是否正確

4. **性能測試**
   - 加載 1000+ 則訊息
   - 快速滾動檢查標記已讀的性能

---

## 需要幫助？

如有任何問題，請參考：
- WebSocket Server 原始碼: `services/websocket-server/src/websocket/websocket.gateway.ts`
- Chat Service 原始碼: `services/chat-service/src/services/read-receipt.service.ts`
- Protocol Buffers 定義: `services/protos/chat.proto`
