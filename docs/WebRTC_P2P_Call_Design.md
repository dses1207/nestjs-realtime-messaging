# WebRTC 端對端通話系統設計文件

## 概述

本文件詳細描述了基於現有 gRPC 微服務架構的 WebRTC 端對端音視頻通話系統設計。該系統利用現有的 WebSocket 服務器作為信令服務器，結合推播通知服務來實現高效能、低延遲的 P2P 通話功能。

## 目錄

- [系統架構](#系統架構)
- [技術棧](#技術棧)
- [核心組件](#核心組件)
- [信令流程](#信令流程)
- [WebSocket 事件協議](#websocket-事件協議)
- [gRPC 服務擴展](#grpc-服務擴展)
- [實現指南](#實現指南)
- [部署配置](#部署配置)
- [安全考量](#安全考量)
- [性能優化](#性能優化)
- [故障排除](#故障排除)
- [通話錄音功能擴展](#通話錄音功能擴展)
  - [概述](#概述-1)
  - [錄音方案比較](#錄音方案比較)
  - [方案二：服務器端錄音](#方案二服務器端錄音-推薦)
  - [技術棧](#技術棧-1)
  - [核心組件設計](#核心組件設計)
  - [API 端點設計](#api-端點設計)
  - [部署配置](#部署配置-1)
  - [安全與合規](#安全與合規)

## 系統架構

### 整體架構圖

```ascii
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              前端應用層 (Flutter)                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐            │
│  │  WebRTC Client  │    │  Socket.IO      │    │  HTTP Client    │            │
│  │  (P2P 音視頻)    │    │  (信令通道)      │    │  (API 調用)      │            │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              網路層                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│       HTTP/HTTPS (Port 3000)         │         WebSocket (Port 3001)           │
│            REST API                   │           信令通道                        │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            微服務層 (Nest.js)                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐            │
│  │   API Gateway   │    │ WebSocket Server│    │ STUN/TURN Server│            │
│  │   (Port 3000)   │    │   (Port 3001)   │    │ (External/Self) │            │
│  │  HTTP ↔ gRPC   │    │  信令轉發中心     │    │  NAT 穿透支援    │            │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘            │
│                                  │                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      gRPC 內部通信層                                     │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │   │
│  │  │ User Service│ │Chat Service │ │Notification │ │Call Service │      │   │
│  │  │ (Port 50052)│ │(Port 50053) │ │ (Port 50056)│ │(Port 50058) │      │   │
│  │  │ 用戶管理     │ │聊天訊息     │ │推播通知     │ │通話管理     │      │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              資料層                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                            MongoDB 資料庫                                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │   Users     │ │ Conversations│ │   Messages  │ │ Call Records│              │
│  │   用戶資料   │ │   對話記錄   │ │   訊息記錄   │ │   通話記錄   │              │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘              │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                          P2P 連線層 (直接連線)                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│   使用者 A ←═══════════════ WebRTC P2P Stream ═══════════════→ 使用者 B        │
│  (音視頻直傳)                                                 (音視頻直傳)        │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 架構特點

1. **分層設計**: 前端、網路、微服務、資料四層清晰分離
2. **信令與媒體分離**: WebSocket 處理信令，WebRTC 處理音視頻
3. **高效能 P2P**: 音視頻流直接在用戶間傳輸，不經過服務器
4. **故障恢復**: TURN 服務器提供中繼備案
5. **推播喚醒**: 離線用戶通過 FCM/APNs 喚醒

## 技術棧

### 前端 (Flutter)
- **flutter_webrtc**: WebRTC 核心功能
- **socket_io_client**: 信令通道
- **dio**: HTTP API 調用
- **flutter_local_notifications**: 本地通知處理

### 後端 (Nest.js)
- **@nestjs/websockets**: WebSocket 信令服務器
- **@nestjs/microservices**: gRPC 服務通信
- **socket.io**: 實時雙向通信
- **@grpc/grpc-js**: gRPC 協議支援

### 基礎設施
- **Coturn**: 開源 STUN/TURN 服務器
- **MongoDB**: 通話記錄存儲
- **Redis**: 會話狀態管理 (可選)
- **FCM/APNs**: 推播通知服務

## 核心組件

### 1. WebSocket 信令服務器

**職責**:
- 轉發 SDP Offer/Answer
- 交換 ICE Candidates  
- 管理通話狀態
- 處理通話事件

**擴展功能**:
```typescript
// 新增通話相關事件處理
@SubscribeMessage('call-request')
@SubscribeMessage('call-accepted')
@SubscribeMessage('call-rejected')
@SubscribeMessage('call-ended')
@SubscribeMessage('offer-sdp')
@SubscribeMessage('answer-sdp')
@SubscribeMessage('ice-candidate')
@SubscribeMessage('call-timeout')
```

### 2. 通話服務 (新增)

**Port**: 50058  
**職責**:
- 通話狀態管理
- 通話記錄存儲
- 通話品質統計
- 用戶線上狀態查詢

### 3. 推播通知整合

**現有服務擴展**:
- 新增通話邀請通知類型
- 支援高優先級通知
- 處理通話相關的深層連結

### 4. STUN/TURN 服務器

**配置選項**:
- **開發環境**: 免費公共 STUN (Google, Mozilla)
- **生產環境**: 自架 Coturn 或雲端服務 (Twilio, AWS)

## 信令流程

### 完整通話流程圖

```ascii
使用者 A (發起方)                信令服務器               使用者 B (接收方)               推播服務
─────────────────                ──────────              ─────────────────               ────────
       │                              │                         │                         │
       │ 1. call-request              │                         │                         │
       ├─────────────────────────────►│                         │                         │
       │    {to: 'user_b_id',         │                         │                         │
       │     type: 'video/audio'}     │                         │                         │
       │                              │                         │                         │
       │                              │ 2. 檢查 B 線上狀態      │                         │
       │                              ├────────────────────────►│                         │
       │                              │                         │                         │
       │                              │ 3a. 如果 B 在線         │                         │
       │                              │ incoming-call           │                         │
       │                              ├────────────────────────►│                         │
       │                              │                         │                         │
       │                              │ 3b. 如果 B 離線         │                         │
       │                              │ 發送推播通知             │                         │
       │                              ├─────────────────────────────────────────────────►│
       │                              │                         │                         │
       │                              │                         │                         │ 4. FCM/APNs
       │                              │                         │ ◄───────────────────────┤ 推播
       │                              │                         │                         │
       │                              │                         │ 5. 用戶打開 App          │
       │                              │                         │                         │
       │                              │                         │ 6. call-accepted        │
       │                              │ ◄───────────────────────┤                         │
       │ 7. call-accepted             │                         │                         │
       │ ◄────────────────────────────┤                         │                         │
       │                              │                         │                         │
       │ 8. offer-sdp                 │                         │                         │
       ├─────────────────────────────►│                         │                         │
       │    {sdp: 'v=0...'}           │ 9. offer-sdp            │                         │
       │                              ├────────────────────────►│                         │
       │                              │                         │                         │
       │                              │                         │ 10. answer-sdp          │
       │                              │ ◄───────────────────────┤                         │
       │ 11. answer-sdp               │                         │                         │
       │ ◄────────────────────────────┤                         │                         │
       │                              │                         │                         │
       │ 12. ice-candidate            │                         │                         │
       ├─────────────────────────────►│ 13. ice-candidate       │                         │
       │                              ├────────────────────────►│                         │
       │                              │                         │                         │
       │                              │ 14. ice-candidate       │                         │
       │ 15. ice-candidate            │ ◄───────────────────────┤                         │
       │ ◄────────────────────────────┤                         │                         │
       │                              │                         │                         │
       │ ═══════════════════════════════════════════════════════► │                         │
       │           16. WebRTC P2P 音視頻流建立                    │                         │
       │ ◄═══════════════════════════════════════════════════════ │                         │
       │                              │                         │                         │
       │                              │                         │                         │
       │ 17. call-ended               │                         │                         │
       ├─────────────────────────────►│ 18. call-ended          │                         │
       │                              ├────────────────────────►│                         │
       │                              │                         │                         │
```

### 詳細流程說明

#### 階段一: 通話發起 (Steps 1-7)

1. **發起通話**: 用戶 A 選擇聯絡人 B 並點擊語音/視頻通話按鈕
2. **信令轉發**: WebSocket 服務器接收 `call-request` 事件
3. **狀態檢查**: 服務器查詢用戶 B 的線上狀態
4. **通知處理**: 
   - **線上**: 直接通過 WebSocket 發送 `incoming-call`
   - **離線**: 通過 gRPC 調用推播服務發送高優先級通知
5. **用戶響應**: 用戶 B 接收到邀請並選擇接受/拒絕
6. **狀態同步**: 服務器將 B 的響應轉發給 A

#### 階段二: 媒體協商 (Steps 8-11)

7. **SDP Offer**: A 建立 WebRTC 連線並生成包含媒體能力的 SDP
8. **Offer 轉發**: 服務器將 SDP Offer 轉發給 B
9. **SDP Answer**: B 處理 Offer 並生成相應的 SDP Answer
10. **Answer 轉發**: 服務器將 SDP Answer 轉發給 A

#### 階段三: 連線建立 (Steps 12-16)

11. **ICE 收集**: 雙方開始收集本地網路地址 (ICE Candidates)
12. **Candidate 交換**: 通過信令服務器持續交換 ICE Candidates
13. **P2P 嘗試**: WebRTC 嘗試建立直接的 P2P 連線
14. **TURN 降級**: 如果 P2P 失敗，自動切換到 TURN 中繼模式
15. **媒體流傳輸**: 成功建立連線，開始雙向音視頻傳輸

#### 階段四: 通話結束 (Steps 17-18)

16. **主動結束**: 任一方點擊掛斷按鈕
17. **狀態通知**: 通過信令服務器通知對方通話結束
18. **資源清理**: 雙方釋放 WebRTC 連線和本地媒體資源

## WebSocket 事件協議

### 通話控制事件

#### call-request (發起通話)
```typescript
interface CallRequestPayload {
  to: string;           // 目標用戶 ID
  type: 'audio' | 'video';  // 通話類型
  callId: string;       // 唯一通話 ID
  from: string;         // 發起者用戶 ID
  timestamp: number;    // 發起時間戳
}

// 發送
socket.emit('call-request', payload);

// 響應 (給發起方)
interface CallRequestResponse {
  success: boolean;
  message: string;
  callId: string;
  targetOnline: boolean;  // 目標用戶是否在線
}
```

#### incoming-call (來電通知)
```typescript
interface IncomingCallPayload {
  from: string;         // 發起者用戶 ID
  fromName: string;     // 發起者姓名
  fromAvatar?: string;  // 發起者頭像
  type: 'audio' | 'video';
  callId: string;
  timestamp: number;
}

// 接收 (給目標用戶)
socket.on('incoming-call', (payload: IncomingCallPayload) => {
  // 顯示來電界面
  showIncomingCallScreen(payload);
});
```

#### call-accepted (接受通話)
```typescript
interface CallAcceptedPayload {
  callId: string;
  to: string;           // 發起者用戶 ID
  accepted: boolean;    // true = 接受, false = 拒絕
  timestamp: number;
}

socket.emit('call-accepted', payload);
```

#### call-rejected (拒絕通話)
```typescript
interface CallRejectedPayload {
  callId: string;
  to: string;
  reason?: 'busy' | 'declined' | 'timeout';
  timestamp: number;
}

socket.emit('call-rejected', payload);
```

### 信令協商事件

#### offer-sdp (SDP Offer)
```typescript
interface OfferSdpPayload {
  callId: string;
  to: string;
  sdp: string;          // WebRTC SDP 數據
  type: 'offer';
  timestamp: number;
}

socket.emit('offer-sdp', payload);
```

#### answer-sdp (SDP Answer)
```typescript
interface AnswerSdpPayload {
  callId: string;
  to: string;
  sdp: string;
  type: 'answer';
  timestamp: number;
}

socket.emit('answer-sdp', payload);
```

#### ice-candidate (ICE 候選)
```typescript
interface IceCandidatePayload {
  callId: string;
  to: string;
  candidate: string;    // ICE candidate 數據
  sdpMid?: string;      // Media stream ID
  sdpMLineIndex?: number; // SDP m-line index
  timestamp: number;
}

socket.emit('ice-candidate', payload);
```

### 通話狀態事件

#### call-ended (通話結束)
```typescript
interface CallEndedPayload {
  callId: string;
  to: string;
  reason: 'normal' | 'timeout' | 'error' | 'network';
  duration?: number;    // 通話時長 (秒)
  timestamp: number;
}

socket.emit('call-ended', payload);
```

#### call-timeout (通話超時)
```typescript
interface CallTimeoutPayload {
  callId: string;
  reason: 'no_answer' | 'connection_failed';
  timestamp: number;
}

// 服務器主動發送
socket.on('call-timeout', (payload) => {
  // 處理超時邏輯
});
```

### 錯誤處理事件

#### call-error (通話錯誤)
```typescript
interface CallErrorPayload {
  callId: string;
  error: string;
  code: number;
  timestamp: number;
}

socket.on('call-error', (payload) => {
  console.error('Call error:', payload);
  // 顯示錯誤訊息並清理狀態
});
```

## gRPC 服務擴展

### 1. 新增 Call Service

#### Proto 定義 (call.proto)
```protobuf
syntax = "proto3";

package call;

service CallService {
  rpc CreateCall (CreateCallRequest) returns (CreateCallResponse);
  rpc UpdateCallStatus (UpdateCallStatusRequest) returns (UpdateCallStatusResponse);
  rpc GetCallHistory (GetCallHistoryRequest) returns (GetCallHistoryResponse);
  rpc GetActiveCall (GetActiveCallRequest) returns (GetActiveCallResponse);
}

message CreateCallRequest {
  string caller_id = 1;
  string callee_id = 2;
  string call_type = 3;  // "audio" | "video"
  int64 timestamp = 4;
}

message CreateCallResponse {
  bool success = 1;
  string message = 2;
  string call_id = 3;
}

message UpdateCallStatusRequest {
  string call_id = 1;
  string status = 2;  // "ringing" | "accepted" | "ended" | "failed"
  optional int64 duration = 3;
  optional string end_reason = 4;
}

message UpdateCallStatusResponse {
  bool success = 1;
  string message = 2;
}

message CallRecord {
  string call_id = 1;
  string caller_id = 2;
  string callee_id = 3;
  string call_type = 4;
  string status = 5;
  int64 start_time = 6;
  optional int64 end_time = 7;
  optional int64 duration = 8;
  optional string end_reason = 9;
}

message GetCallHistoryRequest {
  string user_id = 1;
  int32 page = 2;
  int32 limit = 3;
}

message GetCallHistoryResponse {
  repeated CallRecord calls = 1;
  int32 total = 2;
}

message GetActiveCallRequest {
  string user_id = 1;
}

message GetActiveCallResponse {
  optional CallRecord active_call = 1;
  bool has_active_call = 2;
}
```

### 2. 擴展 Notification Service

#### 新增通話通知類型
```protobuf
// 在現有 notification.proto 中新增
message SendCallNotificationRequest {
  string caller_id = 1;
  string callee_id = 2;
  string caller_name = 3;
  string call_type = 4;  // "audio" | "video"
  string call_id = 5;
}

message SendCallNotificationResponse {
  bool success = 1;
  string message = 2;
  repeated string failed_tokens = 3;  // 失敗的設備 token
}

// 擴展主服務
service NotificationService {
  // ... 現有方法
  rpc SendCallNotification (SendCallNotificationRequest) returns (SendCallNotificationResponse);
}
```

#### 高優先級推播配置
```typescript
// FCM 配置
const callNotificationPayload = {
  notification: {
    title: `來自 ${callerName} 的${callType === 'video' ? '視頻' : '語音'}通話`,
    body: '點擊接聽',
    sound: 'call_ringtone.wav',
  },
  data: {
    type: 'incoming_call',
    call_id: callId,
    caller_id: callerId,
    call_type: callType,
  },
  android: {
    priority: 'high',
    ttl: 30000, // 30秒過期
    notification: {
      channel_id: 'calls',
      priority: 'max',
      visibility: 'public',
      category: 'call',
    },
  },
  apns: {
    headers: {
      'apns-priority': '10',
      'apns-expiration': Math.floor(Date.now() / 1000) + 30,
    },
    payload: {
      aps: {
        alert: {
          title: `來自 ${callerName} 的${callType === 'video' ? '視頻' : '語音'}通話`,
          body: '點擊接聽',
        },
        sound: 'call_ringtone.caf',
        category: 'CALL_INVITE',
        'content-available': 1,
      },
    },
  },
};
```

## 實現指南

### 1. WebSocket Server 擴展

#### 新增通話事件處理器
```typescript
// websocket.gateway.ts 中新增

@SubscribeMessage('call-request')
async handleCallRequest(
  @MessageBody() data: CallRequestPayload,
  @ConnectedSocket() client: Socket,
) {
  const callerId = client.data.userId;
  const { to: calleeId, type: callType, callId } = data;

  try {
    // 1. 創建通話記錄
    const callResponse = await this.callClientService.createCall({
      callerId,
      calleeId,
      callType,
      timestamp: Date.now(),
    });

    if (!callResponse.success) {
      client.emit('call-error', {
        callId,
        error: callResponse.message,
        code: 400,
      });
      return;
    }

    // 2. 檢查目標用戶線上狀態
    const calleeConnections = this.getUserConnections(calleeId);
    
    if (calleeConnections.length > 0) {
      // 目標用戶在線，直接發送 WebSocket 事件
      const incomingCallPayload: IncomingCallPayload = {
        from: callerId,
        fromName: client.data.username,
        fromAvatar: client.data.profilePicture,
        type: callType,
        callId: callResponse.callId,
        timestamp: Date.now(),
      };

      calleeConnections.forEach(connection => {
        connection.socket.emit('incoming-call', incomingCallPayload);
      });

      client.emit('call-request-response', {
        success: true,
        message: '通話邀請已發送',
        callId: callResponse.callId,
        targetOnline: true,
      });
    } else {
      // 目標用戶離線，發送推播通知
      await this.notificationClientService.sendCallNotification({
        callerId,
        calleeId,
        callerName: client.data.username,
        callType,
        callId: callResponse.callId,
      });

      client.emit('call-request-response', {
        success: true,
        message: '通話邀請已通過推播發送',
        callId: callResponse.callId,
        targetOnline: false,
      });
    }

    // 3. 設定通話超時
    this.setCallTimeout(callResponse.callId, callerId, calleeId);

  } catch (error) {
    this.logger.error('處理通話請求失敗:', error);
    client.emit('call-error', {
      callId,
      error: '系統錯誤',
      code: 500,
    });
  }
}

@SubscribeMessage('call-accepted')
async handleCallAccepted(
  @MessageBody() data: CallAcceptedPayload,
  @ConnectedSocket() client: Socket,
) {
  const { callId, to: callerId, accepted } = data;
  const calleeId = client.data.userId;

  try {
    // 更新通話狀態
    await this.callClientService.updateCallStatus({
      callId,
      status: accepted ? 'accepted' : 'rejected',
    });

    // 轉發給發起方
    const callerConnections = this.getUserConnections(callerId);
    const event = accepted ? 'call-accepted' : 'call-rejected';
    
    callerConnections.forEach(connection => {
      connection.socket.emit(event, {
        callId,
        from: calleeId,
        timestamp: Date.now(),
      });
    });

    // 清除超時定時器
    this.clearCallTimeout(callId);

  } catch (error) {
    this.logger.error('處理通話接受失敗:', error);
  }
}

@SubscribeMessage('offer-sdp')
async handleOfferSdp(
  @MessageBody() data: OfferSdpPayload,
  @ConnectedSocket() client: Socket,
) {
  const { callId, to: calleeId, sdp } = data;
  
  // 轉發 SDP Offer
  const calleeConnections = this.getUserConnections(calleeId);
  calleeConnections.forEach(connection => {
    connection.socket.emit('offer-sdp', {
      callId,
      from: client.data.userId,
      sdp,
      type: 'offer',
      timestamp: Date.now(),
    });
  });
}

@SubscribeMessage('answer-sdp')
async handleAnswerSdp(
  @MessageBody() data: AnswerSdpPayload,
  @ConnectedSocket() client: Socket,
) {
  const { callId, to: callerId, sdp } = data;
  
  // 轉發 SDP Answer  
  const callerConnections = this.getUserConnections(callerId);
  callerConnections.forEach(connection => {
    connection.socket.emit('answer-sdp', {
      callId,
      from: client.data.userId,
      sdp,
      type: 'answer',
      timestamp: Date.now(),
    });
  });
}

@SubscribeMessage('ice-candidate')
async handleIceCandidate(
  @MessageBody() data: IceCandidatePayload,
  @ConnectedSocket() client: Socket,
) {
  const { callId, to: targetUserId, candidate, sdpMid, sdpMLineIndex } = data;
  
  // 轉發 ICE Candidate
  const targetConnections = this.getUserConnections(targetUserId);
  targetConnections.forEach(connection => {
    connection.socket.emit('ice-candidate', {
      callId,
      from: client.data.userId,
      candidate,
      sdpMid,
      sdpMLineIndex,
      timestamp: Date.now(),
    });
  });
}

@SubscribeMessage('call-ended')
async handleCallEnded(
  @MessageBody() data: CallEndedPayload,
  @ConnectedSocket() client: Socket,
) {
  const { callId, to: targetUserId, reason, duration } = data;
  
  try {
    // 更新通話狀態
    await this.callClientService.updateCallStatus({
      callId,
      status: 'ended',
      duration,
      endReason: reason,
    });

    // 通知另一方
    const targetConnections = this.getUserConnections(targetUserId);
    targetConnections.forEach(connection => {
      connection.socket.emit('call-ended', {
        callId,
        from: client.data.userId,
        reason,
        duration,
        timestamp: Date.now(),
      });
    });

    // 清理相關資源
    this.clearCallTimeout(callId);
    
  } catch (error) {
    this.logger.error('處理通話結束失敗:', error);
  }
}

// 通話超時處理
private callTimeouts = new Map<string, NodeJS.Timeout>();

private setCallTimeout(callId: string, callerId: string, calleeId: string) {
  const timeout = setTimeout(async () => {
    try {
      // 更新通話狀態為超時
      await this.callClientService.updateCallStatus({
        callId,
        status: 'failed',
        endReason: 'timeout',
      });

      // 通知雙方通話超時
      [callerId, calleeId].forEach(userId => {
        const connections = this.getUserConnections(userId);
        connections.forEach(connection => {
          connection.socket.emit('call-timeout', {
            callId,
            reason: 'no_answer',
            timestamp: Date.now(),
          });
        });
      });

    } catch (error) {
      this.logger.error('處理通話超時失敗:', error);
    } finally {
      this.callTimeouts.delete(callId);
    }
  }, 60000); // 60秒超時

  this.callTimeouts.set(callId, timeout);
}

private clearCallTimeout(callId: string) {
  const timeout = this.callTimeouts.get(callId);
  if (timeout) {
    clearTimeout(timeout);
    this.callTimeouts.delete(callId);
  }
}
```

### 2. Flutter WebRTC 實現

#### WebRTC 管理器
```dart
// webrtc_manager.dart
import 'package:flutter_webrtc/flutter_webrtc.dart';

class WebRTCManager {
  RTCPeerConnection? _peerConnection;
  MediaStream? _localStream;
  MediaStream? _remoteStream;
  
  // ICE 服務器配置
  final Map<String, dynamic> _iceServers = {
    'iceServers': [
      {'urls': 'stun:stun.l.google.com:19302'},
      // 生產環境應該使用自己的 TURN 服務器
      // {
      //   'urls': 'turn:your-turn-server.com:3478',
      //   'username': 'your-username',
      //   'credential': 'your-password',
      // },
    ]
  };

  // PeerConnection 配置
  final Map<String, dynamic> _config = {
    'mandatory': {},
    'optional': [
      {'DtlsSrtpKeyAgreement': true},
    ]
  };

  Future<void> initialize() async {
    // 創建 PeerConnection
    _peerConnection = await createPeerConnection(_iceServers, _config);
    
    // 設置回調
    _peerConnection!.onIceCandidate = (RTCIceCandidate candidate) {
      // 發送 ICE candidate 到信令服務器
      _sendIceCandidate(candidate);
    };

    _peerConnection!.onTrack = (RTCTrackEvent event) {
      if (event.track.kind == 'video') {
        _remoteStream = event.streams[0];
        // 更新 UI 顯示遠端視頻
        _onRemoteStreamChanged?.call(_remoteStream);
      }
    };

    _peerConnection!.onConnectionState = (RTCPeerConnectionState state) {
      print('Connection state: $state');
      _onConnectionStateChanged?.call(state);
    };
  }

  Future<void> startCall(bool isVideo) async {
    // 獲取本地媒體流
    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': isVideo,
    });

    // 添加到 PeerConnection
    _localStream!.getTracks().forEach((track) {
      _peerConnection!.addTrack(track, _localStream!);
    });

    // 創建 Offer
    RTCSessionDescription offer = await _peerConnection!.createOffer();
    await _peerConnection!.setLocalDescription(offer);

    // 發送 Offer 到信令服務器
    _sendOffer(offer);
  }

  Future<void> handleOffer(String sdp) async {
    RTCSessionDescription offer = RTCSessionDescription(sdp, 'offer');
    await _peerConnection!.setRemoteDescription(offer);

    // 獲取本地媒體流 (被叫方)
    _localStream = await navigator.mediaDevices.getUserMedia({
      'audio': true,
      'video': true, // 根據通話類型決定
    });

    _localStream!.getTracks().forEach((track) {
      _peerConnection!.addTrack(track, _localStream!);
    });

    // 創建 Answer
    RTCSessionDescription answer = await _peerConnection!.createAnswer();
    await _peerConnection!.setLocalDescription(answer);

    // 發送 Answer
    _sendAnswer(answer);
  }

  Future<void> handleAnswer(String sdp) async {
    RTCSessionDescription answer = RTCSessionDescription(sdp, 'answer');
    await _peerConnection!.setRemoteDescription(answer);
  }

  Future<void> handleIceCandidate(Map<String, dynamic> candidateData) async {
    RTCIceCandidate candidate = RTCIceCandidate(
      candidateData['candidate'],
      candidateData['sdpMid'],
      candidateData['sdpMLineIndex'],
    );
    await _peerConnection!.addCandidate(candidate);
  }

  void endCall() {
    _localStream?.dispose();
    _remoteStream?.dispose();
    _peerConnection?.close();
    _peerConnection = null;
  }

  // 回調函數
  Function(MediaStream?)? _onRemoteStreamChanged;
  Function(RTCPeerConnectionState)? _onConnectionStateChanged;
  
  void setOnRemoteStreamChanged(Function(MediaStream?) callback) {
    _onRemoteStreamChanged = callback;
  }
  
  void setOnConnectionStateChanged(Function(RTCPeerConnectionState) callback) {
    _onConnectionStateChanged = callback;
  }

  // 發送信令消息 (這些方法需要與 Socket.IO 整合)
  void _sendOffer(RTCSessionDescription offer) {
    // 通過 WebSocket 發送
  }

  void _sendAnswer(RTCSessionDescription answer) {
    // 通過 WebSocket 發送
  }

  void _sendIceCandidate(RTCIceCandidate candidate) {
    // 通過 WebSocket 發送
  }

  // Getters
  MediaStream? get localStream => _localStream;
  MediaStream? get remoteStream => _remoteStream;
}
```

#### 通話服務整合
```dart
// call_service.dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

class CallService {
  late IO.Socket _socket;
  late WebRTCManager _webrtcManager;
  
  String? _currentCallId;
  String? _currentCallType;
  
  // 通話狀態回調
  Function(Map<String, dynamic>)? onIncomingCall;
  Function(String)? onCallAccepted;
  Function(String)? onCallRejected;
  Function(String)? onCallEnded;
  Function(String, String)? onCallError;

  CallService() {
    _webrtcManager = WebRTCManager();
    _initializeSocket();
  }

  void _initializeSocket() {
    _socket = IO.io('ws://localhost:3001', <String, dynamic>{
      'transports': ['websocket'],
      'autoConnect': false,
    });

    // 監聽通話相關事件
    _socket.on('incoming-call', (data) {
      onIncomingCall?.call(data);
    });

    _socket.on('call-accepted', (data) {
      _handleCallAccepted(data);
    });

    _socket.on('call-rejected', (data) {
      onCallRejected?.call(data['callId']);
    });

    _socket.on('offer-sdp', (data) {
      _handleOfferSdp(data);
    });

    _socket.on('answer-sdp', (data) {
      _handleAnswerSdp(data);
    });

    _socket.on('ice-candidate', (data) {
      _handleIceCandidate(data);
    });

    _socket.on('call-ended', (data) {
      _handleCallEnded(data);
    });

    _socket.on('call-timeout', (data) {
      onCallError?.call(data['callId'], 'timeout');
    });

    _socket.on('call-error', (data) {
      onCallError?.call(data['callId'], data['error']);
    });
  }

  void connect(String token) {
    _socket.auth = {'token': token};
    _socket.connect();
  }

  void disconnect() {
    _socket.disconnect();
    _webrtcManager.endCall();
  }

  // 發起通話
  Future<void> makeCall(String userId, String callType) async {
    _currentCallId = _generateCallId();
    _currentCallType = callType;
    
    await _webrtcManager.initialize();
    
    _socket.emit('call-request', {
      'to': userId,
      'type': callType,
      'callId': _currentCallId,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  // 接受通話
  Future<void> acceptCall(String callId) async {
    await _webrtcManager.initialize();
    
    _socket.emit('call-accepted', {
      'callId': callId,
      'to': '', // 將由服務器填充
      'accepted': true,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  // 拒絕通話
  void rejectCall(String callId, [String reason = 'declined']) {
    _socket.emit('call-rejected', {
      'callId': callId,
      'to': '', // 將由服務器填充
      'reason': reason,
      'timestamp': DateTime.now().millisecondsSinceEpoch,
    });
  }

  // 結束通話
  void endCall([String reason = 'normal']) {
    if (_currentCallId != null) {
      _socket.emit('call-ended', {
        'callId': _currentCallId,
        'to': '', // 將由服務器填充
        'reason': reason,
        'timestamp': DateTime.now().millisecondsSinceEpoch,
      });
      
      _webrtcManager.endCall();
      _currentCallId = null;
      _currentCallType = null;
    }
  }

  // 處理信令消息
  void _handleCallAccepted(Map<String, dynamic> data) {
    onCallAccepted?.call(data['callId']);
    // 開始 WebRTC 通話流程
    _webrtcManager.startCall(_currentCallType == 'video');
  }

  void _handleOfferSdp(Map<String, dynamic> data) {
    _webrtcManager.handleOffer(data['sdp']);
  }

  void _handleAnswerSdp(Map<String, dynamic> data) {
    _webrtcManager.handleAnswer(data['sdp']);
  }

  void _handleIceCandidate(Map<String, dynamic> data) {
    _webrtcManager.handleIceCandidate({
      'candidate': data['candidate'],
      'sdpMid': data['sdpMid'],
      'sdpMLineIndex': data['sdpMLineIndex'],
    });
  }

  void _handleCallEnded(Map<String, dynamic> data) {
    _webrtcManager.endCall();
    onCallEnded?.call(data['callId']);
    _currentCallId = null;
    _currentCallType = null;
  }

  String _generateCallId() {
    return '${DateTime.now().millisecondsSinceEpoch}_${_socket.id}';
  }

  // Getters
  WebRTCManager get webrtcManager => _webrtcManager;
  String? get currentCallId => _currentCallId;
  bool get isInCall => _currentCallId != null;
}
```

## 部署配置

### 1. STUN/TURN 服務器部署

#### Coturn 配置檔案 (turnserver.conf)
```bash
# /etc/turnserver.conf

# 監聽端口
listening-port=3478
tls-listening-port=5349

# 外部 IP 地址
external-ip=YOUR_SERVER_PUBLIC_IP

# 認證
use-auth-secret
static-auth-secret=YOUR_SECRET_KEY

# 數據庫 (可選)
userdb=/var/lib/turn/turndb

# 日誌
log-file=/var/log/turnserver.log
verbose

# 限制
max-bps=1000000
total-quota=100

# 協議支援
fingerprint
lt-cred-mech
no-multicast-peers
no-cli
no-loopback-peers
no-stun-backward-compatibility
```

#### Docker Compose 整合
```yaml
# 在 docker-compose.yml 中新增
services:
  # ... 現有服務
  
  coturn:
    image: coturn/coturn:4.6.2
    ports:
      - "3478:3478/udp"
      - "3478:3478/tcp"  
      - "5349:5349/udp"
      - "5349:5349/tcp"
      - "49152-49252:49152-49252/udp"
    volumes:
      - ./config/turnserver.conf:/etc/turnserver.conf:ro
      - coturn_logs:/var/log
    environment:
      - EXTERNAL_IP=${COTURN_EXTERNAL_IP}
      - SECRET_KEY=${COTURN_SECRET_KEY}
    restart: unless-stopped
    networks:
      - app-network

volumes:
  coturn_logs:
```

### 2. 環境變數配置

#### .env.dev 新增
```bash
# STUN/TURN 配置
STUN_SERVER_URL=stun:stun.l.google.com:19302
TURN_SERVER_URL=turn:your-server.com:3478
TURN_USERNAME=your-username
TURN_PASSWORD=your-password

# 通話配置
CALL_TIMEOUT_SECONDS=60
MAX_CALL_DURATION_MINUTES=120
ENABLE_CALL_RECORDING=false

# WebRTC 配置
WEBRTC_LOG_LEVEL=info
ICE_GATHERING_TIMEOUT=10000
```

### 3. 防火牆配置

#### 必要端口開放
```bash
# STUN/TURN 服務器
sudo ufw allow 3478/udp
sudo ufw allow 3478/tcp
sudo ufw allow 5349/udp
sudo ufw allow 5349/tcp

# TURN 媒體轉發端口範圍
sudo ufw allow 49152:49252/udp

# WebSocket (如果直接暴露)
sudo ufw allow 3001/tcp
```

## 安全考量

### 1. 信令安全

#### JWT Token 驗證
```typescript
// websocket.gateway.ts 中的認證中間件
async handleConnection(client: Socket) {
  try {
    const token = client.handshake.auth.token;
    const decoded = await this.jwtService.verifyAsync(token);
    
    client.data = {
      userId: decoded.userId,
      username: decoded.username,
      // ... 其他用戶信息
    };
    
    this.logger.log(`用戶 ${decoded.username} 已連接 WebSocket`);
  } catch (error) {
    this.logger.error('WebSocket 認證失敗:', error);
    client.disconnect(true);
  }
}
```

#### 通話權限檢查
```typescript
@SubscribeMessage('call-request')
async handleCallRequest(
  @MessageBody() data: CallRequestPayload,
  @ConnectedSocket() client: Socket,
) {
  const callerId = client.data.userId;
  const { to: calleeId } = data;

  // 檢查用戶是否有權限呼叫目標用戶
  const canCall = await this.checkCallPermission(callerId, calleeId);
  if (!canCall) {
    client.emit('call-error', {
      callId: data.callId,
      error: '無權限呼叫該用戶',
      code: 403,
    });
    return;
  }

  // ... 繼續處理
}

private async checkCallPermission(callerId: string, calleeId: string): Promise<boolean> {
  // 實現權限檢查邏輯
  // 例如：檢查是否為好友、是否在黑名單等
  return true;
}
```

### 2. 媒體安全

#### DTLS 強制加密
```dart
// Flutter 中的 PeerConnection 配置
final Map<String, dynamic> _iceServers = {
  'iceServers': [
    {
      'urls': 'stun:stun.l.google.com:19302',
    },
    {
      'urls': 'turns:your-server.com:5349', // 使用 TURNS (TLS)
      'username': username,
      'credential': password,
    },
  ],
  // 強制 DTLS 加密
  'bundlePolicy': 'max-bundle',
  'rtcpMuxPolicy': 'require',
};
```

### 3. 速率限制

#### 通話頻率限制
```typescript
// 使用 Redis 實現速率限制
private callLimiter = new Map<string, number[]>();

private checkCallRateLimit(userId: string): boolean {
  const now = Date.now();
  const userCalls = this.callLimiter.get(userId) || [];
  
  // 清理 1 分鐘前的記錄
  const recentCalls = userCalls.filter(time => now - time < 60000);
  
  // 限制每分鐘最多 5 次通話請求
  if (recentCalls.length >= 5) {
    return false;
  }
  
  recentCalls.push(now);
  this.callLimiter.set(userId, recentCalls);
  return true;
}
```

## 性能優化

### 1. 信令優化

#### 連線池管理
```typescript
// 優化用戶連線查詢
private userConnections = new Map<string, Set<string>>();
private connectionDetails = new Map<string, DeviceConnection>();

private addUserConnection(userId: string, connectionId: string, connection: DeviceConnection) {
  if (!this.userConnections.has(userId)) {
    this.userConnections.set(userId, new Set());
  }
  this.userConnections.get(userId)!.add(connectionId);
  this.connectionDetails.set(connectionId, connection);
}

private getUserConnections(userId: string): DeviceConnection[] {
  const connectionIds = this.userConnections.get(userId) || new Set();
  return Array.from(connectionIds)
    .map(id => this.connectionDetails.get(id))
    .filter(Boolean) as DeviceConnection[];
}
```

#### 批量訊息處理
```typescript
// 批量發送 ICE candidates
private pendingCandidates = new Map<string, any[]>();

@SubscribeMessage('ice-candidate')
async handleIceCandidate(
  @MessageBody() data: IceCandidatePayload,
  @ConnectedSocket() client: Socket,
) {
  const key = `${data.callId}-${data.to}`;
  
  if (!this.pendingCandidates.has(key)) {
    this.pendingCandidates.set(key, []);
    
    // 100ms 後批量發送
    setTimeout(() => {
      const candidates = this.pendingCandidates.get(key) || [];
      if (candidates.length > 0) {
        this.sendBatchedCandidates(data.to, candidates);
        this.pendingCandidates.delete(key);
      }
    }, 100);
  }
  
  this.pendingCandidates.get(key)!.push(data);
}
```

### 2. WebRTC 優化

#### 編碼器配置
```dart
// 優化視頻編碼設置
final Map<String, dynamic> mediaConstraints = {
  'audio': {
    'echoCancellation': true,
    'noiseSuppression': true,
    'autoGainControl': true,
  },
  'video': {
    'width': {'min': 320, 'ideal': 1280, 'max': 1920},
    'height': {'min': 240, 'ideal': 720, 'max': 1080},
    'frameRate': {'min': 15, 'ideal': 30, 'max': 60},
  }
};

// 動態調整碼率
void adjustBitrate(RTCPeerConnection pc, int targetBitrate) {
  pc.getSenders().forEach((sender) async {
    if (sender.track?.kind == 'video') {
      final params = await sender.getParameters();
      if (params.encodings.isNotEmpty) {
        params.encodings[0].maxBitrate = targetBitrate;
        await sender.setParameters(params);
      }
    }
  });
}
```

### 3. 資料庫優化

#### 通話記錄索引
```javascript
// MongoDB 索引創建
db.call_records.createIndex(
  { "caller_id": 1, "start_time": -1 },
  { name: "caller_history" }
);

db.call_records.createIndex(
  { "callee_id": 1, "start_time": -1 },
  { name: "callee_history" }
);

db.call_records.createIndex(
  { "status": 1, "start_time": -1 },
  { name: "status_time" }
);

// TTL 索引，自動清理舊記錄 (90天)
db.call_records.createIndex(
  { "start_time": 1 },
  { 
    name: "ttl_cleanup",
    expireAfterSeconds: 7776000  // 90 days
  }
);
```

## 故障排除

### 1. 常見問題

#### ICE 連線失敗
```typescript
// 診斷 ICE 連線狀態
_peerConnection.onIceConnectionState = (state) {
  print('ICE Connection State: $state');
  
  switch (state) {
    case RTCIceConnectionState.RTCIceConnectionStateFailed:
      // 嘗試重啟 ICE
      _restartIce();
      break;
    case RTCIceConnectionState.RTCIceConnectionStateDisconnected:
      // 網路斷線，嘗試重連
      _handleNetworkDisconnection();
      break;
  }
};

void _restartIce() async {
  try {
    await _peerConnection.restartIce();
    print('ICE restart initiated');
  } catch (e) {
    print('ICE restart failed: $e');
  }
}
```

#### 音頻問題診斷
```dart
// 檢查音頻軌道狀態
void diagnoseAudioIssues() {
  _localStream?.getAudioTracks().forEach((track) {
    print('Local audio track enabled: ${track.enabled}');
    print('Local audio track muted: ${track.muted}');
  });
  
  _remoteStream?.getAudioTracks().forEach((track) {
    print('Remote audio track enabled: ${track.enabled}');
    print('Remote audio track muted: ${track.muted}');
  });
}

// 音頻設備權限檢查
Future<bool> checkAudioPermission() async {
  try {
    final stream = await navigator.mediaDevices.getUserMedia({'audio': true});
    stream.dispose();
    return true;
  } catch (e) {
    print('Audio permission denied: $e');
    return false;
  }
}
```

### 2. 監控與日誌

#### WebRTC 統計收集
```dart
// 定期收集 WebRTC 統計數據
Timer? _statsTimer;

void startStatsCollection() {
  _statsTimer = Timer.periodic(Duration(seconds: 5), (timer) async {
    if (_peerConnection != null) {
      final stats = await _peerConnection!.getStats();
      _processRTCStats(stats);
    }
  });
}

void _processRTCStats(List<StatsReport> stats) {
  for (final report in stats) {
    if (report.type == 'inbound-rtp' && report.values['mediaType'] == 'video') {
      final bytesReceived = report.values['bytesReceived'];
      final packetsLost = report.values['packetsLost'];
      
      print('Video bytes received: $bytesReceived');
      print('Video packets lost: $packetsLost');
    }
  }
}
```

#### 服務器監控
```typescript
// 通話統計 API
@SubscribeMessage('getCallStats')
handleGetCallStats(@ConnectedSocket() client: Socket) {
  const stats = {
    activeCalls: this.getActiveCallsCount(),
    totalConnectionsToday: this.getTotalConnectionsToday(),
    averageCallDuration: this.getAverageCallDuration(),
    failureRate: this.getCallFailureRate(),
  };
  
  client.emit('call-stats', stats);
}

// 性能指標收集
private performanceMetrics = {
  callSetupTime: new Map<string, number>(),
  iceGatheringTime: new Map<string, number>(),
  connectionEstablishmentTime: new Map<string, number>(),
};
```

# 通話錄音功能擴展

## 概述

基於上述 WebRTC 端對端通話系統，本節設計了企業級通話錄音功能。提供兩種實現方案：客戶端錄音（快速實現）和服務器端錄音（業界標準），以滿足不同場景需求。

## 錄音方案比較

| 特性 | 客戶端錄音 (方案一) | 服務器端錄音 (方案二) |
|------|-------------------|---------------------|
| **實現複雜度** | 簡單 | 複雜 |
| **服務器負載** | 低 | 高 |
| **錄音可靠性** | 中等 | 高 |
| **存儲成本** | 低 | 中等 |
| **技術要求** | MediaRecorder API | 媒體服務器 |
| **推薦場景** | 快速實現、成本控制 | 企業級、高可靠性 |

## 方案二：服務器端錄音 (推薦)

### 架構設計

#### 整體架構圖（含錄音）

```ascii
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              前端應用層 (Flutter)                                │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐            │
│  │  WebRTC Client  │    │  Socket.IO      │    │  HTTP Client    │            │
│  │  (P2P 音視頻)    │    │  (信令通道)      │    │  (API 調用)      │            │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘            │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              網路層                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│       HTTP/HTTPS (Port 3000)         │         WebSocket (Port 3001)           │
│            REST API                   │           信令通道                        │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            微服務層 (Nest.js)                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐            │
│  │   API Gateway   │    │ WebSocket Server│    │ STUN/TURN Server│            │
│  │   (Port 3000)   │    │   (Port 3001)   │    │ (External/Self) │            │
│  │  HTTP ↔ gRPC   │    │  信令轉發中心     │    │  NAT 穿透支援    │            │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘            │
│                                  │                                              │
│                        ┌─────────────────┐                                     │
│                        │ Janus Media     │  ⭐ 新增錄音核心                      │
│                        │ Server          │                                     │
│                        │ (Port 8088)     │                                     │
│                        │ 錄音 & 中繼      │                                     │
│                        └─────────────────┘                                     │
│                                  │                                              │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                      gRPC 內部通信層                                     │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐      │   │
│  │  │ User Service│ │Chat Service │ │Notification │ │Call Service │      │   │
│  │  │ (Port 50052)│ │(Port 50053) │ │ (Port 50056)│ │(Port 50058) │      │   │
│  │  │ 用戶管理     │ │聊天訊息     │ │推播通知     │ │通話 & 錄音   │      │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘      │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              存儲層                                              │
├─────────────────────────────────────────────────────────────────────────────────┤
│                            MongoDB 資料庫                                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │   Users     │ │ Conversations│ │   Messages  │ │ Call Records│              │
│  │   用戶資料   │ │   對話記錄   │ │   訊息記錄   │ │   通話記錄   │              │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘              │
│                                                                                 │
│                            MinIO 物件存儲                                        │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐              │
│  │  file-bucket│ │message-files│ │ user-avatars│ │call-records │ ⭐ 新增錄音存儲│
│  │   檔案存儲   │ │   訊息檔案   │ │   用戶頭像   │ │   通話錄音   │              │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘              │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                          錄音流程圖                                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│   使用者 A                  Janus Media Server                   使用者 B        │
│     │                              │                              │             │
│     │ ──── WebRTC Stream ──────────►│◄──── WebRTC Stream ─────── │             │
│     │                              │                              │             │
│     │                         ┌────▼────┐                        │             │
│     │                         │ 錄音模組 │                        │             │
│     │                         │Recording │                        │             │
│     │                         │ Plugin  │                        │             │
│     │                         └────┬────┘                        │             │
│     │                              │                              │             │
│     │                              ▼                              │             │
│     │                       MinIO 存儲                            │             │
│     │                    call-records bucket                     │             │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 技術棧

#### 媒體服務器
- **Janus WebRTC Server**: 開源 WebRTC 媒體服務器
- **janode**: Janus 的官方 Node.js 適配器
- **Janus Recording Plugin**: 內建錄音插件

#### 錄音處理
- **FFmpeg**: 音視頻格式轉換和處理
- **@aws-sdk/client-s3**: MinIO S3 兼容上傳
- **winston**: 錄音操作日誌記錄

### 核心組件設計

#### 1. Janus Media Server 配置

##### Docker Compose 整合
```yaml
# 在 docker-compose.yml 中新增
services:
  # ... 現有服務
  
  janus:
    image: meetecho/janus-gateway:latest
    ports:
      - "8088:8088"     # HTTP API
      - "8188:8188"     # WebSocket
      - "10000-10200:10000-10200/udp"  # RTP
    volumes:
      - ./config/janus:/opt/janus/etc/janus:ro
      - janus_logs:/opt/janus/logs
      - janus_recordings:/opt/janus/recordings
    environment:
      - JANUS_LOG_LEVEL=4
      - JANUS_RECORDING_BASE_PATH=/opt/janus/recordings
    restart: unless-stopped
    networks:
      - app-network
    depends_on:
      - mongodb

volumes:
  janus_logs:
  janus_recordings:
```

##### Janus 配置文件
```ini
# config/janus/janus.jcfg
general: {
    admin_secret = "your-admin-secret"
    api_secret = "your-api-secret"
    session_timeout = 60
    reclaim_session_timeout = 0
}

webserver: {
    base_path = "/janus"
    http = true
    port = 8088
    https = false
    ws = true
    ws_port = 8188
}

media: {
    rtp_port_range = "10000-10200"
    dtls_accept_selfsigned = true
}

# 錄音插件配置
# config/janus/janus.plugin.recordplay.jcfg
general: {
    path = "/opt/janus/recordings"
    base_path = "/recordings"
}
```

#### 2. 錄音服務整合

##### Recording Service (新增)
```typescript
// recording-service/src/recording.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Janus } from 'janode';
import { ConfigService } from '@nestjs/config';
import { MinioService } from '../minio/minio.service';

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);
  private janusClient: Janus;
  private activeRecordings = new Map<string, RecordingSession>();

  constructor(
    private configService: ConfigService,
    private minioService: MinioService,
  ) {
    this.initializeJanus();
  }

  private async initializeJanus() {
    this.janusClient = new Janus({
      url: this.configService.get('JANUS_WS_URL') || 'ws://janus:8188',
      apiSecret: this.configService.get('JANUS_API_SECRET'),
    });

    await this.janusClient.connect();
    this.logger.log('已連接到 Janus Media Server');
  }

  async startRecording(callId: string, participants: string[]): Promise<RecordingSession> {
    try {
      const session = await this.janusClient.createSession();
      const recordingHandle = await session.attach('janus.plugin.recordplay');

      // 配置錄音參數
      const recordingConfig = {
        request: 'record',
        name: `call-${callId}`,
        filename: `${callId}.webm`,
        audio: true,
        video: true,
        participants,
      };

      const response = await recordingHandle.message(recordingConfig);
      
      if (response.result?.status === 'recording') {
        const recordingSession: RecordingSession = {
          callId,
          sessionId: session.id,
          handleId: recordingHandle.id,
          filename: recordingConfig.filename,
          startTime: new Date(),
          participants,
          status: 'active',
        };

        this.activeRecordings.set(callId, recordingSession);
        this.logger.log(`開始錄音通話 ${callId}`);
        
        return recordingSession;
      }

      throw new Error('錄音啟動失敗');
    } catch (error) {
      this.logger.error(`錄音啟動錯誤 ${callId}:`, error);
      throw error;
    }
  }

  async stopRecording(callId: string): Promise<string> {
    const recordingSession = this.activeRecordings.get(callId);
    if (!recordingSession) {
      throw new Error(`找不到通話 ${callId} 的錄音會話`);
    }

    try {
      const session = await this.janusClient.getSession(recordingSession.sessionId);
      const handle = await session.getHandle(recordingSession.handleId);

      // 停止錄音
      await handle.message({ request: 'stop' });
      
      recordingSession.endTime = new Date();
      recordingSession.status = 'completed';

      // 等待文件處理完成
      await this.waitForRecordingFile(recordingSession.filename);

      // 上傳到 MinIO
      const minioUrl = await this.uploadToMinio(recordingSession);

      // 清理本地文件
      await this.cleanupLocalFile(recordingSession.filename);
      
      this.activeRecordings.delete(callId);
      this.logger.log(`通話 ${callId} 錄音完成，已上傳到 ${minioUrl}`);

      return minioUrl;
    } catch (error) {
      this.logger.error(`停止錄音錯誤 ${callId}:`, error);
      throw error;
    }
  }

  private async waitForRecordingFile(filename: string): Promise<void> {
    const fs = require('fs').promises;
    const path = require('path');
    const filePath = path.join('/opt/janus/recordings', filename);
    
    // 等待文件完成寫入 (最多等待 30 秒)
    for (let i = 0; i < 30; i++) {
      try {
        const stats = await fs.stat(filePath);
        if (stats.size > 0) {
          // 額外等待 2 秒確保文件完整
          await new Promise(resolve => setTimeout(resolve, 2000));
          return;
        }
      } catch (error) {
        // 文件還不存在，繼續等待
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`錄音文件 ${filename} 生成超時`);
  }

  private async uploadToMinio(session: RecordingSession): Promise<string> {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join('/opt/janus/recordings', session.filename);

    try {
      const fileStream = fs.createReadStream(filePath);
      const stats = fs.statSync(filePath);
      
      const objectName = `${session.callId}/${session.filename}`;
      
      const uploadResult = await this.minioService.uploadFile(
        'call-records',
        objectName,
        fileStream,
        stats.size,
        'video/webm',
      );

      return uploadResult.url;
    } catch (error) {
      this.logger.error(`上傳錄音文件失敗:`, error);
      throw error;
    }
  }

  private async cleanupLocalFile(filename: string): Promise<void> {
    const fs = require('fs').promises;
    const path = require('path');
    const filePath = path.join('/opt/janus/recordings', filename);

    try {
      await fs.unlink(filePath);
      this.logger.log(`已清理本地錄音文件: ${filename}`);
    } catch (error) {
      this.logger.warn(`清理本地文件失敗 ${filename}:`, error);
    }
  }

  async getActiveRecordings(): Promise<RecordingSession[]> {
    return Array.from(this.activeRecordings.values());
  }
}

interface RecordingSession {
  callId: string;
  sessionId: string;
  handleId: string;
  filename: string;
  startTime: Date;
  endTime?: Date;
  participants: string[];
  status: 'active' | 'completed' | 'failed';
}
```

#### 3. Call Service 擴展

##### 錄音相關 gRPC 擴展
```protobuf
// services/protos/call.proto 擴展
syntax = "proto3";

package call;

service CallService {
  // ... 現有方法
  rpc StartRecording (StartRecordingRequest) returns (StartRecordingResponse);
  rpc StopRecording (StopRecordingRequest) returns (StopRecordingResponse);
  rpc GetRecordings (GetRecordingsRequest) returns (GetRecordingsResponse);
  rpc DeleteRecording (DeleteRecordingRequest) returns (DeleteRecordingResponse);
}

message StartRecordingRequest {
  string call_id = 1;
  repeated string participants = 2;
  bool require_consent = 3;
}

message StartRecordingResponse {
  bool success = 1;
  string message = 2;
  optional string recording_id = 3;
}

message StopRecordingRequest {
  string call_id = 1;
}

message StopRecordingResponse {
  bool success = 1;
  string message = 2;
  optional string recording_url = 3;
  optional int64 duration_seconds = 4;
}

message Recording {
  string recording_id = 1;
  string call_id = 2;
  repeated string participants = 3;
  string recording_url = 4;
  int64 start_time = 5;
  optional int64 end_time = 6;
  optional int64 duration_seconds = 7;
  int64 file_size_bytes = 8;
  string status = 9;  // "active" | "completed" | "failed"
  optional string consent_status = 10;  // "pending" | "granted" | "denied"
}

message GetRecordingsRequest {
  optional string call_id = 1;
  optional string user_id = 2;
  int32 page = 3;
  int32 limit = 4;
}

message GetRecordingsResponse {
  repeated Recording recordings = 1;
  int32 total = 2;
}

message DeleteRecordingRequest {
  string recording_id = 1;
  string requester_user_id = 2;
}

message DeleteRecordingResponse {
  bool success = 1;
  string message = 2;
}
```

##### Call Service 實現
```typescript
// call-service/src/app.service.ts 擴展
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CallRecord, CallRecordDocument } from './schemas/call-record.schema';
import { Recording, RecordingDocument } from './schemas/recording.schema';
import { RecordingService } from './recording/recording.service';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(
    @InjectModel(CallRecord.name) private callModel: Model<CallRecordDocument>,
    @InjectModel(Recording.name) private recordingModel: Model<RecordingDocument>,
    private recordingService: RecordingService,
  ) {}

  // ... 現有方法

  async startRecording({
    callId,
    participants,
    requireConsent,
  }: {
    callId: string;
    participants: string[];
    requireConsent: boolean;
  }): Promise<{ success: boolean; message: string; recordingId?: string }> {
    try {
      // 檢查通話是否存在且進行中
      const call = await this.callModel.findOne({
        call_id: callId,
        status: 'accepted',
      });

      if (!call) {
        return {
          success: false,
          message: '找不到進行中的通話',
        };
      }

      // 檢查是否已有錄音
      const existingRecording = await this.recordingModel.findOne({
        call_id: callId,
        status: { $in: ['active', 'completed'] },
      });

      if (existingRecording) {
        return {
          success: false,
          message: '該通話已在錄音中',
        };
      }

      // 創建錄音記錄
      const recording = new this.recordingModel({
        call_id: callId,
        participants,
        status: 'active',
        start_time: new Date(),
        consent_status: requireConsent ? 'pending' : 'granted',
        require_consent: requireConsent,
      });

      const savedRecording = await recording.save();

      // 如果需要同意，先不開始實際錄音
      if (requireConsent) {
        return {
          success: true,
          message: '錄音請求已創建，等待參與者同意',
          recordingId: savedRecording._id.toString(),
        };
      }

      // 開始實際錄音
      const recordingSession = await this.recordingService.startRecording(
        callId,
        participants,
      );

      savedRecording.recording_session_id = recordingSession.sessionId;
      await savedRecording.save();

      this.logger.log(`通話 ${callId} 開始錄音`);

      return {
        success: true,
        message: '錄音已開始',
        recordingId: savedRecording._id.toString(),
      };
    } catch (error) {
      this.logger.error('開始錄音失敗:', error);
      return {
        success: false,
        message: '錄音啟動失敗',
      };
    }
  }

  async stopRecording(callId: string): Promise<{
    success: boolean;
    message: string;
    recordingUrl?: string;
    durationSeconds?: number;
  }> {
    try {
      const recording = await this.recordingModel.findOne({
        call_id: callId,
        status: 'active',
      });

      if (!recording) {
        return {
          success: false,
          message: '找不到進行中的錄音',
        };
      }

      // 停止錄音並獲取文件 URL
      const recordingUrl = await this.recordingService.stopRecording(callId);
      
      const endTime = new Date();
      const durationSeconds = Math.floor(
        (endTime.getTime() - recording.start_time.getTime()) / 1000,
      );

      // 更新錄音記錄
      recording.end_time = endTime;
      recording.duration_seconds = durationSeconds;
      recording.recording_url = recordingUrl;
      recording.status = 'completed';
      await recording.save();

      this.logger.log(`通話 ${callId} 錄音已完成，時長: ${durationSeconds}秒`);

      return {
        success: true,
        message: '錄音已完成',
        recordingUrl,
        durationSeconds,
      };
    } catch (error) {
      this.logger.error('停止錄音失敗:', error);
      return {
        success: false,
        message: '停止錄音失敗',
      };
    }
  }

  async getRecordings({
    callId,
    userId,
    page = 1,
    limit = 20,
  }: {
    callId?: string;
    userId?: string;
    page: number;
    limit: number;
  }): Promise<{ recordings: Recording[]; total: number }> {
    const query: any = {};

    if (callId) {
      query.call_id = callId;
    }

    if (userId) {
      query.participants = userId;
    }

    const total = await this.recordingModel.countDocuments(query);
    const recordings = await this.recordingModel
      .find(query)
      .sort({ start_time: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    return { recordings, total };
  }

  async deleteRecording(
    recordingId: string,
    requesterUserId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const recording = await this.recordingModel.findById(recordingId);

      if (!recording) {
        return {
          success: false,
          message: '找不到指定的錄音',
        };
      }

      // 檢查權限：只有參與者可以刪除錄音
      if (!recording.participants.includes(requesterUserId)) {
        return {
          success: false,
          message: '無權限刪除此錄音',
        };
      }

      // 從 MinIO 刪除文件
      if (recording.recording_url) {
        // 這裡需要實現 MinIO 文件刪除邏輯
        // await this.minioService.deleteFile(recording.recording_url);
      }

      // 從資料庫刪除記錄
      await this.recordingModel.findByIdAndDelete(recordingId);

      this.logger.log(`錄音 ${recordingId} 已被用戶 ${requesterUserId} 刪除`);

      return {
        success: true,
        message: '錄音已刪除',
      };
    } catch (error) {
      this.logger.error('刪除錄音失敗:', error);
      return {
        success: false,
        message: '刪除錄音失敗',
      };
    }
  }
}
```

#### 4. 資料庫 Schema

##### Recording Schema
```typescript
// call-service/src/schemas/recording.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type RecordingDocument = Recording & Document;

@Schema({ timestamps: true })
export class Recording {
  @Prop({ required: true, index: true })
  call_id: string;

  @Prop({ type: [String], required: true })
  participants: string[];

  @Prop({ required: true })
  start_time: Date;

  @Prop()
  end_time?: Date;

  @Prop()
  duration_seconds?: number;

  @Prop()
  recording_url?: string;

  @Prop()
  recording_session_id?: string;

  @Prop({ default: 0 })
  file_size_bytes: number;

  @Prop({ 
    enum: ['active', 'completed', 'failed'],
    default: 'active',
    index: true 
  })
  status: string;

  @Prop({ 
    enum: ['pending', 'granted', 'denied'],
    default: 'granted' 
  })
  consent_status: string;

  @Prop({ default: false })
  require_consent: boolean;

  @Prop({ type: Map, of: String })
  participant_consent: Map<string, 'granted' | 'denied'>;

  // 自動時間戳
  createdAt?: Date;
  updatedAt?: Date;
}

export const RecordingSchema = SchemaFactory.createForClass(Recording);

// 創建複合索引
RecordingSchema.index({ call_id: 1, status: 1 });
RecordingSchema.index({ participants: 1, start_time: -1 });
```

#### 5. WebSocket 錄音事件

##### 錄音控制事件
```typescript
// websocket-server/src/websocket/websocket.gateway.ts 擴展

@SubscribeMessage('start-recording')
async handleStartRecording(
  @MessageBody() data: { callId: string; requireConsent?: boolean },
  @ConnectedSocket() client: Socket,
) {
  const userId = client.data.userId;
  const { callId, requireConsent = true } = data;

  try {
    // 檢查用戶是否是通話參與者
    const participants = this.getCallParticipants(callId);
    if (!participants.includes(userId)) {
      client.emit('recording-error', {
        callId,
        error: '只有通話參與者可以開始錄音',
      });
      return;
    }

    // 如果需要同意，先向所有參與者發送同意請求
    if (requireConsent) {
      const consentData = {
        callId,
        requestedBy: userId,
        requestedByName: client.data.username,
        timestamp: Date.now(),
      };

      participants.forEach(participantId => {
        if (participantId !== userId) {
          const connections = this.getUserConnections(participantId);
          connections.forEach(connection => {
            connection.socket.emit('recording-consent-request', consentData);
          });
        }
      });

      client.emit('recording-consent-sent', {
        callId,
        message: '錄音同意請求已發送給所有參與者',
      });
    }

    // 調用 Call Service 開始錄音
    const result = await this.callClientService.startRecording({
      callId,
      participants,
      requireConsent,
    });

    if (result.success) {
      // 通知所有參與者錄音已開始
      if (!requireConsent) {
        participants.forEach(participantId => {
          const connections = this.getUserConnections(participantId);
          connections.forEach(connection => {
            connection.socket.emit('recording-started', {
              callId,
              recordingId: result.recordingId,
              startedBy: userId,
              timestamp: Date.now(),
            });
          });
        });
      }

      client.emit('recording-start-response', result);
    } else {
      client.emit('recording-error', {
        callId,
        error: result.message,
      });
    }
  } catch (error) {
    this.logger.error('處理錄音開始請求失敗:', error);
    client.emit('recording-error', {
      callId,
      error: '系統錯誤',
    });
  }
}

@SubscribeMessage('recording-consent')
async handleRecordingConsent(
  @MessageBody() data: { callId: string; consent: boolean },
  @ConnectedSocket() client: Socket,
) {
  const userId = client.data.userId;
  const { callId, consent } = data;

  try {
    // 更新同意狀態
    await this.callClientService.updateRecordingConsent({
      callId,
      userId,
      consent,
    });

    // 檢查是否所有參與者都已同意
    const consentStatus = await this.callClientService.getRecordingConsentStatus(callId);
    
    if (consentStatus.allGranted) {
      // 開始實際錄音
      const result = await this.recordingService.startRecording(
        callId,
        consentStatus.participants,
      );

      if (result) {
        // 通知所有參與者錄音已開始
        consentStatus.participants.forEach(participantId => {
          const connections = this.getUserConnections(participantId);
          connections.forEach(connection => {
            connection.socket.emit('recording-started', {
              callId,
              timestamp: Date.now(),
            });
          });
        });
      }
    } else if (consentStatus.anyDenied) {
      // 有人拒絕，取消錄音請求
      consentStatus.participants.forEach(participantId => {
        const connections = this.getUserConnections(participantId);
        connections.forEach(connection => {
          connection.socket.emit('recording-consent-denied', {
            callId,
            deniedBy: userId,
            timestamp: Date.now(),
          });
        });
      });
    }
  } catch (error) {
    this.logger.error('處理錄音同意失敗:', error);
    client.emit('recording-error', {
      callId,
      error: '系統錯誤',
    });
  }
}

@SubscribeMessage('stop-recording')
async handleStopRecording(
  @MessageBody() data: { callId: string },
  @ConnectedSocket() client: Socket,
) {
  const userId = client.data.userId;
  const { callId } = data;

  try {
    // 檢查權限
    const participants = this.getCallParticipants(callId);
    if (!participants.includes(userId)) {
      client.emit('recording-error', {
        callId,
        error: '只有通話參與者可以停止錄音',
      });
      return;
    }

    // 調用 Call Service 停止錄音
    const result = await this.callClientService.stopRecording(callId);

    if (result.success) {
      // 通知所有參與者錄音已停止
      participants.forEach(participantId => {
        const connections = this.getUserConnections(participantId);
        connections.forEach(connection => {
          connection.socket.emit('recording-stopped', {
            callId,
            recordingUrl: result.recordingUrl,
            duration: result.durationSeconds,
            stoppedBy: userId,
            timestamp: Date.now(),
          });
        });
      });

      client.emit('recording-stop-response', result);
    } else {
      client.emit('recording-error', {
        callId,
        error: result.message,
      });
    }
  } catch (error) {
    this.logger.error('處理錄音停止請求失敗:', error);
    client.emit('recording-error', {
      callId,
      error: '系統錯誤',
    });
  }
}

private getCallParticipants(callId: string): string[] {
  // 實現獲取通話參與者邏輯
  // 這可能需要查詢通話記錄或維護一個活動通話映射
  return [];
}
```

### API 端點設計

#### HTTP REST API
```typescript
// api-gateway/src/controllers/call.controller.ts 擴展

@Controller('call')
export class CallController {
  // ... 現有方法

  @Post('recordings/start')
  @UseGuards(JwtAuthGuard)
  async startRecording(
    @Body() startRecordingDto: StartRecordingDto,
    @Request() req,
  ) {
    return this.callService.startRecording({
      ...startRecordingDto,
      requesterId: req.user.userId,
    });
  }

  @Post('recordings/:callId/stop')
  @UseGuards(JwtAuthGuard)
  async stopRecording(
    @Param('callId') callId: string,
    @Request() req,
  ) {
    return this.callService.stopRecording(callId, req.user.userId);
  }

  @Get('recordings')
  @UseGuards(JwtAuthGuard)
  async getRecordings(
    @Query() query: GetRecordingsDto,
    @Request() req,
  ) {
    return this.callService.getRecordings({
      ...query,
      userId: req.user.userId,
    });
  }

  @Get('recordings/:recordingId/download')
  @UseGuards(JwtAuthGuard)
  async downloadRecording(
    @Param('recordingId') recordingId: string,
    @Request() req,
    @Res() res,
  ) {
    // 實現安全的錄音文件下載
    // 包括權限檢查和預簽名 URL 生成
  }

  @Delete('recordings/:recordingId')
  @UseGuards(JwtAuthGuard)
  async deleteRecording(
    @Param('recordingId') recordingId: string,
    @Request() req,
  ) {
    return this.callService.deleteRecording(recordingId, req.user.userId);
  }
}
```

### 部署配置

#### 環境變數
```bash
# .env.dev 新增
# Janus 配置
JANUS_WS_URL=ws://janus:8188
JANUS_HTTP_URL=http://janus:8088
JANUS_API_SECRET=your-janus-api-secret
JANUS_ADMIN_SECRET=your-janus-admin-secret

# 錄音配置
RECORDING_ENABLED=true
RECORDING_MAX_DURATION_MINUTES=120
RECORDING_AUTO_DELETE_DAYS=90
RECORDING_REQUIRE_CONSENT=true

# MinIO 錄音存儲
MINIO_CALL_RECORDS_BUCKET=call-records
MINIO_RECORDING_PRESIGNED_EXPIRY=7200  # 2小時
```

### 安全與合規

#### 隱私保護
1. **明確同意機制**: 錄音前必須獲得所有參與者同意
2. **數據加密**: 錄音文件在存儲和傳輸中加密
3. **訪問控制**: 只有通話參與者可以訪問錄音
4. **自動清理**: 設定錄音文件自動刪除期限

#### 法律合規
```typescript
// 同意條款範例
const RECORDING_CONSENT_TEXT = `
通過同意此錄音，您確認：
1. 您同意此次通話被錄音保存
2. 錄音將僅用於商業目的和品質改善
3. 錄音將在 ${RECORDING_RETENTION_DAYS} 天後自動刪除
4. 您可以隨時要求刪除錄音記錄
5. 您了解錄音將存儲在我們的安全服務器上
`;
```

## 結論

本設計文件提供了基於現有微服務架構的完整 WebRTC 端對端通話解決方案，並擴展了企業級錄音功能。該方案具有以下優勢：

### 核心功能
1. **高性能**: P2P 直連減少延遲和服務器負載
2. **高可靠性**: TURN 中繼保證連線成功率  
3. **可擴展性**: 微服務架構支持水平擴展
4. **安全性**: 端到端加密和完整的認證機制
5. **用戶體驗**: 推播通知確保離線用戶能及時收到通話邀請

### 錄音擴展
6. **專業錄音**: Janus 媒體服務器提供業界標準錄音品質
7. **隱私合規**: 完整的同意機制和數據保護
8. **存儲整合**: 與現有 MinIO 基礎設施無縫整合
9. **靈活管理**: 支援錄音的開始、停止、下載和刪除
10. **成本控制**: 自動清理機制控制存儲成本

通過遵循本文件的設計和實現指南，可以構建一個穩定、高效、合規的企業級音視頻通話系統。

---

*此文件將隨著技術發展和需求變更持續更新。*