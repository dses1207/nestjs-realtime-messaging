# RTC Service - 通話管理微服務

## 概述

RTC Service 是 IM Services 專案中負責語音/視訊通話管理的微服務，整合 LiveKit 作為 WebRTC SFU (Selective Forwarding Unit)，提供企業級的實時通訊功能。

**核心功能：**
- 管理 LiveKit 房間生命週期
- 生成 LiveKit Access Token (JWT)
- 保存通話記錄到 MongoDB
- 與 Chat Service 整合（保存通話訊息）
- 支援 1對1 和群組通話

**技術棧：**
- NestJS 11.x (TypeScript)
- LiveKit Server SDK v2.14.1
- MongoDB (通話記錄)
- gRPC (服務間通訊)

---

## 架構設計

```
WebSocket Server / API Gateway
         │ gRPC
         ↓
    RTC Service
         ├─→ LiveKit Server (gRPC/REST)
         ├─→ MongoDB (通話記錄)
         ├─→ Chat Service (gRPC)
         ├─→ User Service (gRPC)
         └─→ Notification Service (gRPC)
```

---

## gRPC 接口

完整的 gRPC 接口定義請參考：`services/protos/rtc.proto`

### 主要方法

| 方法 | 說明 | 調用者 |
|------|------|--------|
| StartCall | 發起通話 | WebSocket Server |
| GenerateToken | 生成 Token | WebSocket Server |
| EndCall | 結束通話 | WebSocket Server |
| GetCallHistory | 查詢記錄 | API Gateway |
| GetCallStatus | 查詢狀態 | API Gateway |

---

## 快速開始

### 開發模式

```bash
cd services/rtc-service
pnpm install
pnpm run start:dev
```

### Docker 部署

```bash
# 開發環境
./build.sh dev

# 生產環境  
./build.sh prod
```

---

## 詳細文檔

請參考主專案文檔：
- [LiveKit 整合計劃書](../../LIVEKIT-INTEGRATION-PLAN.md)
- [後端架構說明](../../後端架構說明.md)

---

**版本**: v1.0.0  
**建立日期**: 2025-11-18  
**LiveKit SDK**: v2.14.1
