# Notification Service

推播通知服務，支援 FCM (Firebase Cloud Messaging) 和 APNs (Apple Push Notification service) 推播通知。

## 功能特點

- **FCM 推播通知**：支援 Android 設備推播通知
- **APNs 推播通知**：支援 iOS 設備推播通知
- **推播設定管理**：用戶可自訂推播通知偏好設定
- **裝置 Token 管理**：管理用戶的多個裝置 Token
- **推播歷史記錄**：記錄推播通知的發送狀態和結果
- **內部 gRPC 通訊**：與其他微服務透過 gRPC 通訊

## 系統架構

```
Chat Service ──gRPC──→ Notification Service ──FCM/APNs──→ 用戶裝置
      ↓                        ↓
   儲存訊息              檢查推播設定
                          記錄推播歷史
```

## 環境變數

### MongoDB 設定
- `MONGODB_URI`: MongoDB 連接字串

### FCM 設定
- `FCM_PROJECT_ID`: Firebase 專案 ID
- `FCM_PRIVATE_KEY`: Firebase 私鑰
- `FCM_CLIENT_EMAIL`: Firebase 客戶端 Email

### APNs 設定
- `APNS_KEY_PATH`: APNs 私鑰檔案路徑 (.p8 檔案)
- `APNS_KEY_ID`: APNs 金鑰 ID
- `APNS_TEAM_ID`: Apple 開發者團隊 ID
- `APNS_BUNDLE_ID`: iOS 應用程式 Bundle ID

## gRPC API 規格

### SendNotification
- **請求**: SendNotificationRequest
  - userId (string): 用戶ID
  - type (string): 通知類型 (new_message, group_invite, group_message)
  - title (string): 通知標題
  - body (string): 通知內容
  - data (string): JSON 字串，包含附加數據
- **回應**: SendNotificationResponse
  - success (bool): 是否成功
  - message (string): 結果訊息
- **錯誤碼**:
  - 3 (INVALID_ARGUMENT): 參數錯誤

### SendMessageNotification
- **請求**: SendMessageNotificationRequest
  - userId (string): 用戶ID
  - type (string): 通知類型 (new_message, group_invite, group_message)
  - senderName (string): 發送者名稱
  - content (string): 訊息內容
  - conversationName (string, optional): 對話名稱 (群組訊息和邀請時使用)
  - senderId (string, optional): 發送者ID
  - conversationId (string, optional): 對話ID
  - language (string, optional): 語言設定，預設為 'zh-TW'
- **回應**: SendMessageNotificationResponse
  - success (bool): 是否成功
  - message (string): 結果訊息
- **錯誤碼**:
  - 3 (INVALID_ARGUMENT): 參數錯誤

### RegisterDeviceToken
- **請求**: RegisterDeviceTokenRequest
  - userId (string): 用戶ID
  - token (string): 設備 Token
  - platform (string): 平台 (fcm, apns)
  - deviceId (string): 設備ID
  - appVersion (string): 應用程式版本
  - environment (string, optional): 環境 (development, production)，預設為 production
- **回應**: RegisterDeviceTokenResponse
  - success (bool): 是否成功
  - message (string): 結果訊息
- **錯誤碼**:
  - 3 (INVALID_ARGUMENT): 參數錯誤
- **重要說明**:
  - **一個 deviceId 在整個系統中只能有一筆記錄**
  - 如果不同用戶使用同一 deviceId 註冊，會覆蓋前一個用戶的記錄
  - 同一設備切換平台時（如從 fcm 切換到 apns），會更新 platform 欄位
  - 實現「設備搶占」機制，最後註冊的用戶獲得推播權限

### UpdateNotificationSettings
- **請求**: UpdateNotificationSettingsRequest
  - userId (string): 用戶ID
  - newMessage (bool, optional): 新訊息通知開關
  - groupInvite (bool, optional): 群組邀請通知開關
  - groupMessage (bool, optional): 群組訊息通知開關
- **回應**: UpdateNotificationSettingsResponse
  - success (bool): 是否成功
  - message (string): 結果訊息
- **錯誤碼**:
  - 3 (INVALID_ARGUMENT): 參數錯誤

### GetNotificationSettings
- **請求**: GetNotificationSettingsRequest
  - userId (string): 用戶ID
- **回應**: GetNotificationSettingsResponse
  - settings (NotificationSettings): 用戶的推播設定
- **錯誤碼**:
  - 5 (NOT_FOUND): 找不到設定

### RemoveDeviceToken
- **請求**: RemoveDeviceTokenRequest
  - userId (string): 用戶ID
  - token (string): 設備 Token
- **回應**: RemoveDeviceTokenResponse
  - success (bool): 是否成功
  - message (string): 結果訊息
- **錯誤碼**:
  - 3 (INVALID_ARGUMENT): 參數錯誤

### GetNotificationHistory
- **請求**: GetNotificationHistoryRequest
  - userId (string): 用戶ID
  - limit (int32, optional): 回傳記錄數量上限，預設 20
  - offset (int32, optional): 偏移量，預設 0
  - type (string, optional): 通知類型篩選
  - startDate (string, optional): 開始日期 (ISO 8601 格式)
  - endDate (string, optional): 結束日期 (ISO 8601 格式)
- **回應**: GetNotificationHistoryResponse
  - notifications (NotificationHistory[]): 通知歷史記錄列表
  - total (int32): 總記錄數
  - hasMore (bool): 是否還有更多記錄
- **錯誤碼**:
  - 3 (INVALID_ARGUMENT): 參數錯誤

## 推播通知類型

1. **new_message**: 新訊息通知
2. **group_invite**: 群組邀請通知
3. **group_message**: 群組訊息通知

## 資料庫結構

### device_tokens 集合
- **用途**: 儲存用戶的裝置 Token
- **平台支援**: FCM 和 APNs
- **唯一性約束**: `deviceId` 欄位具有全局唯一索引
  - 一個 deviceId 在整個系統中只能有一筆記錄
  - 同一設備的不同用戶註冊會覆蓋舊記錄
- **欄位說明**:
  - `userId`: 用戶 ObjectId（參考 User collection）
  - `deviceId`: 設備唯一識別符（**全局唯一**）
  - `token`: FCM/APNs 推播 Token
  - `platform`: 平台類型（fcm 或 apns）
  - `appVersion`: 應用程式版本
  - `environment`: 環境（development 或 production）
  - `lastUsed`: 最後使用時間
  - `createdAt`: 建立時間
  - `updatedAt`: 更新時間
- **索引**:
  - `{ deviceId: 1 }` - 唯一索引（主要約束）
  - `{ token: 1 }` - 查詢優化
  - `{ userId: 1 }` - 查詢優化

### notification_settings 集合
- 儲存用戶的推播偏好設定
- 支援各種推播類型的開關控制

### notification_history 集合
- 記錄推播通知的發送歷史
- 包含發送狀態和錯誤資訊

## 詳細流程介紹

### 1. 註冊 Device Token
1. 客戶端啟動時，向 FCM/APNs 請求 Token。
2. 客戶端調用 `RegisterDeviceToken` gRPC 方法，將 Token 和相關資訊註冊到 Notification Service。
3. Notification Service 驗證並儲存 Token。

### 2. 管理推播設定
1. 客戶端調用 `GetNotificationSettings` 取得用戶當前的推播設定。
2. 用戶在客戶端修改設定。
3. 客戶端調用 `UpdateNotificationSettings` 更新設定到 Notification Service。

### 3. 推播通知觸發
1. Chat Service 準備好要發送的新訊息。
2. Chat Service 調用 `SendMessageNotification` gRPC 方法。
3. Notification Service 檢查用戶的推播設定和在線狀態。
4. 如果需要發送推播，Notification Service 獲取用戶的設備 Token。
5. Notification Service 通過 FCM/APNs 發送推播通知。
6. Notification Service 記錄推播歷史。

### 4. 查詢推播歷史
1. 客戶端調用 `GetNotificationHistory` gRPC 方法。
2. Notification Service 根據查詢條件從資料庫中檢索歷史記錄。
3. Notification Service 返回歷史記錄給客戶端。

## 前端整合指南

### Android (FCM)
1. 在 `build.gradle` 中添加 FCM 依賴。
2. 在 `AndroidManifest.xml` 中配置 FCM。
3. 在 `FirebaseMessagingService` 的 `onNewToken` 方法中獲取 Token。
4. 在應用程式啟動時，調用後端 API (通過 API Gateway) 或直接調用 Notification Service 的 gRPC 方法註冊 Token。

### iOS (APNs)
1. 在 Xcode 中配置 APNs。
2. 在 `AppDelegate` 的 `didRegisterForRemoteNotificationsWithDeviceToken` 方法中獲取 Token。
3. 在應用程式啟動時，調用後端 API (通過 API Gateway) 或直接調用 Notification Service 的 gRPC 方法註冊 Token。

### 通用流程
1. 客戶端獲取到 Token 後，應立即調用 `RegisterDeviceToken` 註冊。
2. 客戶端應提供 UI 讓用戶管理推播設定，並在設定變更時調用 `UpdateNotificationSettings`。
3. 客戶端應處理接收到的推播通知，根據 `data` 中的資訊進行相應的操作（如跳轉到對話頁面）。

## 使用方式

1. 客戶端註冊裝置 Token
2. 設定推播通知偏好
3. 其他服務透過 gRPC 請求發送推播通知
4. 系統根據用戶設定決定是否發送推播
5. 記錄推播發送結果

## 部署

### 開發環境
```bash
docker-compose -f docker-compose.dev.yml up notification-service
```

### 生產環境
```bash
docker-compose -f docker-compose.prod.yml up notification-service
```

## 端口

- **gRPC Port**: 50056 (內部通訊)

## 整合說明

此服務已整合到現有的微服務架構中，通過 gRPC 與其他服務通訊。主要整合點：

1. **Chat Service**: 當有新訊息時觸發推播通知
2. **API Gateway**: 提供推播設定和裝置管理的 HTTP API
3. **User Service**: 用戶資料同步

## 資料遷移

如果您從舊版本升級，並且需要將 deviceId 唯一性約束從「用戶 + 設備 + 平台」改為「設備」級別，請執行以下遷移腳本：

### 執行遷移

```bash
# 1. 備份資料庫（強烈建議！）
docker exec im_services-mongodb-1 mongodump \
  --db=im_service \
  --collection=device_tokens \
  --out=/backup/before-migration-$(date +%Y%m%d-%H%M%S)

# 2. 複製腳本到容器
docker cp ./scripts/1-migrate-device-id-unique.js im_services-mongodb-1:/scripts/
docker cp ./scripts/2-verify-migration.js im_services-mongodb-1:/scripts/
docker cp ./scripts/3-rollback.js im_services-mongodb-1:/scripts/

# 3. 執行遷移
docker exec -i im_services-mongodb-1 mongosh im_service < scripts/1-migrate-device-id-unique.js

# 4. 驗證結果
docker exec -i im_services-mongodb-1 mongosh im_service < scripts/2-verify-migration.js
```

### 回滾（如果需要）

```bash
# 執行回滾腳本
docker exec -i im_services-mongodb-1 mongosh im_service < scripts/3-rollback.js
```

詳細的遷移說明請參考：[scripts/SOP.md](./scripts/SOP.md)

## 注意事項

- FCM 和 APNs 需要相應的憑證和設定
- 推播通知的發送成功率會受到裝置狀態和網路環境影響
- 建議定期清理無效的裝置 Token
- **deviceId 全局唯一性限制**：
  - 一個 deviceId 在整個系統中只能對應一個用戶
  - 設備共用或 deviceId 衝突會導致推播覆蓋
  - 建議在客戶端確保 deviceId 的唯一性和安全性