# WebSocket 架構重構實施企畫書
## 從 Device ID 映射改為 Token-Based 連線管理

**版本**: 1.0  
**日期**: 2025-01-08  
**負責人**: Development Team  
**專案代號**: WS-TOKEN-REFACTOR

---

## 專案概述

### 目標
將現有 WebSocket 連線管理機制從 Device ID 映射改為基於 JWT Token 的認證連線，參照現代通訊軟體如 LINE、WhatsApp 的企業級架構模式。

### 核心問題
- 目前 Device ID 管理複雜且容易產生重連問題
- 多設備連線限制邏輯存在競態條件
- 缺乏有效的分散式連線狀態管理

### 預期效益
- 解決重連時多連線問題
- 提升系統穩定性和擴展性
- 簡化連線管理邏輯
- 支援真正的企業級多設備管理

---

## 架構設計

### 現有架構分析

**當前問題點**:
```typescript
// 現有問題架構
private connections = new Map<string, Map<string, DeviceConnection>>();
// userId -> deviceId -> DeviceConnection (複雜且容易出錯)

// Device ID 生成不穩定
const deviceId = client.handshake.query.deviceId || this.generateDeviceId(client);
```

### 新架構設計

**Token-Based 連線映射**:
```typescript
// 新架構 - 基於認證的簡潔映射
private userConnections = new Map<string, Set<AuthenticatedSocket>>();
// userId -> Set<AuthenticatedSocket> (簡單且穩定)

interface AuthenticatedSocket extends Socket {
  userId: string;
  tokenId: string;  // JWT 的 jti (unique identifier)
  deviceInfo: DeviceInfo;
  authenticatedAt: Date;
}
```

---

## 實施計劃

### Phase 1: 準備階段 (1-2 天)

#### 1.1 建立新的連線管理服務
```typescript
// 新建: src/websocket/connection-manager.service.ts
@Injectable()
export class ConnectionManagerService {
  private readonly logger = new Logger(ConnectionManagerService.name);
  private userConnections = new Map<string, Set<AuthenticatedSocket>>();
  private tokenConnections = new Map<string, AuthenticatedSocket>();
  
  // 基於 Token 的連線管理方法
  addConnection(socket: AuthenticatedSocket): void
  removeConnection(tokenId: string): void
  getUserConnections(userId: string): Set<AuthenticatedSocket>
  isUserOnline(userId: string): boolean
  broadcastToUser(userId: string, event: string, data: any): void
}
```

#### 1.2 JWT Token 驗證增強
```typescript
// 修改: src/websocket/websocket.gateway.ts
interface JWTPayload {
  sub: string;     // userId
  jti: string;     // token unique identifier
  aud: string;     // audience
  exp: number;     // expiration
  iat: number;     // issued at
  device?: {       // 可選設備資訊
    type: 'web' | 'ios' | 'android';
    userAgent?: string;
    fcmToken?: string;  // 用於推播
  };
}
```

### Phase 2: 核心重構 (3-4 天)

#### 2.1 WebSocket Gateway 重構

**新的連線處理邏輯**:
```typescript
async handleConnection(client: Socket) {
  try {
    // 1. Token 驗證
    const token = client.handshake.auth.token;
    const payload = await this.validateAndDecodeToken(token);
    
    // 2. 檢查重複連線
    const existingConnection = this.connectionManager.getConnectionByToken(payload.jti);
    if (existingConnection) {
      this.logger.log(`Replacing existing connection for token: ${payload.jti}`);
      existingConnection.disconnect(true);
    }
    
    // 3. 建立認證連線
    const authenticatedSocket = this.createAuthenticatedSocket(client, payload);
    this.connectionManager.addConnection(authenticatedSocket);
    
    // 4. 發送連線確認
    client.emit('authenticated', {
      userId: payload.sub,
      tokenId: payload.jti,
      serverTime: new Date().toISOString()
    });
    
  } catch (error) {
    this.logger.error(`Authentication failed: ${error.message}`);
    client.disconnect();
  }
}
```

#### 2.2 訊息廣播邏輯簡化
```typescript
@SubscribeMessage('sendMessage')
async handleMessage(@MessageBody() data: MessagePayload, @ConnectedSocket() client: AuthenticatedSocket) {
  try {
    // 1. 儲存訊息
    const savedMessage = await this.chatClientService.saveMessage(data);
    
    // 2. 取得參與者
    const participantIds = await this.chatClientService.getConversationParticipants(data.conversationId);
    
    // 3. 廣播給所有參與者 (不再需要複雜的設備管理)
    for (const participantId of participantIds) {
      if (participantId !== client.userId) {
        await this.connectionManager.broadcastToUser(participantId, 'newMessage', savedMessage);
      }
    }
    
  } catch (error) {
    client.emit('error', { message: '發送訊息失敗' });
  }
}
```

### Phase 3: Redis 整合 (2-3 天)

#### 3.1 Redis 連線狀態管理
```typescript
// 新建: src/redis/connection-state.service.ts
@Injectable()
export class ConnectionStateService {
  constructor(private redis: Redis) {}
  
  // 記錄用戶在線狀態
  async setUserOnline(userId: string, serverInstanceId: string): Promise<void> {
    await this.redis.hset(`user:${userId}:status`, {
      online: 'true',
      server: serverInstanceId,
      lastSeen: Date.now()
    });
  }
  
  // 檢查用戶在線狀態 (跨服務器實例)
  async isUserOnline(userId: string): Promise<boolean> {
    const status = await this.redis.hget(`user:${userId}:status`, 'online');
    return status === 'true';
  }
  
  // 跨實例訊息廣播
  async broadcastToUser(userId: string, event: string, data: any): Promise<void> {
    await this.redis.publish(`user:${userId}`, JSON.stringify({ event, data }));
  }
}
```

#### 3.2 分散式連線通知
```typescript
// WebSocket Gateway 中整合 Redis Pub/Sub
@Injectable()
export class WebSocketGateway implements OnModuleInit {
  async onModuleInit() {
    // 訂閱用戶特定頻道
    this.redisSubscriber.psubscribe('user:*', (message, channel) => {
      const userId = channel.split(':')[1];
      const localConnections = this.connectionManager.getUserConnections(userId);
      
      if (localConnections.size > 0) {
        const { event, data } = JSON.parse(message);
        localConnections.forEach(socket => socket.emit(event, data));
      }
    });
  }
}
```

### Phase 4: 測試與驗證 (2 天)

#### 4.1 單元測試
```typescript
// 測試檔案: websocket.gateway.spec.ts
describe('WebSocketGateway Token-Based Authentication', () => {
  it('should authenticate valid JWT token', async () => {
    const mockToken = generateValidJWT();
    const mockSocket = createMockSocket({ token: mockToken });
    
    await gateway.handleConnection(mockSocket);
    
    expect(connectionManager.getUserConnections).toHaveBeenCalled();
    expect(mockSocket.emit).toHaveBeenCalledWith('authenticated', expect.any(Object));
  });
  
  it('should replace existing connection with same token', async () => {
    // 測試重連邏輯
  });
  
  it('should handle multiple devices for same user', async () => {
    // 測試多設備連線
  });
});
```

#### 4.2 整合測試腳本
```javascript
// 測試工具更新: websocket-test/index.html
class TokenBasedWebSocketTester {
  constructor() {
    this.accessToken = null;
    this.socket = null;
  }
  
  async connectWithToken(accessToken) {
    // 直接使用 Access Token 連線，不再需要 deviceId
    this.socket = io(WS_BASE, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling']
    });
    
    this.socket.on('authenticated', (data) => {
      console.log('✅ 認證成功:', data);
    });
  }
  
  // 測試重連穩定性
  async testReconnection() {
    this.socket.disconnect();
    setTimeout(() => this.connectWithToken(this.accessToken), 1000);
  }
}
```

---

## 實施時程表

| 階段 | 任務 | 預估工時 | 負責人 | 完成日期 |
|------|------|----------|--------|----------|
| Phase 1 | 準備階段 - 新服務建立 | 16小時 | Backend Team | Day 1-2 |
| Phase 2 | 核心重構 - Gateway改寫 | 24小時 | Backend Team | Day 3-6 |
| Phase 3 | Redis整合 - 分散式管理 | 20小時 | Backend Team | Day 7-9 |
| Phase 4 | 測試驗證 - 完整測試 | 16小時 | QA + Backend | Day 10-11 |
| **總計** | **完整重構專案** | **76小時** | **團隊協作** | **11個工作天** |

---

## 遷移策略

### 階段性部署
1. **灰度發布**: 先在測試環境完整驗證
2. **功能開關**: 實施 Feature Flag，可快速回滾
3. **逐步切換**: 新舊系統並行，逐步遷移用戶

### 向後相容性
```typescript
// 過渡期間的相容處理
async handleConnection(client: Socket) {
  const token = client.handshake.auth.token;
  const legacyDeviceId = client.handshake.query.deviceId;
  
  if (token) {
    // 新的 Token-based 處理
    return this.handleTokenBasedConnection(client, token);
  } else if (legacyDeviceId) {
    // 舊的 Device ID 相容處理 (逐步淘汰)
    this.logger.warn('Legacy device ID connection detected');
    return this.handleLegacyConnection(client, legacyDeviceId);
  } else {
    client.disconnect();
  }
}
```

---

## 風險評估與應對

### 技術風險
| 風險 | 影響度 | 機率 | 應對策略 |
|------|--------|------|----------|
| Token 過期處理 | 高 | 中 | 實施 Token 刷新機制 |
| Redis 連線問題 | 中 | 低 | 本地快取 fallback |
| 並發連線競爭 | 中 | 中 | 原子操作 + 鎖機制 |

### 業務風險
- **用戶體驗中斷**: 採用灰度發布降低風險
- **數據不一致**: 實施完整的資料驗證機制

---

## 成功指標

### 技術指標
- 重連成功率 > 99%
- 連線建立時間 < 500ms
- 記憶體使用量降低 > 30%
- 系統錯誤率 < 0.1%

### 業務指標
- 用戶滿意度提升
- 客服回報問題減少 > 50%
- 系統穩定性提升

---

## 後續優化計劃

### 短期優化 (1個月內)
- 實施連線池優化
- 添加詳細監控指標
- 優化 Redis 快取策略

### 長期規劃 (3個月內)
- 支援 WebRTC 直連
- 實施訊息加密
- 添加 AI 智能路由

---

## 聯絡資訊

**技術負責人**: Development Team  
**專案經理**: Project Manager  
**緊急聯絡**: Emergency Contact

---

*本企畫書為 WebSocket 架構重構的完整實施指南，請各團隊成員詳細閱讀並按計劃執行。*