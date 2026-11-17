# Device Token 資料遷移腳本

本目錄包含 device_tokens collection 資料遷移所需的所有自動化腳本和工具。

---

## 一鍵執行（推薦）

最簡單的執行方式，參考 chat-service 的設計：

```bash
cd ./services/notification-service/scripts
./execute-migration.sh
```

**就這麼簡單！** 腳本會自動完成：
- 檢測容器和連接
- 檢查重複資料
- 備份資料庫
- 執行遷移
- 驗證結果
- 清理臨時文件

---

## 檔案列表

### Shell 腳本（自動化工具）
| 檔案 | 用途 |推薦度 |
|------|------|------|
| `execute-migration.sh` | 一鍵執行完整遷移流程 | **首選** |
| `check-duplicates.sh` | 檢查是否有重複的 deviceId | 獨立工具 |
| `backup-database.sh` | 備份 device_tokens collection | 獨立工具 |
| `migrate-database.sh` | 執行遷移（分步控制） | 進階使用 |
| `rollback-migration.sh` | 回滾到遷移前狀態 | 問題排查 |

### JavaScript 腳本（MongoDB 操作）
| 檔案 | 用途 |
|------|------|
| `1-migrate-device-id-unique.js` | MongoDB 遷移腳本 |
| `2-verify-migration.js` | 驗證遷移結果 |
| `3-rollback.js` | MongoDB 回滾腳本 |

### 文檔
| 檔案 | 用途 |
|------|------|
| `SOP.md` | 標準操作流程（詳細說明） |
| `README.md` | 本文件（快速參考） |

---

## 執行方式

### 方式一：一鍵執行（推薦）

```bash
cd services/notification-service/scripts
./execute-migration.sh
```

適合大部分情況，自動處理所有步驟。

### 方式二：分步執行（進階）

如需精細控制，可以單獨執行各個腳本：

```bash
# 步驟 1：檢查重複資料
./check-duplicates.sh

# 步驟 2：備份資料庫（可選，execute-migration.sh 會自動備份）
./backup-database.sh

# 步驟 3：執行遷移
./migrate-database.sh

# 步驟 4：如需回滾
./rollback-migration.sh
```

---

## 腳本詳細說明

### 1. check-duplicates.sh
檢查資料庫中是否有重複的 deviceId。

**執行**:
```bash
./check-duplicates.sh
```

**輸出**:
- 沒有重複 → 可以直接執行遷移
- 有重複 → 顯示重複記錄詳情和影響評估

---

### 2. backup-database.sh
備份 device_tokens collection。

**執行**:
```bash
./backup-database.sh
```

**備份位置**: 容器內 `/backup/device-tokens-backup-YYYYMMDD-HHMMSS/`

**還原方式**:
```bash
docker exec im_services-mongodb-1 mongorestore \
  --db=messageapp \
  --collection=device_tokens \
  --drop \
  /backup/device-tokens-backup-YYYYMMDD-HHMMSS/messageapp/device_tokens.bson
```

---

### 3. migrate-database.sh
執行完整的遷移流程。

**執行**:
```bash
# 標準模式（包含備份）
./migrate-database.sh

# 跳過備份
./migrate-database.sh --skip-backup
```

**流程**:
1. 備份資料庫
2. 複製腳本到容器
3. 執行遷移
4. 驗證結果
5. 重啟服務（可選）

---

### 4. rollback-database.sh
回滾到遷移前的狀態。

**執行**:
```bash
# 互動模式
./rollback-database.sh

# 完整回滾（包含資料還原）
./rollback-database.sh --restore-data
```

**回滾選項**:
- **選項 1**: 只回滾索引（快速，但不恢復資料）
- **選項 2**: 完整回滾（索引 + 資料還原）

---

## 重要注意事項

### 遷移影響
- 一個 deviceId 在整個系統中只能有一筆記錄
- 不同用戶使用同一 deviceId 註冊會覆蓋舊記錄
- 遷移時會刪除重複的 deviceId（只保留最新的）

### 執行前準備
1. 確認 MongoDB 容器運行中
2. 先執行 `check-duplicates.sh` 了解影響
3. 選擇低流量時段執行
4. 通知團隊成員

### 安全措施
- 所有腳本都會自動檢查容器狀態
- `migrate-database.sh` 預設會先備份資料
- 提供完整的回滾機制
- 詳細的進度顯示和錯誤處理

---

## 技術細節

### 資料庫配置
- **容器名稱**: `im_services-mongodb-1`
- **資料庫名稱**: `messageapp`
- **Collection**: `device_tokens`

### 索引變更
| 項目 | 修改前 | 修改後 |
|------|--------|--------|
| 唯一索引 | `{ userId, deviceId, platform }` | `{ deviceId }` |
| 索引名稱 | `unique_user_device_platform` | `unique_device_id` |
| 唯一性級別 | 用戶 + 設備 + 平台 | 設備全局唯一 |

### 清理邏輯
重複的 deviceId 記錄會被清理，保留規則：
- 依據 `updatedAt` 欄位
- 保留最新的一筆記錄
- 刪除其他舊記錄

---

## 更多資訊

詳細的操作流程、範例輸出、常見問題等，請參考：
- **[SOP.md](./SOP.md)** - 完整的標準操作流程

---

## 🆘 常見問題

### Q: 腳本執行失敗怎麼辦？
A:
1. 檢查錯誤訊息
2. 確認 MongoDB 容器運行中
3. 如果是遷移失敗，執行 `./rollback-database.sh`

### Q: 如何確認遷移成功？
A:
```bash
# 檢查索引
docker exec -it im_services-mongodb-1 mongosh messageapp \
  --eval "db.device_tokens.getIndexes()"

# 檢查是否有重複
./check-duplicates.sh
```

### Q: 備份檔案在哪裡？
A: 在 MongoDB 容器內的 `/backup/device-tokens-backup-YYYYMMDD-HHMMSS/` 目錄

匯出到本機：
```bash
docker cp im_services-mongodb-1:/backup/device-tokens-backup-YYYYMMDD-HHMMSS ./backups/
```

### Q: 遷移會影響服務運行嗎？
A:
- 索引操作通常很快（秒級）
- 建議在低流量時段執行
- 服務可以繼續運行，但註冊請求可能短暫阻塞

---

## 需要幫助？

如果遇到問題：
1. 查看 [SOP.md](./SOP.md) 的詳細說明
2. 檢查腳本輸出的錯誤訊息
3. 聯絡系統管理員或資料庫負責人

---

**最後更新**: 2025-11-10
