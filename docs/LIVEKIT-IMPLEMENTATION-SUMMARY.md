# LiveKit 整合實作總結

**完成日期**: 2025-11-18
**狀態**: Phase 1-3 核心基礎建設完成

---

## 已完成的工作

### 1. Proto 定義 
- **文件**: `services/protos/rtc.proto`
- **內容**: 11 個 gRPC 方法，30+ message 定義，4 個 enum
- **方法列表**:
  - StartCall, EndCall, GetCallStatus
  - GenerateToken
  - GetCallHistory, GetCallDetails
  - CreateRoom, DeleteRoom, ListActiveRooms
  - GetRoomParticipants, KickParticipant

---

### 2. RTC Service 完整實作 

#### 核心模組
- **LiveKitService**: LiveKit SDK v2.14.1 封裝
  - createRoom(), deleteRoom(), listRooms()
  - generateToken() (使用異步 `await at.toJwt()`)
  - getParticipants(), removeParticipant()

- **CallRecordService**: MongoDB 通話記錄管理
  - createCallRecord(), endCall()
  - getCallHistory(), getCallDetails()
  - markParticipantJoined(), markParticipantLeft()

- **RtcService**: 業務邏輯層
  - startCall(): 創建房間 + 保存記錄 + (可選)保存到聊天
  - endCall(): 刪除房間 + 更新記錄
  - generateToken(), getCallStatus()
  - getCallHistory(), getRoomParticipants()

- **RtcController**: gRPC Controller
  - 實作所有 11 個 gRPC 方法
  - Proto 格式映射

#### gRPC Clients (調用其他服務)
- **ChatClientService**: 調用 Chat Service
  - saveCallMessage() - 保存通話訊息到對話
  - getConversationDetails(), getConversationParticipants()

- **UserClientService**: 調用 User Service
  - getUserInfo(), batchGetUsers()

- **NotificationClientService**: 調用 Notification Service
  - sendCallNotification() - 來電推播
  - sendMissedCallNotification() - 未接來電

#### 配置文件
- `Dockerfile` - 多階段構建
- `.dockerignore`
- `.env.example`
- `tsconfig.json` (已由 NestJS CLI 生成)
- `package.json` (包含所有依賴)

---

### 3. WebSocket Server 擴展 

#### 新增模組
- **RtcClientModule**: RTC Service 的 gRPC Client
- **RtcClientService**: 封裝所有 RTC gRPC 調用

#### 新增 WebSocket 事件處理
- `@SubscribeMessage('startCall')` - 發起通話
  - 調用 RTC Service 創建房間
  - 生成發起者 Token
  - 廣播來電通知給被呼叫者

- `@SubscribeMessage('acceptCall')` - 接聽通話
  - 生成接聽者 Token
  - 廣播參與者加入事件

- `@SubscribeMessage('rejectCall')` - 拒絕通話
  - 記錄拒接事件

- `@SubscribeMessage('endCall')` - 結束通話
  - 調用 RTC Service 結束通話
  - 廣播通話結束事件

#### 模組更新
- `app.module.ts` - 導入 RtcClientModule
- `websocket.module.ts` - 導入 RtcClientModule

---

### 4. API Gateway 擴展 

#### 新增模組
- **RtcClientModule**: RTC Service 的 gRPC Client
- **RtcClientService**: 封裝查詢 gRPC 調用

#### 新增 HTTP 端點 (只提供查詢)
- `GET /api/calls/history` - 查詢通話記錄
- `GET /api/calls/:callId` - 查詢通話詳情
- `GET /api/calls/:callId/status` - 查詢通話狀態

#### 模組更新
- `app.module.ts` - 導入 RtcClientModule 和 RtcController

**重要架構決策**: API Gateway **不提供**通話操作端點（startCall、endCall），所有操作只通過 WebSocket。

---

### 5. Docker 配置 

#### 新增服務到 docker-compose.dev.yml
- **livekit-server**: LiveKit WebRTC 媒體服務器
  - Port: 7880 (WebRTC/WebSocket)
  - Port: 7881 (HTTP API)
  - 配置: `config/livekit.yaml`

- **coturn**: STUN/TURN 服務器
  - Port: 3478 (UDP/TCP STUN)
  - Port: 5349 (TLS)
  - Port: 49152-65535 (UDP relay)
  - 配置: `config/turnserver.conf`

- **rtc-service**: 通話管理微服務
  - Port: 50058 (gRPC)
  - 依賴: mongodb, livekit-server, chat-service, user-service

#### 更新 docker-compose.registry.yml (生產環境)
- 同樣添加 livekit-server, coturn, rtc-service

#### 更新現有服務
- **websocket-server**: 添加 RTC_SERVICE_URL, RTC_SERVICE_PORT
- **api-gateway**: 添加 RTC_SERVICE_URL, RTC_SERVICE_PORT

---

### 6. 配置文件 

#### config/livekit.yaml
- 端口配置: 7880 (WebRTC), 7881 (HTTP)
- RTC 端口範圍: 50000-60000
- TURN 整合配置
- 房間設置: 自動創建、5分鐘空房超時、最多100人
- 日誌級別: info

#### config/turnserver.conf
- STUN/TURN 端口: 3478, 5349
- 認證模式: lt-cred-mech
- Relay 端口範圍: 49152-65535
- 安全選項: 禁用舊版 TLS

---

### 7. 環境變量 

#### .env.dev (開發環境)
新增：
```bash
RTC_SERVICE_PORT=50058
RTC_SERVICE_URL=rtc-service:50058
LIVEKIT_HOST=livekit-server
LIVEKIT_URL=ws://livekit-server:7880
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret
TURN_SERVER_URL=turn:localhost:3478
TURN_USERNAME=turnuser
TURN_PASSWORD=turnpassword
```

#### env.prod.example (生產環境範本)
新增：
```bash
RTC_SERVICE_PORT=50058
RTC_SERVICE_URL=rtc-service:50058
LIVEKIT_API_KEY=PLEASE_CHANGE_ME
LIVEKIT_API_SECRET=PLEASE_CHANGE_ME_WITH_LONG_SECRET
TURN_SERVER_URL=turn:YOUR_SERVER_PUBLIC_IP:3478
TURN_PASSWORD=PLEASE_CHANGE_ME_TURN_PASSWORD
```

---

### 8. Build 腳本更新 

#### build.sh
- 新增服務描述: livekit-server, coturn, rtc-service
- 更新構建順序:
  ```
  第一階段: mongodb, livekit-server, coturn
  第二階段: user-service, notification-service
  第三階段: chat-service, rtc-service, websocket-server
  第四階段: file-service
  第五階段: api-gateway
  ```
- 更新服務訪問信息顯示（包含 LiveKit 和 Coturn）

---

### 9. 文檔 

- **LIVEKIT-INTEGRATION-PLAN.md**: 完整整合計劃書
  - 2,693 行，包含架構圖、流程圖、代碼範例
  - 已更新為 Flutter 前端
  - 已移除 API Gateway 的 StartCall 端點

- **services/rtc-service/README.md**: RTC Service 專案文檔
  - API 說明
  - 開發指南
  - 故障排除

---

## 專案統計

### 創建的文件

**RTC Service** (11 個文件):
```
src/
├── main.ts
├── app.module.ts
├── rtc/
│   ├── rtc.module.ts
│   ├── rtc.controller.ts
│   └── rtc.service.ts
├── livekit/
│   ├── livekit.module.ts
│   └── livekit.service.ts
├── call-record/
│   ├── call-record.module.ts
│   ├── call-record.service.ts
│   └── schemas/call-record.schema.ts
├── grpc-clients/
│   ├── chat-client.module.ts
│   ├── chat-client.service.ts
│   ├── user-client.module.ts
│   ├── user-client.service.ts
│   ├── notification-client.module.ts
│   └── notification-client.service.ts
├── Dockerfile
├── .dockerignore
├── .env.example
└── README.md
```

**WebSocket Server** (2 個文件):
```
src/rtc-client/
├── rtc-client.module.ts
└── rtc-client.service.ts
```

**API Gateway** (3 個文件):
```
src/rtc-client/
├── rtc-client.module.ts
└── rtc-client.service.ts
src/controllers/
└── rtc.controller.ts
```

**配置文件** (2 個):
```
config/
├── livekit.yaml
└── turnserver.conf
```

**Proto 定義** (1 個):
```
services/protos/
└── rtc.proto
```

**總計**: 約 **20 個新文件**，**3,000+ 行代碼**

---

## 下一步行動

### 立即可做的事情

#### 1. 生成 LiveKit API 密鑰

在 `config/livekit.yaml` 中添加：
```bash
# 生成密鑰
openssl rand -base64 32  # API Key
openssl rand -base64 48  # API Secret
```

然後更新 `config/livekit.yaml`:
```yaml
keys:
  YOUR_GENERATED_KEY: YOUR_GENERATED_SECRET
```

並更新 `.env.dev`:
```bash
LIVEKIT_API_KEY=YOUR_GENERATED_KEY
LIVEKIT_API_SECRET=YOUR_GENERATED_SECRET
```

#### 2. 測試部署

```bash
# 構建並啟動所有服務
./build.sh dev

# 查看 RTC Service 日誌
docker compose -f docker-compose.dev.yml logs -f rtc-service

# 查看 LiveKit Server 日誌
docker compose -f docker-compose.dev.yml logs -f livekit-server

# 檢查所有服務狀態
docker compose -f docker-compose.dev.yml ps
```

#### 3. 測試 gRPC 連接

```bash
# 安裝 grpcurl (如果還沒有)
go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest

# 測試 RTC Service
grpcurl -plaintext localhost:50058 list
grpcurl -plaintext localhost:50058 list rtc.RTCService
```

#### 4. 測試 WebSocket 通話事件

使用 Postman 或前端測試：
```javascript
// 連接 WebSocket
const socket = io('http://localhost:3001', {
  auth: { token: 'your-jwt-token' }
});

// 發起通話
socket.emit('startCall', {
  conversationId: 'conv-123',
  calleeIds: ['user-2'],
  callType: 'video'
});

// 監聽事件
socket.on('callStarted', (data) => {
  console.log('Call started:', data);
  // 使用 LiveKit SDK 連接
});
```

---

## 待完成的工作 (Phase 4-7)

### Phase 4: 前端 Flutter 整合 (週 5-6)
- [ ] Flutter 專案設置
- [ ] 安裝 livekit_client、socket_io_client
- [ ] 實作 CallService (Flutter)
- [ ] 實作視訊通話 UI
- [ ] 平台權限配置 (iOS/Android)

### Phase 5: 群組通話 (週 7-8)
- [ ] 後端支援多人通話邏輯
- [ ] Flutter 網格佈局 UI
- [ ] 參與者列表管理

### Phase 6: 推播通知 (週 9)
- [ ] iOS CallKit 整合
- [ ] Android ConnectionService 整合
- [ ] 未接來電記錄

### Phase 7: 進階功能 (週 10-12，選配)
- [ ] 螢幕分享
- [ ] 通話錄影 (LiveKit Egress + MinIO)
- [ ] 統計監控 (Prometheus + Grafana)

---

## 架構特色

### 正確的設計決策

1. **只保留 WebSocket 作為通話入口**
   - 發起通話、接聽、拒絕、結束都通過 WebSocket
   - API Gateway 只提供查詢功能
   - 避免雙重邏輯，降低複雜度

2. **前端統一使用 Flutter**
   - iOS、Android、Web 一套代碼
   - 降低維護成本
   - 統一的用戶體驗

3. **使用最新 LiveKit v2.14.1 API**
   - 正確使用異步 `await at.toJwt()`
   - 符合最新最佳實踐

4. **完整的 gRPC 微服務架構**
   - RTC Service 通過 gRPC 調用其他服務
   - 統一的錯誤處理
   - 200MB 訊息大小支援

---

## 依賴清單

### RTC Service (package.json)
```json
{
  "dependencies": {
    "livekit-server-sdk": "^2.14.1",
    "@nestjs/core": "^11.0.0",
    "@nestjs/microservices": "^11.0.0",
    "@nestjs/mongoose": "^11.0.0",
    "@nestjs/config": "^4.0.0",
    "@grpc/grpc-js": "^1.11.0",
    "@grpc/proto-loader": "^0.7.13",
    "mongoose": "^8.0.0",
    "uuid": "^13.0.0"
  }
}
```

### Flutter (未來需要)
```yaml
dependencies:
  livekit_client: ^2.2.0
  socket_io_client: ^2.0.0
  flutter_riverpod: ^2.4.0
  permission_handler: ^11.0.0
```

---

## 檢查清單

在開始測試前，請確認：

- [ ] `.env.dev` 包含所有 LiveKit 和 Coturn 環境變量
- [ ] `config/livekit.yaml` 配置了有效的 API Key
- [ ] `config/turnserver.conf` 配置正確
- [ ] MongoDB Replica Set 已初始化
- [ ] RTC Service 的依賴已安裝 (`pnpm install`)
- [ ] WebSocket Server、API Gateway 已重新構建

---

## 重要概念

### WebSocket 事件流程

```
Flutter App
    │ emit('startCall')
    ↓
WebSocket Server
    │ gRPC: StartCall()
    ↓
RTC Service
    │ LiveKit: createRoom()
    │ MongoDB: 保存記錄
    ↓
WebSocket Server
    │ broadcastToUser('incomingCall') → 被呼叫者
    │ emit('callStarted') → 發起者
    ↓
Flutter App (雙方)
    │ room.connect(url, token)
    ↓
LiveKit Server (WebRTC 媒體傳輸)
```

### gRPC 調用鏈

```
WebSocket Server  →  RTC Service  →  LiveKit Server
                         ↓
                    MongoDB (calls)
                         ↓
                   Chat Service (可選)
```

---

## 提示

### 開發測試建議

1. **先測試 LiveKit Server**
   ```bash
   curl http://localhost:7880/
   # 應該返回 LiveKit 的版本信息
   ```

2. **測試 RTC Service gRPC**
   ```bash
   grpcurl -plaintext localhost:50058 rtc.RTCService/ListActiveRooms
   ```

3. **測試完整通話流程**
   - 兩個瀏覽器標籤頁連接 WebSocket
   - 一個發起通話，另一個接收來電通知
   - 使用 LiveKit React Components 快速測試 UI

### 生產部署注意事項

1. **更換所有 PLEASE_CHANGE_ME 密鑰**
2. **配置 Coturn 的外部 IP**
3. **配置 LiveKit 的 external_ip**
4. **啟用 HTTPS/WSS**
5. **設置防火牆規則（開放 3478, 7880, 49152-65535 UDP）**

---

## 聯絡與支援

如有問題，請參考：
- [LiveKit 整合計劃書](./LIVEKIT-INTEGRATION-PLAN.md)
- [RTC Service README](./services/rtc-service/README.md)
- [LiveKit 官方文檔](https://docs.livekit.io)

---

**專案狀態**: 後端核心功能完成，準備進入前端開發階段！
**下一里程碑**: Phase 4 - Flutter 前端整合（預計 2 週）
