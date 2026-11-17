# IM Services - LiveKit 語音/視訊通話整合計劃書

**版本**: v1.0
**建立日期**: 2025-11-18
**LiveKit SDK 版本**: v2.14.1 (最新)
**Node.js**: ≥ 18.x
**NestJS**: ≥ 10.x

---

## 目錄

1. [專案概述](#1-專案概述)
2. [整體系統架構](#2-整體系統架構)
3. [服務交互流程](#3-服務交互流程)
4. [gRPC 接口設計](#4-grpc-接口設計)
5. [詳細實施計劃](#5-詳細實施計劃)
6. [資料庫設計](#6-資料庫設計)
7. [時程與里程碑](#7-時程與里程碑)
8. [風險評估與緩解](#8-風險評估與緩解)
9. [成功指標](#9-成功指標)
10. [附錄](#10-附錄)

---

## 重要更新說明

### LiveKit v2.x API 關鍵變化

```typescript
// ⚠️ v2.x 重要變更：toJwt() 現在是異步方法
// v1.x (舊版 - 不要使用)
const token = at.toJWT();  // ❌ 錯誤

// v2.x (最新 - 必須使用)
const token = await at.toJwt();  // ✅ 正確
```

**其他 v2.x 變更：**
- `verify()` 現在也是異步的
- `receiver.receive()` 現在是異步的
- Egress 請求使用類（Class）而非接口（Interface）
- 支援 Node.js、Deno、Bun 運行時

---

## 1. 專案概述

### 1.1 專案目標

在現有的 IM Services 微服務架構中整合 **LiveKit v2.14.1**，實現企業級的語音和視訊通話功能。

**核心功能：**
- 1對1 語音/視訊通話
- 群組語音/視訊會議（最多 20-100 人）
- 即時來電通知（在線 WebSocket + 離線推播）
- 完整的通話記錄管理
- 與現有聊天系統深度整合

### 1.2 技術選型

| 組件 | 技術 | 版本 |
|------|------|------|
| **前端框架** | **Flutter** | **≥ 3.24.x** |
| **Flutter LiveKit SDK** | **livekit_client** | **^2.2.0** |
| WebRTC SFU | LiveKit Server | latest (Go) |
| Server SDK | livekit-server-sdk | v2.14.1 |
| 後端框架 | NestJS | ≥ 10.x |
| 運行時 | Node.js | ≥ 18.x |
| 通訊協議 | gRPC + WebSocket | - |
| 資料庫 | MongoDB | 8.0 |
| TURN Server | Coturn | latest |

### 1.3 核心優勢

- **原生 gRPC 整合**：完美融入現有微服務架構
- **UI 完全可控**：前端使用 SDK，不受限於預設 UI
- **資料完全掌控**：通話記錄、統計完全保存到自有資料庫
- **彈性擴展**：從 2 人到 100 人會議無縫擴展
- **安全性**：JWT Token 認證，HTTPS/WSS 加密

---

## 2. 整體系統架構

### 2.1 完整架構圖

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         客戶端層 (Client Layer)                          │
│                                                                          │
│              ┌──────────────────────────────────────┐                    │
│              │      Flutter App (跨平台)            │                    │
│              │  ┌────────────────────────────────┐  │                    │
│              │  │  iOS (Cupertino)               │  │                    │
│              │  │  - iPhone / iPad               │  │                    │
│              │  │  - CallKit 整合                │  │                    │
│              │  └────────────────────────────────┘  │                    │
│              │  ┌────────────────────────────────┐  │                    │
│              │  │  Android (Material)            │  │                    │
│              │  │  - 手機 / 平板                  │  │                    │
│              │  │  - ConnectionService 整合      │  │                    │
│              │  └────────────────────────────────┘  │                    │
│              │  ┌────────────────────────────────┐  │                    │
│              │  │  Web (Canvas/HTML)             │  │                    │
│              │  │  - Chrome / Safari / Edge      │  │                    │
│              │  └────────────────────────────────┘  │                    │
│              └─────────────┬────────────────────────┘                    │
│                            │                                             │
│                            │ HTTP/REST + WebSocket                       │
│                            │ • livekit_client (^2.2.0)                   │
│                            │ • socket_io_client (^2.0.0)                 │
│                            │ • dio (^5.0.0)                              │
└────────────────────────────┼─────────────────────────────────────────────┘
                             │
                             ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       接入層 (Gateway Layer)                             │
│  ┌───────────────────────────────┐  ┌────────────────────────────────┐ │
│  │      API Gateway              │  │   WebSocket Server             │ │
│  │      (NestJS 10.x)            │  │   (NestJS + Socket.IO)         │ │
│  │      Port: 3000               │←─┼──→ Port: 3001                  │ │
│  │                               │  │                                │ │
│  │  - HTTP REST API              │  │  - 即時訊息                     │ │
│  │  - JWT 驗證                   │  │  - 來電通知 (incomingCall)     │ │
│  │  - 請求路由                   │  │  - 通話狀態廣播                 │ │
│  └───────────┬───────────────────┘  └──────────┬─────────────────────┘ │
└──────────────┼──────────────────────────────────┼───────────────────────┘
               │ gRPC                             │ gRPC
               ↓                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      業務邏輯層 (Service Layer)                          │
│                                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                        │
│  │User Service│  │Chat Service│  │File Service│                        │
│  │ (現有)     │  │ (現有)     │  │ (現有)     │                        │
│  │Port: 50052 │  │Port: 50053 │  │Port: 50055 │                        │
│  └────────────┘  └─────┬──────┘  └────────────┘                        │
│                        │                                                │
│  ┌────────────┐  ┌─────┴──────────────────────┐                        │
│  │Notification│  │     RTC Service (新增)      │                        │
│  │  Service   │←─┤      Port: 50058           │                        │
│  │  (現有)    │  │                            │                        │
│  │Port: 50056 │  │  使用最新 API:              │                        │
│  └────────────┘  │  • await token.toJwt()     │                        │
│                  │  • RoomServiceClient v2.x  │                        │
│                  │                            │                        │
│                  │  核心功能:                  │                        │
│                  │  • 房間管理                 │                        │
│                  │  • Token 生成 (async)      │                        │
│                  │  • 通話記錄 MongoDB        │                        │
│                  │  • 與 Chat Service 整合    │                        │
│                  │  • 推播通知觸發             │                        │
│                  └─────┬──────────────────────┘                        │
└────────────────────────┼─────────────────────────────────────────────────┘
                         │ gRPC/REST
                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      媒體處理層 (Media Layer)                            │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │              LiveKit Server (Go - latest)                 │           │
│  │              Port: 7880 (WebRTC/WebSocket)                │           │
│  │                                                           │           │
│  │  架構: SFU (Selective Forwarding Unit)                    │           │
│  │  • 媒體流路由與轉發                                        │           │
│  │  • 自適應碼率 (Adaptive Bitrate)                          │           │
│  │  • 參與者管理                                            │           │
│  │  • 支援 WebRTC + WHIP                                    │           │
│  └───────────────────────────┬──────────────────────────────┘           │
└────────────────────────────────┼────────────────────────────────────────┘
                                 │ UDP
                                 ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                       NAT 穿越層 (NAT Traversal)                        │
│  ┌──────────────────────────────────────────────────────────┐           │
│  │          Coturn (STUN/TURN Server - latest)              │           │
│  │          Port: 3478 (UDP/TCP)                            │           │
│  │                                                           │           │
│  │  職責:                                                     │           │
│  │  • STUN: 發現公網 IP (RFC 5389)                          │           │
│  │  • TURN: NAT 穿越中繼 (RFC 5766)                         │           │
│  │  • 確保 95%+ 連接成功率                                   │           │
│  │  • 支援 TLS/DTLS                                         │           │
│  └──────────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      資料持久層 (Data Layer)                             │
│  ┌────────────────┐         ┌──────────────┐                            │
│  │    MongoDB     │         │    MinIO     │                            │
│  │ (Replica Set)  │         │  (選配錄影)   │                            │
│  │    v8.0        │         │              │                            │
│  │                │         │  Buckets:    │                            │
│  │  Collections:  │         │  • recordings│                            │
│  │  • users       │         │  • thumbnails│                            │
│  │  • messages    │         │              │                            │
│  │  • calls (新)  │         │              │                            │
│  └────────────────┘         └──────────────┘                            │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 網路拓撲與端口映射

```
Docker Network: app-network (bridge)
├── API Gateway        → 3000:3000    (HTTP)
├── WebSocket Server   → 3001:3001    (WebSocket)
├── User Service       → exposed 50052 (gRPC)
├── Chat Service       → exposed 50053 (gRPC)
├── File Service       → exposed 50055 (gRPC)
├── Notification Svc   → exposed 50056 (gRPC)
├── RTC Service (新)   → exposed 50058 (gRPC)
├── LiveKit Server (新)→ 7880:7880    (WebRTC/WS)
│                      → 7881:7881    (HTTP API)
├── Coturn (新)        → 3478:3478    (UDP/TCP STUN)
│                      → 5349:5349    (TLS)
│                      → 49152-65535  (UDP relay)
├── MongoDB            → 27017:27017  (TCP)
└── MinIO              → 9000:9000, 9001:9001
```

---

## 3. 服務交互流程

### 3.1 發起通話完整流程 (1對1 視訊)

```
前端 A (發起者)                WebSocket Server              RTC Service                LiveKit Server
    │                                │                          │                            │
    │ 1. 點擊視訊通話按鈕              │                          │                            │
    ↓                                │                          │                            │
emit('startCall', {                 │                          │                            │
  conversationId: 'conv-123',       │                          │                            │
  calleeIds: ['userB'],             │                          │                            │
  callType: 'video'                 │                          │                            │
})───────────────────────────────→  │                          │                            │
                                    │                          │                            │
                                    │ 2. 驗證 JWT Token         │                            │
                                    │    提取 userId            │                            │
                                    │                          │                            │
                                    │ 3. gRPC: StartCall() ────→                            │
                                    │    {                      │                            │
                                    │      conversation_id,     │                            │
                                    │      caller_id,           │                            │
                                    │      callee_ids,          │                            │
                                    │      call_type: VIDEO     │                            │
                                    │    }                      │                            │
                                    │                          │                            │
                                    │                          │ 4a. 創建 LiveKit 房間       │
                                    │                          │ livekitService             │
                                    │                          │  .createRoom({             │
                                    │                          │    name: 'room-xxx',       │
                                    │                          │    emptyTimeout: 300,      │
                                    │                          │    maxParticipants: 20     │
                                    │                          │  })─────────────────────→   │
                                    │                          │                            │
                                    │                          │                 ← Room created
                                    │                          │                            │
                                    │                          │ 4b. 保存通話記錄            │
                                    │                          │ MongoDB.calls.insertOne({  │
                                    │                          │   callId, roomName,        │
                                    │                          │   status: 'initiating',    │
                                    │                          │   participants: [...]      │
                                    │                          │ })                         │
                                    │                          │                            │
                                    │                          │ 4c. (可選) 保存到聊天記錄   │
                                    │                          │ chatClient.saveMessage({   │
                                    │                          │   messageType: 'call_start'│
                                    │                          │ })                         │
                                    │                          │                            │
                                    │ ← {success, callId,      │                            │
                                    │    roomName}             │                            │
                                    │                          │                            │
                                    │ 5. gRPC: GenerateToken() →                            │
                                    │    {                      │                            │
                                    │      room_name,           │                            │
                                    │      user_id: 'userA',    │                            │
                                    │      username: 'Alice'    │                            │
                                    │    }                      │                            │
                                    │                          │                            │
                                    │                          │ 6. 生成 JWT Token          │
                                    │                          │ const at = new AccessToken(│
                                    │                          │   apiKey, apiSecret, {     │
                                    │                          │     identity: 'userA',     │
                                    │                          │     ttl: '10m'             │
                                    │                          │   }                        │
                                    │                          │ );                         │
                                    │                          │ at.addGrant({              │
                                    │                          │   roomJoin: true,          │
                                    │                          │   room: roomName,          │
                                    │                          │   canPublish: true,        │
                                    │                          │   canSubscribe: true       │
                                    │                          │ });                        │
                                    │                          │ ⚠️ v2.x 重要:               │
                                    │                          │ const token =              │
                                    │                          │   await at.toJwt();  ✅    │
                                    │                          │                            │
                                    │ ← {token, livekitUrl}    │                            │
                                    │                          │                            │
emit('callStarted') ←───────────────│                          │                            │
{                                   │                          │                            │
  callId,                           │                          │                            │
  roomName,                         │                          │                            │
  token,                            │                          │                            │
  livekitUrl: 'ws://livekit:7880'   │                          │                            │
}                                   │                          │                            │
    │                               │                          │                            │
    │ 7. 使用 LiveKit SDK 連接      │                          │                            │
    ↓                               │                          │                            │
const room = new Room();            │                          │                            │
await room.connect(                 │                          │                            │
  livekitUrl,                       │                          │                            │
  token                             │                          │                            │
);──────────────────────────────────────────────────────────────────────────→ WebRTC 握手
                                    │                          │                            │
                                    │ 8. 廣播來電通知給 User B  │                            │
                                    │ broadcastToUser('userB', │                            │
                                    │   'incomingCall', {      │                            │
                                    │     callId,              │                            │
                                    │     callerId: 'userA',   │                            │
                                    │     callerName: 'Alice', │                            │
                                    │     callType: 'video'    │                            │
                                    │   }                      │                            │
                                    │ )────────────────────┐   │                            │
                                    │                      │   │                            │
                                                           ↓   │                            │
                                                    前端 B (接收者)                          │
                                                           │   │                            │
                                                    on('incomingCall')                      │
                                                    顯示來電界面                              │
                                                           │   │                            │
                                                    [用戶點擊接聽]                            │
                                                           │   │                            │
                                                    emit('acceptCall', {                    │
                                                      callId,│                               │
                                                      roomName                              │
                                                    })───────┘                               │
                                                           │                                 │
                                                           │ 9. GenerateToken(userB)         │
                                                           │────→ RTC Service                │
                                                           │                                 │
                                                           │← token_B                        │
                                                           │                                 │
                                                    on('callAccepted')                      │
                                                    {token, livekitUrl}                     │
                                                           │                                 │
                                                    room.connect(url, token) ───────────────┘
                                                           │
                                                           ↓
                                            [WebRTC P2P 媒體流通過 LiveKit SFU]
```

### 3.2 gRPC 調用鏈詳細圖

```
┌──────────────┐
│API Gateway   │  HTTP POST /api/calls/start
│              │  Body: {conversationId, calleeIds, callType}
│              │  Header: Authorization: Bearer <JWT>
└──────┬───────┘
       │
       │ 1. JWT 驗證 → 提取 userId
       │
       │ 2. gRPC 調用
       │ ┌───────────────────────────────────────────────┐
       │ │ Service: rtc.RTCService                       │
       │ │ Method:  StartCall                            │
       │ │ Transport: gRPC (Port 50058)                  │
       │ │                                               │
       │ │ message StartCallRequest {                    │
       │ │   string conversation_id = 1;                 │
       │ │   string caller_id = 2;                       │
       │ │   repeated string callee_ids = 3;             │
       │ │   CallType call_type = 4; // VIDEO           │
       │ │ }                                             │
       │ └───────────────────────────────────────────────┘
       ↓
┌────────────────────────────────────────────────────┐
│ RTC Service (NestJS)                              │
│ Port: 50058                                       │
│                                                   │
│ @GrpcMethod('RTCService', 'StartCall')           │
│ async startCall(request: StartCallRequest) {     │
│                                                   │
│   // Step 1: 創建 LiveKit 房間                    │
│   const room = await this.livekitService         │
│     .createRoom(roomName, maxParticipants);      │
│                                                   │
│   // Step 2: 保存通話記錄                         │
│   const callRecord = await this.callRecordRepo   │
│     .create({                                    │
│       callId: uuid(),                            │
│       conversationId,                            │
│       roomName,                                  │
│       status: CallStatus.INITIATING,             │
│       participants: [...]                        │
│     });                                          │
│                                                   │
│   // Step 3: (可選) 呼叫 Chat Service             │
│   await this.chatClient.saveMessage({            │
│     messageType: 'call_start',                   │
│     content: '視訊通話已發起'                      │
│   });                                            │
│                                                   │
│   return {                                       │
│     success: true,                               │
│     call_id: callRecord.callId,                  │
│     room_name: roomName                          │
│   };                                             │
│ }                                                │
└────────┬───────────────────────────────────────────┘
         │
         │ 內部調用 LiveKit Service
         │
         ↓
┌────────────────────────────────────────────────────┐
│ LiveKitService (封裝 livekit-server-sdk v2.14.1)   │
│                                                    │
│ async createRoom(name: string, max: number) {     │
│   const room = await this.roomService.createRoom({│
│     name,                                         │
│     emptyTimeout: 300, // 5 分鐘                  │
│     maxParticipants: max                          │
│   });                                             │
│   return room;                                    │
│ }                                                 │
│                                                    │
│ async generateToken(                              │
│   roomName, identity, name, permissions           │
│ ): Promise<string> {                              │
│   const at = new AccessToken(                     │
│     this.apiKey,                                  │
│     this.apiSecret,                               │
│     {                                             │
│       identity,                                   │
│       name,                                       │
│       ttl: '10m'  // Token 10分鐘過期             │
│     }                                             │
│   );                                              │
│                                                    │
│   at.addGrant({                                   │
│     roomJoin: true,                               │
│     room: roomName,                               │
│     canPublish: permissions?.canPublish ?? true,  │
│     canSubscribe: permissions?.canSubscribe ?? true│
│   });                                             │
│                                                    │
│   // ⚠️ v2.x 重要：toJwt() 現在是異步方法          │
│   const token = await at.toJwt();  ✅             │
│                                                    │
│   return token;                                   │
│ }                                                 │
└────────┬───────────────────────────────────────────┘
         │
         │ gRPC/HTTP 調用
         ↓
┌────────────────────────────────────────────────────┐
│ LiveKit Server (Go)                                │
│ Port: 7880                                         │
│                                                    │
│ gRPC API: RoomService.CreateRoom()                 │
│ Response: Room { name, sid, creationTime, ... }    │
└────────────────────────────────────────────────────┘
```

### 3.3 WebSocket 事件流程圖

```
Client A                 WebSocket Server               RTC Service              Client B
  │                            │                            │                       │
  │ emit('startCall')         │                            │                       │
  │ {conversationId,          │                            │                       │
  │  calleeIds: ['B'],        │                            │                       │
  │  callType: 'video'}       │                            │                       │
  ├──────────────────────────→│                            │                       │
  │                           │                            │                       │
  │                           │ 驗證 JWT                    │                       │
  │                           │ 提取 userId                 │                       │
  │                           │                            │                       │
  │                           │ gRPC: StartCall() ─────────→                       │
  │                           │                            │                       │
  │                           │                            │ 創建房間 (LiveKit)     │
  │                           │                            │ 保存記錄 (MongoDB)     │
  │                           │                            │                       │
  │                           │ ←── {callId, roomName}     │                       │
  │                           │                            │                       │
  │                           │ gRPC: GenerateToken(A) ────→                       │
  │                           │                            │                       │
  │                           │ ←── {token_A, url}         │                       │
  │                           │                            │                       │
  │ on('callStarted')        │                            │                       │
  │ {callId, token, url}     │                            │                       │
  │←─────────────────────────│                            │                       │
  │                           │                            │                       │
  │ [連接 LiveKit]            │                            │                       │
  │ room.connect(url, token) │                            │                       │
  │                           │                            │                       │
  │                           │ broadcastToUser('B')       │                       │
  │                           │ event: 'incomingCall'      │                       │
  │                           │ data: {callId,             │                       │
  │                           │        callerId: 'A',      │                       │
  │                           │        callerName,         │                       │
  │                           │        callType}           │                       │
  │                           │─────────────────────────────────────────────────→ │
  │                           │                            │                       │
  │                           │                            │       on('incomingCall')
  │                           │                            │       顯示來電 UI      │
  │                           │                            │                       │
  │                           │                            │       [用戶點擊接聽]   │
  │                           │                            │                       │
  │                           │                            │       emit('acceptCall')
  │                           │                            │       {callId, roomName}
  │                           │←───────────────────────────────────────────────────│
  │                           │                            │                       │
  │                           │ gRPC: GenerateToken(B) ────→                       │
  │                           │                            │                       │
  │                           │ ←── {token_B, url}         │                       │
  │                           │                            │                       │
  │                           │                            │       on('callAccepted')
  │                           │                            │       {token, url}    │
  │                           │─────────────────────────────────────────────────→ │
  │                           │                            │                       │
  │ on('participantJoined')  │                            │       room.connect()  │
  │ {userId: 'B'}            │                            │                       │
  │←─────────────────────────│                            │                       │
  │                           │                            │                       │

  [雙方都連接到 LiveKit Server，開始 WebRTC 媒體流傳輸]

  A ←──────────────→ LiveKit Server (SFU) ←──────────────→ B
       媒體流 (RTP)                              媒體流 (RTP)
```

### 3.4 群組通話流程

```
User A              User B              User C
  │                   │                   │
  │ startCall()       │                   │
  │ calleeIds: [B,C]  │                   │
  ↓                   │                   │
[WebSocket]           │                   │
  │                   │                   │
  │ → RTC Service     │                   │
  │   創建房間         │                   │
  │                   │                   │
  │ ← callStarted     │                   │
  │   {token_A}       │                   │
  │                   │                   │
  │ broadcast ────────┼→ incomingCall     │
  │            ───────┼──────────────────→│ incomingCall
  │                   │                   │
  │                   │ acceptCall()      │
  │                   │    ↓              │
  │                   │ [生成 token_B]    │
  │                   │    ↓              │
  │ participantJoined │ ← callAccepted    │
  │ ←─────────────────│   {token_B}       │
  │                   │                   │
  │                   │                   │ acceptCall()
  │                   │                   │    ↓
  │                   │                   │ [生成 token_C]
  │                   │                   │    ↓
  │ participantJoined │ participantJoined │ ← callAccepted
  │ ←─────────────────┼───────────────────│   {token_C}
  │                   │                   │
  │                   │                   │
  ↓                   ↓                   ↓
┌──────────────────────────────────────────────┐
│         LiveKit Server (SFU)                 │
│                                              │
│    User A ──→ SFU ──→ User B                 │
│      ↑         ↓        ↑                    │
│      └─────────┼────────┘                    │
│                ↓                             │
│             User C                           │
│                                              │
│  每個用戶:                                    │
│  - 發布 1 路流到 SFU                          │
│  - 接收 N-1 路流 (N=參與者數)                 │
└──────────────────────────────────────────────┘
```

---

## 4. gRPC 接口設計

### 4.1 完整的 Proto 定義

```protobuf
syntax = "proto3";

package rtc;

// ========== RTC Service Definition ==========
service RTCService {
  // Room Management
  rpc CreateRoom(CreateRoomRequest) returns (CreateRoomResponse);
  rpc DeleteRoom(DeleteRoomRequest) returns (DeleteRoomResponse);
  rpc ListActiveRooms(ListActiveRoomsRequest) returns (ListActiveRoomsResponse);

  // Token Generation
  rpc GenerateToken(GenerateTokenRequest) returns (GenerateTokenResponse);

  // Call Management
  rpc StartCall(StartCallRequest) returns (StartCallResponse);
  rpc EndCall(EndCallRequest) returns (EndCallResponse);
  rpc GetCallStatus(GetCallStatusRequest) returns (GetCallStatusResponse);

  // Call History
  rpc GetCallHistory(GetCallHistoryRequest) returns (GetCallHistoryResponse);
  rpc GetCallDetails(GetCallDetailsRequest) returns (GetCallDetailsResponse);

  // Participant Management
  rpc GetRoomParticipants(GetRoomParticipantsRequest) returns (GetRoomParticipantsResponse);
  rpc KickParticipant(KickParticipantRequest) returns (KickParticipantResponse);
}

// ========== Enumerations ==========

enum CallType {
  AUDIO = 0;
  VIDEO = 1;
}

enum CallStatus {
  INITIATING = 0;   // Call is being initiated
  RINGING = 1;      // Ringing
  CONNECTED = 2;    // In call
  ENDED = 3;        // Call ended
  FAILED = 4;       // Call failed
  REJECTED = 5;     // Call rejected
  NO_ANSWER = 6;    // No answer
}

enum CallEndReason {
  NORMAL = 0;           // Normal hangup
  REJECTED = 1;         // Rejected by callee
  NO_ANSWER = 2;        // No answer timeout
  BUSY = 3;             // User busy
  CANCELLED = 4;        // Cancelled by caller
  NETWORK_ERROR = 5;    // Network error
  KICKED = 6;           // Kicked by moderator
}

enum ParticipantRole {
  CALLER = 0;     // Call initiator
  CALLEE = 1;     // Call receiver
  JOINED = 2;     // Joined mid-call
}

// ========== Room Management Messages ==========

message CreateRoomRequest {
  string conversation_id = 1;
  repeated string participant_ids = 2;
  CallType call_type = 3;
  int32 max_participants = 4;  // Default: 20
}

message CreateRoomResponse {
  bool success = 1;
  string room_id = 2;
  string room_name = 3;
  string call_id = 4;
  string message = 5;
}

message DeleteRoomRequest {
  string room_name = 1;
}

message DeleteRoomResponse {
  bool success = 1;
  string message = 2;
}

message ListActiveRoomsRequest {
  optional int32 limit = 1;
  optional int32 offset = 2;
}

message ListActiveRoomsResponse {
  repeated RoomInfo rooms = 1;
  int32 total_count = 2;
}

message RoomInfo {
  string name = 1;
  string sid = 2;
  int32 num_participants = 3;
  int64 creation_time = 4;
  int32 max_participants = 5;
}

// ========== Token Generation Messages ==========

message GenerateTokenRequest {
  string room_name = 1;
  string user_id = 2;
  string username = 3;
  optional TokenPermissions permissions = 4;
}

message TokenPermissions {
  bool can_publish = 1;        // Can publish audio/video
  bool can_subscribe = 2;      // Can subscribe to audio/video
  bool can_publish_data = 3;   // Can publish data
  bool hidden = 4;             // Hidden participant
}

message GenerateTokenResponse {
  bool success = 1;
  string token = 2;
  string livekit_url = 3;
  int64 expires_at = 4;  // Unix timestamp
  string message = 5;
}

// ========== Call Management Messages ==========

message StartCallRequest {
  string conversation_id = 1;
  string caller_id = 2;
  repeated string callee_ids = 3;
  CallType call_type = 4;
}

message StartCallResponse {
  bool success = 1;
  string call_id = 2;
  string room_name = 3;
  string message = 4;
}

message EndCallRequest {
  string call_id = 1;
  string user_id = 2;
  optional int32 duration_seconds = 3;
  optional CallEndReason end_reason = 4;
}

message EndCallResponse {
  bool success = 1;
  string message = 2;
  CallRecord call_record = 3;
}

message GetCallStatusRequest {
  string call_id = 1;
}

message GetCallStatusResponse {
  bool active = 1;
  CallStatus status = 2;
  int32 participant_count = 3;
  int64 started_at = 4;
  optional int32 duration_seconds = 5;
  string room_name = 6;
}

// ========== Call History Messages ==========

message GetCallHistoryRequest {
  string user_id = 1;
  optional string conversation_id = 2;
  int32 limit = 3;
  int32 offset = 4;
}

message GetCallHistoryResponse {
  repeated CallRecord calls = 1;
  int32 total_count = 2;
}

message GetCallDetailsRequest {
  string call_id = 1;
}

message GetCallDetailsResponse {
  bool success = 1;
  CallRecord call = 2;
  string message = 3;
}

// ========== Participant Management Messages ==========

message GetRoomParticipantsRequest {
  string room_name = 1;
}

message GetRoomParticipantsResponse {
  repeated ParticipantInfo participants = 1;
  int32 count = 2;
}

message ParticipantInfo {
  string identity = 1;
  string name = 2;
  string sid = 3;
  bool is_publisher = 4;
  int64 joined_at = 5;
  optional string metadata = 6;
}

message KickParticipantRequest {
  string room_name = 1;
  string participant_identity = 2;
  string operator_id = 3;
}

message KickParticipantResponse {
  bool success = 1;
  string message = 2;
}

// ========== Data Structures ==========

message CallRecord {
  string id = 1;
  string conversation_id = 2;
  string room_name = 3;
  CallType call_type = 4;
  CallStatus status = 5;
  repeated CallParticipant participants = 6;
  int64 started_at = 7;
  optional int64 ended_at = 8;
  optional int32 duration_seconds = 9;
  optional CallEndReason end_reason = 10;
  string initiated_by = 11;
  int64 created_at = 12;
  int64 updated_at = 13;
}

message CallParticipant {
  string user_id = 1;
  string username = 2;
  int64 joined_at = 3;
  optional int64 left_at = 4;
  optional int32 duration_seconds = 5;
  ParticipantRole role = 6;
}
```

### 4.2 服務間 gRPC 調用關係

```
┌─────────────────────────────────────────────────────┐
│           API Gateway (gRPC Client)                 │
│                                                     │
│  調用:                                               │
│  • RTCService.StartCall()                          │
│  • RTCService.GenerateToken()                      │
│  • RTCService.EndCall()                            │
│  • RTCService.GetCallHistory()                     │
└───────────────────┬─────────────────────────────────┘
                    │
                    ↓
┌─────────────────────────────────────────────────────┐
│         WebSocket Server (gRPC Client)              │
│                                                     │
│  調用:                                               │
│  • RTCService.StartCall()                          │
│  • RTCService.GenerateToken()                      │
│  • RTCService.EndCall()                            │
└───────────────────┬─────────────────────────────────┘
                    │
                    ↓
┌──────────────────────────────────────────────────────────────┐
│                  RTC Service (gRPC Server)                   │
│                  實現 RTCService 所有方法                     │
│                                                              │
│  同時作為 gRPC Client 調用:                                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Chat Service (Port: 50053)                          │   │
│  │ • SaveMessage()  - 保存通話訊息到對話                 │   │
│  │ • GetConversationDetails()  - 獲取對話資訊           │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ User Service (Port: 50052)                           │   │
│  │ • GetUserInfo()  - 獲取用戶資訊用於生成 Token         │   │
│  │ • BatchGetUsers()  - 批次獲取參與者資訊               │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Notification Service (Port: 50056)                   │   │
│  │ • SendCallNotification()  - 來電推播(離線用戶)        │   │
│  │ • SendMissedCallNotification()  - 未接來電通知       │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### 4.3 關鍵 gRPC 請求/響應範例

#### StartCall Request/Response
```protobuf
// Request
{
  conversation_id: "conv-abc123",
  caller_id: "user-001",
  callee_ids: ["user-002", "user-003"],
  call_type: VIDEO  // enum: AUDIO(0) or VIDEO(1)
}

// Response
{
  success: true,
  call_id: "call-xyz789",
  room_name: "room-conv-abc123-1234567890",
  message: "通話已創建"
}
```

#### GenerateToken Request/Response
```protobuf
// Request
{
  room_name: "room-conv-abc123-1234567890",
  user_id: "user-001",
  username: "Alice",
  permissions: {
    can_publish: true,
    can_subscribe: true,
    can_publish_data: true,
    hidden: false
  }
}

// Response
{
  success: true,
  token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  livekit_url: "ws://livekit-server:7880",
  expires_at: 1672531200  // Unix timestamp
}
```

---

## 5. 詳細實施計劃

### Phase 1: 基礎建設 (週 1-2)

#### 週 1: Proto 定義 + RTC Service 骨架

**Day 1-2: Proto 定義**
- 創建 `services/protos/rtc.proto`
- 定義所有 Service 方法 (11 個 RPC)
- 定義所有 Message 類型 (30+ messages)
- 定義 Enum (CallType, CallStatus, CallEndReason, ParticipantRole)

**Day 3-4: 初始化 RTC Service**
```bash
cd services/
nest new rtc-service
cd rtc-service

# 安裝依賴 (最新版本 2025-11-18)
pnpm add livekit-server-sdk@^2.14.1
pnpm add @grpc/grpc-js@^1.11.0
pnpm add @grpc/proto-loader@^0.7.13
pnpm add @nestjs/microservices@^10.0.0
pnpm add mongoose@^8.0.0
pnpm add @nestjs/mongoose@^10.0.0
pnpm add @nestjs/config@^3.0.0
pnpm add uuid
```

**目錄結構：**
```
services/rtc-service/
├── src/
│   ├── main.ts                      # gRPC 服務器啟動
│   ├── app.module.ts
│   ├── rtc/
│   │   ├── rtc.module.ts
│   │   ├── rtc.controller.ts        # gRPC Controller
│   │   └── rtc.service.ts           # 業務邏輯
│   ├── livekit/
│   │   ├── livekit.module.ts
│   │   ├── livekit.service.ts       # LiveKit SDK 封裝
│   │   └── livekit.config.ts
│   ├── call-record/
│   │   ├── call-record.module.ts
│   │   ├── call-record.service.ts
│   │   └── schemas/
│   │       └── call-record.schema.ts
│   └── grpc-clients/
│       ├── chat-client.module.ts
│       ├── chat-client.service.ts
│       └── user-client.service.ts
├── Dockerfile
├── package.json
└── tsconfig.json
```

**Day 5: 實作 LiveKitService (使用最新 v2.14.1 API)**

關鍵代碼：
```typescript
import { Injectable, Logger } from '@nestjs/common';
import {
  RoomServiceClient,
  AccessToken,
  Room,
} from 'livekit-server-sdk';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private roomService: RoomServiceClient;
  private apiKey: string;
  private apiSecret: string;
  private livekitUrl: string;

  constructor(private configService: ConfigService) {
    this.apiKey = this.configService.get<string>('LIVEKIT_API_KEY');
    this.apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');
    this.livekitUrl = this.configService.get<string>('LIVEKIT_URL');

    this.roomService = new RoomServiceClient(
      this.livekitUrl,
      this.apiKey,
      this.apiSecret,
    );

    this.logger.log('✅ LiveKit Service initialized with SDK v2.14.1');
  }

  /**
   * 創建房間
   */
  async createRoom(
    roomName: string,
    maxParticipants: number = 20,
  ): Promise<Room> {
    try {
      const room = await this.roomService.createRoom({
        name: roomName,
        emptyTimeout: 5 * 60, // 5 分鐘無人自動關閉
        maxParticipants,
      });

      this.logger.log(`✅ Room created: ${roomName}`);
      return room;
    } catch (error) {
      this.logger.error(`❌ Failed to create room ${roomName}:`, error);
      throw error;
    }
  }

  /**
   * 生成 Access Token (v2.x - 異步方法)
   * ⚠️ 重要：toJwt() 在 v2.x 是異步的，必須 await
   */
  async generateToken(
    roomName: string,
    participantIdentity: string,
    participantName: string,
    permissions?: {
      canPublish?: boolean;
      canSubscribe?: boolean;
      canPublishData?: boolean;
      hidden?: boolean;
    },
  ): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity: participantIdentity,
      name: participantName,
      ttl: '10m', // Token 10 分鐘過期
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: permissions?.canPublish ?? true,
      canSubscribe: permissions?.canSubscribe ?? true,
      canPublishData: permissions?.canPublishData ?? true,
      hidden: permissions?.hidden ?? false,
    });

    // ⚠️ v2.x 重要變更：toJwt() 現在是異步方法
    const token = await at.toJwt();  // ✅ 必須 await

    this.logger.log(
      `✅ Token generated for ${participantName} (${participantIdentity}) in room ${roomName}`,
    );

    return token;
  }

  // ... 其他方法 (deleteRoom, listRooms, getParticipants, removeParticipant)
}
```

#### 週 2: Docker 配置

**docker-compose.registry.yml 更新：**
```yaml
services:
  # ... 現有服務 ...

  # LiveKit Server
  livekit-server:
    image: livekit/livekit-server:latest
    container_name: livekit-server
    ports:
      - "7880:7880"   # WebRTC/WebSocket
      - "7881:7881"   # HTTP API (可選)
    volumes:
      - ./config/livekit.yaml:/etc/livekit.yaml:ro
    environment:
      - LIVEKIT_CONFIG=/etc/livekit.yaml
    networks:
      - app-network
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:7880/"]
      interval: 10s
      timeout: 5s
      retries: 3
    init: true

  # Coturn (STUN/TURN Server)
  coturn:
    image: coturn/coturn:latest
    container_name: coturn
    ports:
      - "3478:3478/udp"
      - "3478:3478/tcp"
      - "5349:5349/tcp"  # TURNS
      - "49152-65535:49152-65535/udp"  # TURN relay
    volumes:
      - ./config/turnserver.conf:/etc/coturn/turnserver.conf:ro
    networks:
      - app-network
    restart: unless-stopped
    init: true

  # RTC Service
  rtc-service:
    image: localhost:5000/im_services-rtc-service:latest
    container_name: rtc-service
    expose:
      - "${RTC_SERVICE_PORT}"
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - RTC_SERVICE_PORT=${RTC_SERVICE_PORT}
      - MONGODB_URI=${MONGODB_URI}
      - LIVEKIT_HOST=livekit-server
      - LIVEKIT_API_KEY=${LIVEKIT_API_KEY}
      - LIVEKIT_API_SECRET=${LIVEKIT_API_SECRET}
      - LIVEKIT_URL=ws://livekit-server:7880
      - CHAT_SERVICE_URL=${CHAT_SERVICE_URL}
      - CHAT_SERVICE_PORT=${CHAT_SERVICE_PORT}
      - USER_SERVICE_URL=${USER_SERVICE_URL}
      - USER_SERVICE_PORT=${USER_SERVICE_PORT}
      - NOTIFICATION_SERVICE_URL=${NOTIFICATION_SERVICE_URL}
      - NOTIFICATION_SERVICE_PORT=${NOTIFICATION_SERVICE_PORT}
      - HTTP_PROXY=${HTTP_PROXY}
      - HTTPS_PROXY=${HTTPS_PROXY}
      - NO_PROXY=${NO_PROXY}
      - TZ=${TZ}
      - GRPC_ONLY=${GRPC_ONLY}
    depends_on:
      - mongodb
      - mongodb-init
      - livekit-server
      - chat-service
      - user-service
    networks:
      - app-network
    init: true
```

**配置文件：**

`config/livekit.yaml`:
```yaml
port: 7880
bind_addresses:
  - "0.0.0.0"

rtc:
  port_range_start: 50000
  port_range_end: 60000
  use_external_ip: true
  tcp_port: 7881

keys:
  # 從環境變量讀取
  APIKEYY123: APISECRETXXX

turn:
  enabled: true
  domain: coturn
  tls_port: 5349
  udp_port: 3478

room:
  auto_create: true
  empty_timeout: 300  # 5 分鐘
  max_participants: 100
  departure_timeout: 20

logging:
  level: info
  sample: true
```

`config/turnserver.conf`:
```conf
listening-port=3478
tls-listening-port=5349

# 外部 IP（需配置實際 IP）
external-ip=YOUR_SERVER_PUBLIC_IP

realm=yourdomain.com
server-name=coturn

# 認證模式
lt-cred-mech
user=turnuser:turnpassword

# 安全選項
no-tlsv1
no-tlsv1_1
no-stdout-log

# Relay 端口範圍
min-port=49152
max-port=65535

fingerprint
verbose
```

**環境變量 (.env.prod):**
```bash
# ========== RTC Service ==========
RTC_SERVICE_URL=rtc-service
RTC_SERVICE_PORT=50058

# ========== LiveKit ==========
LIVEKIT_HOST=livekit-server
LIVEKIT_API_KEY=APIxxxxxxxxxxxxx
LIVEKIT_API_SECRET=secretxxxxxxxxxxxxx
LIVEKIT_URL=ws://livekit-server:7880

# ========== Coturn ==========
TURN_SERVER_URL=turn:YOUR_SERVER_IP:3478
TURN_USERNAME=turnuser
TURN_PASSWORD=strong_password_here
TURN_REALM=yourdomain.com
```

### Phase 2: WebSocket 協議擴展 (週 3)

**新增 WebSocket 事件：**
- `startCall` - 發起通話
- `acceptCall` - 接聽通話
- `rejectCall` - 拒絕通話
- `endCall` - 結束通話
- `incomingCall` - 來電通知（伺服器廣播）
- `callStarted` - 通話已開始（伺服器回應）
- `callAccepted` - 通話已接聽（伺服器回應）
- `callEnded` - 通話已結束（伺服器廣播）
- `participantJoined` - 參與者加入（伺服器廣播）
- `participantLeft` - 參與者離開（伺服器廣播）

**關鍵實作：**
1. 在 `websocket-server` 創建 `rtc-client.service.ts` (gRPC Client)
2. 擴展 `websocket.gateway.ts` 添加通話事件處理
3. 整合 Notification Service 發送離線推播

### Phase 3: API Gateway 端點 (週 4)

**重要架構決策：通話操作只通過 WebSocket**

API Gateway **不提供**通話操作端點（startCall、acceptCall、endCall），這些都通過 WebSocket 處理。

**新增 HTTP REST API（只提供查詢功能）：**
- `GET /api/calls/history` - 查詢通話記錄
- `GET /api/calls/:callId` - 查詢通話詳情
- `GET /api/calls/:callId/status` - 查詢通話狀態

**為什麼不用 HTTP 發起通話？**
1. 通話需要即時雙向通訊（來電通知、狀態更新）
2. WebSocket 已連接，直接使用更高效
3. 避免兩套邏輯，降低複雜度
4. 前端必須連接 WebSocket 才能接收來電

### Phase 4: 1對1 通話實現 (週 5-6)

#### 週 5: 後端 + 語音通話

**後端任務：**
- [ ] 完善 RTC Service 業務邏輯
- [ ] 通話狀態管理
- [ ] 超時處理（30 秒無人接聽自動結束）
- [ ] 通話記錄保存到 MongoDB

**Flutter 前端任務：**
- [ ] 環境設置和依賴安裝
  ```bash
  flutter pub add livekit_client
  flutter pub add socket_io_client
  flutter pub add permission_handler
  flutter pub add flutter_riverpod
  ```
- [ ] 創建 `CallService`（封裝 LiveKit + WebSocket）
- [ ] 實作權限請求（麥克風）
- [ ] 實作語音通話 UI
  - 來電界面（IncomingCallDialog）
  - 通話中界面（靜音、掛斷按鈕）
  - 通話計時器
- [ ] 測試：iOS 模擬器 ↔ Android 模擬器 1對1 語音通話

#### 週 6: 視訊通話

**後端任務：**
- [ ] 視訊通話記錄完善
- [ ] 錯誤處理優化

**Flutter 前端任務：**
- [ ] 攝像頭權限處理
- [ ] 實作 `VideoCallScreen` Widget
  - 本地視訊預覽（小窗口）
  - 遠端視訊渲染（全螢幕）
  - 控制按鈕（靜音、關閉視訊、切換攝像頭、掛斷）
- [ ] 實作視訊流發布/訂閱
  ```dart
  await room.localParticipant?.setCameraEnabled(true);
  ```
- [ ] 平台特定配置
  - iOS: Info.plist 權限描述
  - Android: AndroidManifest.xml 權限
- [ ] UI 優化
  - 全螢幕沉浸式體驗
  - 網路品質指示器
  - 重連邏輯
- [ ] 測試：真實設備測試（iOS + Android）
- [ ] 測試：網路切換測試（WiFi ↔ 4G）

### Phase 5: 群組通話實現 (週 7-8)

#### 週 7: 後端群組通話邏輯

**後端任務：**
- [ ] StartCall 支援多個 calleeIds
- [ ] 批次發送來電通知（在線 + 離線）
- [ ] 處理部分接聽場景
- [ ] 參與者動態加入/離開邏輯
- [ ] 中途邀請新成員功能

#### 週 8: Flutter 群組 UI

**Flutter 前端任務：**
- [ ] 實作網格佈局視訊渲染
  ```dart
  GridView.builder(
    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
      crossAxisCount: participantCount <= 4 ? 2 : 3,
    ),
    itemBuilder: (context, index) {
      return VideoTrackRenderer(remoteVideos[index]);
    },
  )
  ```
- [ ] 參與者列表 UI
  - 顯示所有參與者
  - 靜音狀態指示
  - 網路品質指示
- [ ] 邀請更多成員按鈕
- [ ] Active Speaker 高亮顯示
- [ ] 測試：3-5 人視訊會議
- [ ] 測試：動態加入/離開場景

### Phase 6: 推播通知整合 (週 9)

#### 後端任務
- [ ] 擴展 Notification Service proto
  - 新增 `SendCallNotification` RPC
  - 新增 `SendMissedCallNotification` RPC
- [ ] 實作 FCM 來電通知格式
- [ ] 實作 APNs VoIP Push 通知
- [ ] 未接來電記錄邏輯

#### Flutter iOS 任務（CallKit 整合）
- [ ] 添加 CallKit 依賴
  ```yaml
  # pubspec.yaml
  dependencies:
    flutter_callkit_incoming: ^2.0.0
  ```
- [ ] 配置 CallKit
  ```dart
  // 顯示原生來電界面
  await FlutterCallkitIncoming.showCallkitIncoming(...);
  ```
- [ ] 處理 CallKit 事件
  - 接聽 → 觸發 `acceptCall` WebSocket 事件
  - 拒接 → 觸發 `rejectCall` WebSocket 事件
- [ ] 鎖屏來電顯示
- [ ] 測試：推播 → 鎖屏顯示 → 接聽流程

#### Flutter Android 任務（ConnectionService 整合）
- [ ] 添加 ConnectionService 依賴
  ```yaml
  dependencies:
    flutter_callkeep: ^0.3.0
  ```
- [ ] 實作全螢幕來電 Activity
- [ ] 處理來電事件
- [ ] 測試：推播 → 全螢幕來電 → 接聽流程

#### 通用任務
- [ ] 未接來電通知處理
- [ ] 點擊推播跳轉到對話
- [ ] 測試：離線 → 來電推播 → 開啟 App → 自動跳轉

### Phase 7: 進階功能 (週 10-12，選配)

#### 週 10: 螢幕分享

**後端任務：**
- [ ] LiveKit Server 配置螢幕分享支援
- [ ] Token 權限擴展（canPublishScreen）

**Flutter 前端任務：**
- [ ] 實作螢幕分享功能
  ```dart
  await room.localParticipant?.setScreenShareEnabled(true);
  ```
- [ ] 螢幕分享 UI 切換
- [ ] 顯示正在分享螢幕的參與者
- [ ] 測試：iOS/Android/Web 螢幕分享

#### 週 11: 通話錄影（可選）

**後端任務：**
- [ ] LiveKit Egress 整合
- [ ] 錄影文件存儲到 MinIO
- [ ] 錄影文件管理 API

**Flutter 前端任務：**
- [ ] 錄影按鈕 UI
- [ ] 錄影狀態指示
- [ ] 錄影回放功能

#### 週 12: 統計與優化

**後端任務：**
- [ ] Prometheus metrics 暴露
- [ ] Grafana 儀表板配置
- [ ] 通話品質監控

**Flutter 前端任務：**
- [ ] 網路品質即時顯示
- [ ] 性能優化
  - 記憶體使用優化
  - 電池消耗優化
  - 背景執行優化
- [ ] UI/UX 打磨
  - 動畫效果
  - 載入狀態
  - 錯誤提示優化

---

## 6. 資料庫設計

### 6.1 MongoDB Collection: `calls`

```typescript
// CallRecord Schema
{
  _id: ObjectId,
  callId: string,                    // 唯一通話 ID
  conversationId: string,            // 關聯的對話 ID
  roomName: string,                  // LiveKit 房間名稱

  callType: 'audio' | 'video',       // 通話類型
  status: 'initiating' | 'ringing' | 'connected' | 'ended' | 'failed' | 'rejected' | 'no_answer',

  participants: [
    {
      userId: string,
      username: string,
      role: 'caller' | 'callee' | 'joined',
      joinedAt: Date,
      leftAt?: Date,
      durationSeconds?: number
    }
  ],

  initiatedBy: string,               // 發起者 userId
  startedAt: Date,
  endedAt?: Date,
  durationSeconds?: number,
  endReason?: 'normal' | 'rejected' | 'no_answer' | 'busy' | 'cancelled' | 'network_error' | 'kicked',

  metadata: {
    quality?: {                      // 通話品質統計 (可選)
      avgLatency: number,
      avgPacketLoss: number
    },
    recordingUrl?: string            // 錄影 URL (如果有)
  },

  createdAt: Date,
  updatedAt: Date
}

// 索引
db.calls.createIndex({ callId: 1 }, { unique: true })
db.calls.createIndex({ conversationId: 1, createdAt: -1 })
db.calls.createIndex({ "participants.userId": 1, createdAt: -1 })
db.calls.createIndex({ status: 1, startedAt: -1 })
```

### 6.2 與現有 Collection 的關係

```
conversations (現有)
     │
     │ conversationId
     ↓
   calls (新)
     │
     │ callId
     ↓
  messages (現有，可選)
  {
    messageType: 'call_start' | 'call_end',
    content: '通話時長 5 分 23 秒',
    metadata: { callId: '...' }
  }
```

---

## 7. 時程與里程碑

### 7.1 甘特圖

```
週次  │ 1  │ 2  │ 3  │ 4  │ 5  │ 6  │ 7  │ 8  │ 9  │ 10 │ 11 │ 12 │
─────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
Phase│████│████│    │    │    │    │    │    │    │    │    │    │ Proto + RTC Service
  1  │    │████│████│    │    │    │    │    │    │    │    │    │ Docker 配置
─────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
Phase│    │    │████│    │    │    │    │    │    │    │    │    │ WebSocket 擴展
  2  │    │    │    │    │    │    │    │    │    │    │    │    │
─────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
Phase│    │    │    │████│    │    │    │    │    │    │    │    │ API Gateway
  3  │    │    │    │    │    │    │    │    │    │    │    │    │
─────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
Phase│    │    │    │    │████│████│    │    │    │    │    │    │ 1對1 通話
  4  │    │    │    │    │    │    │    │    │    │    │    │    │
─────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
Phase│    │    │    │    │    │    │████│████│    │    │    │    │ 群組通話
  5  │    │    │    │    │    │    │    │    │    │    │    │    │
─────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
Phase│    │    │    │    │    │    │    │    │████│    │    │    │ 推播通知
  6  │    │    │    │    │    │    │    │    │    │    │    │    │
─────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┼────┤
Phase│    │    │    │    │    │    │    │    │    │████│████│████│ 進階功能 (選配)
  7  │    │    │    │    │    │    │    │    │    │    │    │    │
─────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
      ↑         ↑              ↑              ↑         ↑              ↑
      M1        M2             M3             M4        M5             M6

M1: 基礎設施就緒
M2: Docker 環境完整
M3: WebSocket + API 可用
M4: 1對1 通話 MVP
M5: 群組通話完成
M6: 生產就緒
```

### 7.2 里程碑

| 里程碑 | 週次 | 交付成果 | 驗收標準 |
|--------|------|---------|---------|
| **M1** | Week 2 | 基礎設施就緒 | LiveKit Server 運行、RTC Service gRPC 可調用 |
| **M2** | Week 3 | WebSocket 整合 | 通話事件可觸發，推播通知發送成功 |
| **M3** | Week 4 | API 端點完成 | HTTP API 可用，Swagger 文檔完整 |
| **M4** | Week 6 | 1對1 通話 MVP | 語音/視訊通話穩定，通話記錄保存 |
| **M5** | Week 8 | 群組通話完成 | 支援 5+ 人會議，動態加入/離開 |
| **M6** | Week 9 | 生產就緒 | 推播通知可用，監控儀表板建立 |

---

## 8. 風險評估與緩解

### 8.1 技術風險

| 風險 | 機率 | 影響 | 緩解措施 |
|------|------|------|---------|
| **NAT 穿越失敗** | 中 | 高 | • 部署可靠的 Coturn TURN 服務器<br>• 配置多個 STUN/TURN 備援<br>• 監控連接成功率 |
| **LiveKit 學習曲線** | 低 | 中 | • 文檔完善，社群活躍<br>• 參考官方範例<br>• 預留學習時間 |
| **gRPC 整合複雜度** | 低 | 中 | • 使用成熟的 @grpc/grpc-js<br>• 參考現有服務實作 |
| **WebSocket 事件衝突** | 低 | 低 | • 清晰的事件命名規範<br>• 文檔化所有事件 |
| **MongoDB 性能** | 低 | 中 | • 正確建立索引<br>• 通話記錄定期歸檔 |
| **服務器資源不足** | 中 | 高 | • 性能測試<br>• 水平擴展方案<br>• 負載均衡 |

### 8.2 專案風險

| 風險 | 機率 | 影響 | 緩解措施 |
|------|------|------|---------|
| **時程延誤** | 中 | 中 | • 每週檢視進度<br>• 優先完成 MVP<br>• 進階功能可延後 |
| **需求變更** | 中 | 中 | • Phase 1-4 為核心需求<br>• Phase 5-7 可調整 |
| **測試不足** | 中 | 高 | • 每個 Phase 都包含測試<br>• 建立自動化測試 |
| **文檔不完整** | 中 | 中 | • 隨開發同步更新文檔<br>• Code Review 時檢查 |

### 8.3 營運風險

| 風險 | 機率 | 影響 | 緩解措施 |
|------|------|------|---------|
| **通話品質問題** | 中 | 高 | • 網路品質監控<br>• 自適應碼率<br>• 降級方案 (音訊 only) |
| **高峰期負載** | 中 | 高 | • 容量規劃<br>• 自動擴展<br>• 限流機制 |
| **安全性漏洞** | 低 | 高 | • JWT Token 短期有效<br>• HTTPS/WSS 加密<br>• 定期安全審計 |

---

## 9. 成功指標

### 9.1 技術指標

| 指標 | 目標值 | 測量方式 |
|------|--------|---------|
| **連接成功率** | ≥ 95% | (成功連接數 / 總嘗試數) × 100% |
| **通話建立時間** | ≤ 3 秒 | 從點擊到對方響鈴的時間 |
| **音訊延遲** | ≤ 300ms | LiveKit 統計 API |
| **視訊延遲** | ≤ 500ms | LiveKit 統計 API |
| **服務可用性** | ≥ 99.5% | 監控系統 Uptime |
| **API 響應時間** | ≤ 200ms | P95 latency |

### 9.2 功能指標

| 功能 | 驗收標準 |
|------|---------|
| **1對1 語音** | 2 用戶可穩定通話 10 分鐘以上 |
| **1對1 視訊** | 2 用戶視訊清晰，無明顯卡頓 |
| **群組通話** | 支援 10 人同時通話，品質穩定 |
| **來電通知** | 在線用戶 100% 收到，離線用戶推播送達率 ≥ 98% |
| **通話記錄** | 100% 記錄保存，查詢正確 |
| **NAT 穿越** | TURN 服務器可處理 ≥ 90% 困難場景 |

### 9.3 專案指標

| 指標 | 目標 |
|------|------|
| **MVP 交付時間** | ≤ 6 週 |
| **完整功能交付** | ≤ 9 週 (不含進階功能) |
| **程式碼覆蓋率** | ≥ 70% |
| **文檔完整度** | 100% (所有 API 都有文檔) |
| **Bug 數量** | 嚴重 Bug = 0, 中等 Bug ≤ 3 |

---

## 10. 附錄

### 10.1 環境變量清單

```bash
# ========== RTC Service ==========
RTC_SERVICE_URL=rtc-service
RTC_SERVICE_PORT=50058
NODE_ENV=production
MONGODB_URI=mongodb://username:password@mongodb:27017/imdb?authSource=admin

# ========== LiveKit ==========
LIVEKIT_HOST=livekit-server
LIVEKIT_API_KEY=APIxxxxxxxxx
LIVEKIT_API_SECRET=secretxxxxxxxxxxxxxxxxxx
LIVEKIT_URL=ws://livekit-server:7880

# ========== Coturn ==========
TURN_SERVER_URL=turn:YOUR_SERVER_IP:3478
TURN_USERNAME=turnuser
TURN_PASSWORD=strong_password_here
TURN_REALM=yourdomain.com

# ========== 其他 ==========
CHAT_SERVICE_URL=chat-service
CHAT_SERVICE_PORT=50053
USER_SERVICE_URL=user-service
USER_SERVICE_PORT=50052
NOTIFICATION_SERVICE_URL=notification-service
NOTIFICATION_SERVICE_PORT=50056
```

### 10.2 端口分配表

| 服務 | 端口 | 協議 | 用途 |
|------|------|------|------|
| API Gateway | 3000 | HTTP | REST API |
| WebSocket Server | 3001 | WebSocket | 即時通訊 |
| User Service | 50052 | gRPC | 用戶管理 |
| Chat Service | 50053 | gRPC | 聊天服務 |
| File Service | 50055 | gRPC | 文件服務 |
| Notification Service | 50056 | gRPC | 推播通知 |
| **RTC Service** | **50058** | **gRPC** | **通話管理** |
| **LiveKit Server** | **7880** | **WebRTC/WS** | **媒體服務** |
| **Coturn STUN** | **3478** | **UDP/TCP** | **NAT 發現** |
| Coturn TURN | 49160-49200 | UDP | NAT 中繼（開發環境刻意縮小範圍） |
| MongoDB | 27017 | TCP | 資料庫 |
| MinIO | 9000 | HTTP | 物件儲存 |

### 10.3 關鍵依賴版本（2025-11-18 最新）

#### 後端依賴 (package.json)
```json
{
  "dependencies": {
    "livekit-server-sdk": "^2.14.1",
    "@nestjs/core": "^10.0.0",
    "@nestjs/microservices": "^10.0.0",
    "@grpc/grpc-js": "^1.11.0",
    "@grpc/proto-loader": "^0.7.13",
    "socket.io": "^4.7.0",
    "mongoose": "^8.0.0",
    "uuid": "^10.0.0"
  }
}
```

#### Flutter 依賴 (pubspec.yaml)
```yaml
dependencies:
  flutter:
    sdk: flutter

  # LiveKit Flutter SDK
  livekit_client: ^2.2.0

  # WebSocket 客戶端
  socket_io_client: ^2.0.0

  # HTTP 請求
  dio: ^5.0.0

  # 狀態管理
  flutter_riverpod: ^2.4.0

  # 權限管理
  permission_handler: ^11.0.0

  # 來電整合
  flutter_callkit_incoming: ^2.0.0  # iOS CallKit
  flutter_callkeep: ^0.3.0          # Android ConnectionService

  # 工具
  uuid: ^4.0.0
  intl: ^0.18.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0
```

### 10.4 LiveKit v2.x 遷移檢查清單

如果您之前使用過 v1.x，請確保：

- [ ] 所有 `toJWT()` 改為 `await toJwt()`
- [ ] 所有 `verify()` 改為 `await verify()`
- [ ] Webhook `receiver.receive()` 改為 `await receiver.receive()`
- [ ] Egress 請求使用類（Class）而非接口
- [ ] 更新 package.json 依賴版本

### 10.5 測試 Token 生成（驗證 v2.x API）

```typescript
// test-token.ts (後端測試)
import { AccessToken } from 'livekit-server-sdk';

async function testTokenGeneration() {
  const apiKey = 'your-api-key';
  const apiSecret = 'your-api-secret';

  const at = new AccessToken(apiKey, apiSecret, {
    identity: 'test-user',
    name: 'Test User',
    ttl: '10m',
  });

  at.addGrant({
    roomJoin: true,
    room: 'test-room',
    canPublish: true,
    canSubscribe: true,
  });

  // ⚠️ v2.x: 必須 await
  const token = await at.toJwt();  // ✅

  console.log('✅ Token generated:', token);
}

testTokenGeneration();
```

```dart
// test_livekit.dart (Flutter 測試)
import 'package:livekit_client/livekit_client.dart';

Future<void> testLiveKitConnection() async {
  final room = Room();

  // 測試用 token (從後端 API 獲取)
  final token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
  final url = 'ws://your-server:7880';

  try {
    await room.connect(
      url,
      token,
      roomOptions: const RoomOptions(
        adaptiveStream: true,
        dynacast: true,
      ),
    );

    print('✅ Successfully connected to LiveKit room');

    // 測試發布音視訊
    await room.localParticipant?.setMicrophoneEnabled(true);
    await room.localParticipant?.setCameraEnabled(true);

    print('✅ Audio/Video tracks published');

  } catch (e) {
    print('❌ Connection failed: $e');
  }
}
```

### 10.6 Flutter 客戶端完整實作指南

#### 10.6.1 專案設置

```bash
# 檢查 Flutter 環境
flutter doctor

# 創建或進入現有專案
cd your_flutter_app

# 添加依賴
flutter pub add livekit_client
flutter pub add socket_io_client
flutter pub add dio
flutter pub add flutter_riverpod
flutter pub add permission_handler
flutter pub add uuid
```

#### 10.6.2 pubspec.yaml 配置

```yaml
name: im_app
description: IM Services Flutter 客戶端
version: 1.0.0+1

environment:
  sdk: '>=3.0.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter

  # LiveKit Flutter SDK
  livekit_client: ^2.2.0

  # WebSocket 客戶端
  socket_io_client: ^2.0.0

  # HTTP 請求
  dio: ^5.0.0

  # 狀態管理
  flutter_riverpod: ^2.4.0

  # 權限管理
  permission_handler: ^11.0.0

  # 其他工具
  uuid: ^4.0.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0
```

#### 10.6.3 CallService 實作

```dart
// lib/services/call_service.dart
import 'package:livekit_client/livekit_client.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:permission_handler/permission_handler.dart';

class CallService {
  late Room _room;
  late IO.Socket _socket;

  // 事件回調
  Function(Map<String, dynamic>)? onIncomingCall;
  Function(String)? onCallStarted;
  Function(Participant)? onParticipantJoined;
  Function(Participant)? onParticipantLeft;

  CallService() {
    _initializeSocket();
  }

  void _initializeSocket() {
    _socket = IO.io(
      'http://your-server:3001',
      IO.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': 'your-jwt-token'})
          .build(),
    );

    _socket.on('connect', (_) {
      print('✅ WebSocket connected');
    });

    _socket.on('incomingCall', (data) {
      onIncomingCall?.call(data as Map<String, dynamic>);
    });

    _socket.on('callStarted', (data) {
      final callData = data as Map<String, dynamic>;
      _connectToRoom(
        token: callData['token'],
        url: callData['livekitUrl'],
        callId: callData['callId'],
      );
    });

    _socket.on('callAccepted', (data) {
      final callData = data as Map<String, dynamic>;
      _connectToRoom(
        token: callData['token'],
        url: callData['livekitUrl'],
        callId: callData['callId'],
      );
    });

    _socket.on('participantJoined', (data) {
      print('👤 Participant joined: ${data['username']}');
    });

    _socket.on('callEnded', (data) {
      _room.disconnect();
      print('📞 Call ended');
    });
  }

  /// 發起通話
  Future<void> startCall({
    required String conversationId,
    required List<String> calleeIds,
    required String callType, // 'audio' or 'video'
  }) async {
    // 請求權限
    await _requestPermissions(callType == 'video');

    _socket.emit('startCall', {
      'conversationId': conversationId,
      'calleeIds': calleeIds,
      'callType': callType,
    });
  }

  /// 接聽通話
  Future<void> acceptCall({
    required String callId,
    required String roomName,
  }) async {
    await _requestPermissions(true);

    _socket.emit('acceptCall', {
      'callId': callId,
      'roomName': roomName,
    });
  }

  /// 拒絕通話
  void rejectCall(String callId) {
    _socket.emit('rejectCall', {'callId': callId});
  }

  /// 結束通話
  void endCall(String callId, String roomName, int durationSeconds) {
    _socket.emit('endCall', {
      'callId': callId,
      'roomName': roomName,
      'durationSeconds': durationSeconds,
    });
    _room.disconnect();
  }

  /// 連接到 LiveKit 房間
  Future<void> _connectToRoom({
    required String token,
    required String url,
    required String callId,
  }) async {
    _room = Room();

    // 監聽事件
    _room.on(RoomEvent.participantConnected, (participant) {
      print('👤 Participant connected: ${participant.identity}');
      onParticipantJoined?.call(participant);
    });

    _room.on(RoomEvent.participantDisconnected, (participant) {
      print('👤 Participant disconnected: ${participant.identity}');
      onParticipantLeft?.call(participant);
    });

    _room.on(RoomEvent.trackSubscribed, (track, publication, participant) {
      print('🎬 Track subscribed: ${track.kind}');
    });

    _room.on(RoomEvent.disconnected, (_) {
      print('📞 Disconnected from room');
    });

    // 連接到房間
    await _room.connect(
      url,
      token,
      roomOptions: const RoomOptions(
        adaptiveStream: true,
        dynacast: true,
        defaultAudioPublishOptions: AudioPublishOptions(
          dtx: true,
        ),
        defaultVideoPublishOptions: VideoPublishOptions(
          simulcast: true,
        ),
      ),
    );

    print('✅ Connected to LiveKit room');

    // 發布本地音視訊
    await _publishLocalTracks();
  }

  /// 發布本地音視訊
  Future<void> _publishLocalTracks() async {
    // 發布麥克風
    await _room.localParticipant?.setMicrophoneEnabled(true);

    // 發布攝像頭
    await _room.localParticipant?.setCameraEnabled(true);
  }

  /// 請求權限
  Future<void> _requestPermissions(bool includeCamera) async {
    final permissions = [Permission.microphone];
    if (includeCamera) {
      permissions.add(Permission.camera);
    }

    final statuses = await permissions.request();

    for (final entry in statuses.entries) {
      if (!entry.value.isGranted) {
        throw Exception('Permission ${entry.key} denied');
      }
    }
  }

  /// 切換麥克風
  Future<void> toggleMicrophone() async {
    final isEnabled = _room.localParticipant?.isMicrophoneEnabled() ?? false;
    await _room.localParticipant?.setMicrophoneEnabled(!isEnabled);
  }

  /// 切換攝像頭
  Future<void> toggleCamera() async {
    final isEnabled = _room.localParticipant?.isCameraEnabled() ?? false;
    await _room.localParticipant?.setCameraEnabled(!isEnabled);
  }

  /// 切換前後鏡頭
  Future<void> switchCamera() async {
    await Hardware.instance.switchCamera();
  }

  /// 獲取 Room 實例
  Room get room => _room;

  /// 斷開連接
  void dispose() {
    _room.disconnect();
    _socket.dispose();
  }
}
```

#### 10.6.4 視訊通話 UI Widget

```dart
// lib/screens/video_call_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:livekit_client/livekit_client.dart';

class VideoCallScreen extends ConsumerStatefulWidget {
  final String callId;
  final String roomName;

  const VideoCallScreen({
    required this.callId,
    required this.roomName,
    super.key,
  });

  @override
  ConsumerState<VideoCallScreen> createState() => _VideoCallScreenState();
}

class _VideoCallScreenState extends ConsumerState<VideoCallScreen> {
  late Room _room;
  LocalVideoTrack? _localVideoTrack;
  Map<String, RemoteVideoTrack> _remoteVideoTracks = {};
  bool _isMuted = false;
  bool _isCameraOff = false;
  DateTime? _callStartTime;

  @override
  void initState() {
    super.initState();
    _callStartTime = DateTime.now();
    _initializeRoom();
  }

  void _initializeRoom() {
    // 從 CallService 獲取 Room 實例
    final callService = ref.read(callServiceProvider);
    _room = callService.room;

    // 監聽 track 事件
    _room.on(RoomEvent.trackSubscribed, _onTrackSubscribed);
    _room.on(RoomEvent.trackUnsubscribed, _onTrackUnsubscribed);

    // 獲取本地視訊 track
    _localVideoTrack = _room.localParticipant?.videoTrackPublications
        .firstOrNull?.track as LocalVideoTrack?;

    setState(() {});
  }

  void _onTrackSubscribed(Track track, TrackPublication publication, RemoteParticipant participant) {
    if (track is RemoteVideoTrack) {
      setState(() {
        _remoteVideoTracks[participant.sid] = track;
      });
    }
  }

  void _onTrackUnsubscribed(Track track, TrackPublication publication, RemoteParticipant participant) {
    if (track is RemoteVideoTrack) {
      setState(() {
        _remoteVideoTracks.remove(participant.sid);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: SafeArea(
        child: Stack(
          children: [
            // 遠端視訊（網格佈局或全螢幕）
            _buildRemoteVideos(),

            // 本地視訊（小窗口）
            if (_localVideoTrack != null)
              Positioned(
                top: 50,
                right: 20,
                child: Container(
                  width: 120,
                  height: 160,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black26,
                        blurRadius: 8,
                      ),
                    ],
                  ),
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: VideoTrackRenderer(
                      _localVideoTrack!,
                      fit: BoxFit.cover,
                      mirror: true,
                    ),
                  ),
                ),
              ),

            // 頂部資訊欄
            Positioned(
              top: 20,
              left: 20,
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  color: Colors.black54,
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  children: [
                    Icon(Icons.videocam, color: Colors.white, size: 20),
                    SizedBox(width: 8),
                    Text(
                      _getCallDuration(),
                      style: TextStyle(color: Colors.white, fontSize: 14),
                    ),
                  ],
                ),
              ),
            ),

            // 底部控制按鈕
            Positioned(
              bottom: 40,
              left: 0,
              right: 0,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  // 靜音按鈕
                  _buildControlButton(
                    icon: _isMuted ? Icons.mic_off : Icons.mic,
                    label: _isMuted ? '取消靜音' : '靜音',
                    onPressed: _toggleMute,
                  ),

                  // 掛斷按鈕
                  _buildControlButton(
                    icon: Icons.call_end,
                    label: '掛斷',
                    color: Colors.red,
                    onPressed: _endCall,
                  ),

                  // 切換攝像頭
                  _buildControlButton(
                    icon: Icons.cameraswitch,
                    label: '切換',
                    onPressed: _switchCamera,
                  ),

                  // 關閉/開啟攝像頭
                  _buildControlButton(
                    icon: _isCameraOff ? Icons.videocam_off : Icons.videocam,
                    label: _isCameraOff ? '開啟視訊' : '關閉視訊',
                    onPressed: _toggleCamera,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRemoteVideos() {
    if (_remoteVideoTracks.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: Colors.white),
            SizedBox(height: 20),
            Text(
              '等待對方加入...',
              style: TextStyle(color: Colors.white, fontSize: 16),
            ),
          ],
        ),
      );
    }

    // 單人：全螢幕
    if (_remoteVideoTracks.length == 1) {
      final track = _remoteVideoTracks.values.first;
      return VideoTrackRenderer(
        track,
        fit: BoxFit.contain,
      );
    }

    // 多人：網格佈局
    return GridView.builder(
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: _remoteVideoTracks.length <= 4 ? 2 : 3,
        childAspectRatio: 3 / 4,
      ),
      itemCount: _remoteVideoTracks.length,
      itemBuilder: (context, index) {
        final track = _remoteVideoTracks.values.elementAt(index);
        return Padding(
          padding: EdgeInsets.all(4),
          child: VideoTrackRenderer(
            track,
            fit: BoxFit.cover,
          ),
        );
      },
    );
  }

  Widget _buildControlButton({
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
    Color color = Colors.white,
  }) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 60,
          height: 60,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: color == Colors.red ? Colors.red : Colors.black54,
          ),
          child: IconButton(
            icon: Icon(icon, color: Colors.white, size: 28),
            onPressed: onPressed,
          ),
        ),
        SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(color: Colors.white, fontSize: 12),
        ),
      ],
    );
  }

  String _getCallDuration() {
    if (_callStartTime == null) return '00:00';
    final duration = DateTime.now().difference(_callStartTime!);
    final minutes = duration.inMinutes.toString().padLeft(2, '0');
    final seconds = (duration.inSeconds % 60).toString().padLeft(2, '0');
    return '$minutes:$seconds';
  }

  Future<void> _toggleMute() async {
    final callService = ref.read(callServiceProvider);
    await callService.toggleMicrophone();
    setState(() {
      _isMuted = !_isMuted;
    });
  }

  Future<void> _toggleCamera() async {
    final callService = ref.read(callServiceProvider);
    await callService.toggleCamera();
    setState(() {
      _isCameraOff = !_isCameraOff;
    });
  }

  Future<void> _switchCamera() async {
    final callService = ref.read(callServiceProvider);
    await callService.switchCamera();
  }

  void _endCall() {
    final callService = ref.read(callServiceProvider);
    final duration = _callStartTime != null
        ? DateTime.now().difference(_callStartTime!).inSeconds
        : 0;

    callService.endCall(widget.callId, widget.roomName, duration);
    Navigator.pop(context);
  }

  @override
  void dispose() {
    _room.removeListener(_onTrackSubscribed);
    _room.removeListener(_onTrackUnsubscribed);
    super.dispose();
  }
}

// Riverpod Provider
final callServiceProvider = Provider((ref) => CallService());
```

#### 10.6.5 平台特定配置

**iOS: Info.plist**
```xml
<key>NSCameraUsageDescription</key>
<string>需要使用攝像頭進行視訊通話</string>
<key>NSMicrophoneUsageDescription</key>
<string>需要使用麥克風進行語音通話</string>
<key>UIBackgroundModes</key>
<array>
    <string>audio</string>
    <string>voip</string>
</array>
```

**Android: AndroidManifest.xml**
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.WAKE_LOCK" />

<application
    android:usesCleartextTraffic="true">
    <!-- ... -->
</application>
```

**Android: build.gradle (app level)**
```gradle
android {
    compileSdkVersion 34

    defaultConfig {
        minSdkVersion 21
        targetSdkVersion 34
    }
}
```

---

### 10.7 Flutter 專案結構建議

```
your_flutter_app/
├── lib/
│   ├── main.dart
│   ├── config/
│   │   └── app_config.dart              # API URLs 配置
│   ├── models/
│   │   ├── call_model.dart              # 通話資料模型
│   │   ├── participant_model.dart       # 參與者模型
│   │   └── conversation_model.dart
│   ├── services/
│   │   ├── api_service.dart             # HTTP API (Dio)
│   │   ├── websocket_service.dart       # Socket.IO 連接
│   │   ├── call_service.dart            # LiveKit 通話服務
│   │   └── permission_service.dart      # 權限管理
│   ├── providers/
│   │   ├── call_provider.dart           # 通話狀態管理
│   │   ├── room_provider.dart           # 房間狀態管理
│   │   └── auth_provider.dart
│   ├── screens/
│   │   ├── chat/
│   │   │   ├── conversation_screen.dart
│   │   │   └── chat_room_screen.dart
│   │   └── call/
│   │       ├── incoming_call_screen.dart  # 來電界面
│   │       ├── video_call_screen.dart     # 視訊通話界面
│   │       ├── audio_call_screen.dart     # 語音通話界面
│   │       └── group_call_screen.dart     # 群組通話界面
│   ├── widgets/
│   │   ├── video/
│   │   │   ├── video_renderer.dart        # 視訊渲染
│   │   │   ├── participant_tile.dart      # 參與者卡片
│   │   │   └── call_controls.dart         # 控制按鈕
│   │   └── call/
│   │       ├── incoming_call_dialog.dart  # 來電彈窗
│   │       └── call_duration_timer.dart   # 計時器
│   └── utils/
│       ├── platform_utils.dart            # 平台檢測
│       └── call_utils.dart                # 通話工具函數
├── ios/
│   └── Runner/
│       └── Info.plist                     # iOS 權限配置
├── android/
│   └── app/
│       └── src/
│           └── main/
│               └── AndroidManifest.xml    # Android 權限配置
└── pubspec.yaml                           # Flutter 依賴
```

### 10.8 Flutter 跨平台優勢

使用 Flutter 的關鍵優勢：

| 特性 | 說明 | 效益 |
|------|------|------|
| **一套代碼多平台** | iOS、Android、Web 共用代碼 | 開發效率提升 3 倍 |
| **原生性能** | 直接編譯為原生代碼 | 流暢的 60fps UI |
| **熱重載** | 快速迭代 UI | 開發速度快 |
| **Widget 豐富** | Material + Cupertino | 符合各平台設計規範 |
| **社群活躍** | pub.dev 套件豐富 | LiveKit、Socket.IO 都有支援 |

### 10.9 參考文件

#### LiveKit 相關
- **LiveKit 官方文檔**: https://docs.livekit.io
- **LiveKit Flutter SDK**: https://pub.dev/packages/livekit_client
- **LiveKit Flutter 範例**: https://github.com/livekit/client-sdk-flutter/tree/main/example
- **LiveKit Node.js SDK**: https://github.com/livekit/node-sdks
- **LiveKit Server SDK 參考**: https://docs.livekit.io/reference/server-sdk-js/

#### Flutter 相關
- **Flutter 官方文檔**: https://flutter.dev/docs
- **Socket.IO Client for Flutter**: https://pub.dev/packages/socket_io_client
- **Permission Handler**: https://pub.dev/packages/permission_handler
- **Flutter Riverpod**: https://riverpod.dev
- **Flutter CallKit Incoming**: https://pub.dev/packages/flutter_callkit_incoming

#### 後端相關
- **NestJS Microservices**: https://docs.nestjs.com/microservices
- **Coturn 文檔**: https://github.com/coturn/coturn
- **WebRTC 規範**: https://www.w3.org/TR/webrtc/

---

## 批准簽名

| 角色 | 姓名 | 簽名 | 日期 |
|------|------|------|------|
| 專案負責人 | _____ | _____ | 2025-11-18 |
| 技術主管 | _____ | _____ | 2025-11-18 |
| 產品經理 | _____ | _____ | 2025-11-18 |

---

**文件版本:** v1.0
**建立日期:** 2025-11-18
**LiveKit SDK:** v2.14.1 (最新)
**下次檢視:** 每週一進度會議

---

## 快速開始指南

確認計劃後，建議按以下順序開始實施：

### Phase 1 快速啟動 (第 1 週)

**Day 1:**
```bash
# 1. 創建 Proto 文件
cd ./services/protos/
# 創建 rtc.proto（參考 4.1 節）

# 2. 生成 LiveKit API Key
# 訪問 LiveKit Cloud 或本地生成
```

**Day 2-3:**
```bash
# 3. 初始化 RTC Service
cd ./services/
nest new rtc-service
cd rtc-service

# 4. 安裝依賴
pnpm add livekit-server-sdk@^2.14.1
pnpm add @grpc/grpc-js@^1.11.0
pnpm add @nestjs/microservices@^10.0.0
pnpm add mongoose@^8.0.0
pnpm add uuid
```

**Day 4-5:**
```bash
# 5. 實作 LiveKitService
# 參考 5.1 節代碼

# 6. 測試 Token 生成
node test-token.ts
```

### Phase 2 快速部署 (第 2 週)

```bash
# 1. 更新 docker-compose.registry.yml
# 添加 livekit-server、coturn、rtc-service

# 2. 創建配置文件
mkdir -p config
# 創建 livekit.yaml 和 turnserver.conf

# 3. 更新 .env.prod
# 添加 LiveKit 和 Coturn 環境變量

# 4. 部署測試
./build.sh prod
docker compose ps
docker compose logs livekit-server
docker compose logs rtc-service
```

---

### Flutter 前端快速開始 (第 5 週起)

**Week 5, Day 1:**
```bash
# 1. 檢查 Flutter 環境
flutter doctor

# 2. 進入 Flutter 專案
cd your_flutter_app

# 3. 安裝 LiveKit 相關依賴
flutter pub add livekit_client
flutter pub add socket_io_client
flutter pub add dio
flutter pub add flutter_riverpod
flutter pub add permission_handler
flutter pub add uuid
```

**Week 5, Day 2-3:**
```bash
# 4. 創建服務類檔案
mkdir -p lib/services
touch lib/services/call_service.dart
touch lib/services/websocket_service.dart
touch lib/services/api_service.dart

# 5. 配置平台權限
# iOS: 編輯 ios/Runner/Info.plist
# Android: 編輯 android/app/src/main/AndroidManifest.xml

# 6. 實作 CallService（參考 10.6.3 節）
```

**Week 5, Day 4-5:**
```bash
# 7. 創建 UI 界面
mkdir -p lib/screens/call
touch lib/screens/call/incoming_call_screen.dart
touch lib/screens/call/video_call_screen.dart

# 8. 測試
flutter run -d ios        # iOS 模擬器
flutter run -d android    # Android 模擬器
flutter run -d chrome     # Web 瀏覽器
```

**Week 6: 真實設備測試**
```bash
# 1. iOS 真機測試
flutter run --release -d [your-iphone]

# 2. Android 真機測試
flutter run --release -d [your-android-phone]

# 3. 網路切換測試
# 測試 WiFi ↔ 4G/5G 切換場景
```

---

準備好開始了嗎？

**建議開發順序：**
1. **先做後端**（Week 1-4）：確保 API 和 WebSocket 完整可用
2. **再做 Flutter**（Week 5-9）：基於穩定的後端 API 開發前端
3. **最後優化**（Week 10-12）：進階功能和性能優化
