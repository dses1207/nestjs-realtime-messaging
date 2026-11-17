#!/bin/bash

###############################################################################
# Device Token 資料遷移 - 一鍵執行腳本
#
# 用途：自動執行完整的遷移流程（參考 chat-service 的 EXECUTE-TEST.sh）
# 使用方式：./execute-migration.sh
#
# 執行步驟：
#   [0/6] 確認容器和連接
#   [1/6] 檢查重複的 deviceId
#   [2/6] 備份資料庫
#   [3/6] 上傳腳本到容器
#   [4/6] 執行資料遷移
#   [5/6] 驗證遷移結果
#   [6/6] 清理臨時文件
###############################################################################

set -e  # 遇到錯誤立即停止

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# 配置
DB_NAME="messageapp"
COLLECTION="device_tokens"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Device Token 資料庫遷移工具        ║${NC}"
echo -e "${CYAN}║   DeviceId 全局唯一性遷移             ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}\n"

# ========================================
# [步驟 0/6] 確認容器名稱和資料庫連接
# ========================================
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}[步驟 0/6] 確認容器名稱和資料庫連接${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}🔍 自動檢測 MongoDB 容器...${NC}"

# 自動檢測容器名稱（優先使用 image 匹配）
CONTAINER_NAME=$(docker ps --filter "ancestor=mongo:8.0" --format "{{.Names}}" 2>/dev/null | head -n 1)

# 如果沒找到，嘗試用名稱匹配
if [ -z "$CONTAINER_NAME" ]; then
    CONTAINER_NAME=$(docker ps --filter "name=mongodb" --format "{{.Names}}" 2>/dev/null | head -n 1)
fi

# 如果還是沒找到，報錯
if [ -z "$CONTAINER_NAME" ]; then
    echo -e "${RED}❌ 找不到 MongoDB 容器！${NC}"
    echo -e "${YELLOW}請確認容器正在運行：${NC}"
    echo -e "  ${BLUE}docker ps | grep mongo${NC}\n"
    exit 1
fi

echo -e "  容器名稱: ${GREEN}$CONTAINER_NAME${NC}"

# 驗證資料庫連接
echo -e "\n${YELLOW}🔍 驗證資料庫連接...${NC}"
if ! docker exec "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
    echo -e "${RED}❌ 無法連接到資料庫！${NC}"
    exit 1
fi

echo -e "  資料庫: ${GREEN}$DB_NAME${NC}"
echo -e "  Collection: ${GREEN}$COLLECTION${NC}"

# 統計當前資料
TOTAL_COUNT=$(docker exec "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet --eval "db.$COLLECTION.countDocuments()" 2>/dev/null | tail -1)
echo -e "  總記錄數: ${GREEN}$TOTAL_COUNT${NC}\n"

echo -e "${GREEN}✅ 容器和資料庫連接正常${NC}\n"

# ========================================
# [步驟 1/6] 檢查重複的 deviceId
# ========================================
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}[步驟 1/6] 檢查重複的 deviceId${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}🔍 檢查是否有重複的 deviceId...${NC}\n"

DUPLICATES=$(docker exec "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet --eval "
  const duplicates = db.$COLLECTION.aggregate([
    { \$group: { _id: '\$deviceId', count: { \$sum: 1 } } },
    { \$match: { count: { \$gt: 1 } } }
  ]).toArray();
  print(duplicates.length);
" 2>/dev/null | tail -1)

if [ "$DUPLICATES" = "0" ]; then
    echo -e "${GREEN}✅ 沒有重複的 deviceId${NC}\n"
else
    echo -e "${YELLOW}⚠️  發現 $DUPLICATES 個重複的 deviceId${NC}"
    echo -e "${YELLOW}遷移時會保留最新的記錄，刪除舊記錄${NC}\n"

    echo -e "${YELLOW}是否繼續執行遷移？(y/N)${NC} "
    read -r CONTINUE_CONFIRM

    if [ "$CONTINUE_CONFIRM" != "y" ] && [ "$CONTINUE_CONFIRM" != "Y" ]; then
        echo -e "\n${YELLOW}已取消遷移${NC}"
        echo -e "${BLUE}提示：執行 ./check-duplicates.sh 查看詳細資訊${NC}\n"
        exit 0
    fi
    echo ""
fi

# ========================================
# [步驟 2/6] 備份資料庫
# ========================================
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}[步驟 2/6] 備份資料庫${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backup/device-tokens-backup-$TIMESTAMP"

echo -e "${YELLOW}📦 備份資料到容器內...${NC}"
echo -e "  備份位置: ${BLUE}$BACKUP_DIR${NC}\n"

BACKUP_OUTPUT=$(docker exec "$CONTAINER_NAME" mongodump \
    --username="admin" \
    --password="admin_password" \
    --authenticationDatabase="admin" \
    --db="$DB_NAME" \
    --collection="$COLLECTION" \
    --out="$BACKUP_DIR" 2>&1)

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 備份完成${NC}\n"

    # 驗證備份檔案
    BACKUP_SIZE=$(docker exec "$CONTAINER_NAME" sh -c "
        if [ -f '$BACKUP_DIR/$DB_NAME/$COLLECTION.bson' ]; then
            ls -lh '$BACKUP_DIR/$DB_NAME/$COLLECTION.bson' | awk '{print \$5}'
        else
            echo 'NOT_FOUND'
        fi
    " 2>/dev/null)

    if [ "$BACKUP_SIZE" != "NOT_FOUND" ]; then
        echo -e "  備份檔案大小: ${GREEN}$BACKUP_SIZE${NC}"
    fi
else
    echo -e "${RED}❌ 備份失敗！${NC}"
    echo "$BACKUP_OUTPUT"
    exit 1
fi

echo ""

# ========================================
# [步驟 3/6] 上傳腳本到容器
# ========================================
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}[步驟 3/6] 上傳腳本到容器${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}📤 複製 MongoDB 腳本到容器 /tmp/...${NC}\n"

# 複製腳本到容器的 /tmp 目錄（臨時目錄）
docker cp "$SCRIPT_DIR/1-migrate-device-id-unique.js" "$CONTAINER_NAME:/tmp/" 2>/dev/null
docker cp "$SCRIPT_DIR/2-verify-migration.js" "$CONTAINER_NAME:/tmp/" 2>/dev/null
docker cp "$SCRIPT_DIR/3-rollback.js" "$CONTAINER_NAME:/tmp/" 2>/dev/null

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 腳本上傳完成${NC}"
    echo -e "  • 1-migrate-device-id-unique.js"
    echo -e "  • 2-verify-migration.js"
    echo -e "  • 3-rollback.js\n"
else
    echo -e "${RED}❌ 腳本上傳失敗！${NC}\n"
    exit 1
fi

# ========================================
# [步驟 4/6] 執行資料遷移
# ========================================
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}[步驟 4/6] 執行資料遷移${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}⚙️  執行遷移腳本...${NC}\n"
echo -e "${CYAN}--- 遷移腳本輸出開始 ---${NC}\n"

# 從容器外執行 MongoDB 腳本（標準做法）
MIGRATION_OUTPUT=$(docker exec -i "$CONTAINER_NAME" mongosh "$DB_NAME" < "$SCRIPT_DIR/1-migrate-device-id-unique.js" 2>&1)
MIGRATION_EXIT_CODE=$?

echo "$MIGRATION_OUTPUT"

echo -e "\n${CYAN}--- 遷移腳本輸出結束 ---${NC}\n"

if [ $MIGRATION_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}❌ 遷移腳本執行失敗！${NC}\n"
    exit 1
fi

# 檢查輸出中是否有成功標記
if echo "$MIGRATION_OUTPUT" | grep -q "✅ 資料遷移完成"; then
    echo -e "${GREEN}✅ 遷移執行成功${NC}\n"
else
    echo -e "${YELLOW}⚠️  請檢查上方輸出日誌${NC}\n"
fi

# ========================================
# [步驟 5/6] 驗證遷移結果
# ========================================
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}[步驟 5/6] 驗證遷移結果${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}🔍 執行驗證腳本...${NC}\n"
echo -e "${CYAN}--- 驗證腳本輸出開始 ---${NC}\n"

VERIFY_OUTPUT=$(docker exec -i "$CONTAINER_NAME" mongosh "$DB_NAME" < "$SCRIPT_DIR/2-verify-migration.js" 2>&1)
VERIFY_EXIT_CODE=$?

echo "$VERIFY_OUTPUT"

echo -e "\n${CYAN}--- 驗證腳本輸出結束 ---${NC}\n"

if [ $VERIFY_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}❌ 驗證腳本執行失敗！${NC}\n"
    exit 1
fi

# 檢查驗證結果
if echo "$VERIFY_OUTPUT" | grep -q "✅ 所有檢查通過"; then
    echo -e "${GREEN}✅ 驗證通過${NC}\n"
    VERIFICATION_PASSED=true
else
    echo -e "${YELLOW}⚠️  部分驗證未通過，請檢查上方日誌${NC}\n"
    VERIFICATION_PASSED=false
fi

# ========================================
# [步驟 6/6] 清理臨時文件
# ========================================
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}[步驟 6/6] 清理臨時文件${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}🧹 清理容器內的臨時腳本...${NC}"

docker exec "$CONTAINER_NAME" rm -f /tmp/1-migrate-device-id-unique.js 2>/dev/null
docker exec "$CONTAINER_NAME" rm -f /tmp/2-verify-migration.js 2>/dev/null
docker exec "$CONTAINER_NAME" rm -f /tmp/3-rollback.js 2>/dev/null

echo -e "${GREEN}✅ 臨時文件已清理${NC}\n"

# ========================================
# 最終總結
# ========================================
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
if [ "$VERIFICATION_PASSED" = true ]; then
    echo -e "${CYAN}║         ${GREEN}✅ 遷移成功完成！${CYAN}            ║${NC}"
else
    echo -e "${CYAN}║      ${YELLOW}⚠️  遷移完成但有警告${CYAN}           ║${NC}"
fi
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}\n"

echo -e "${BOLD}${BLUE}遷移摘要：${NC}"
echo -e "  容器: ${YELLOW}$CONTAINER_NAME${NC}"
echo -e "  資料庫: ${YELLOW}$DB_NAME${NC}"
echo -e "  Collection: ${YELLOW}$COLLECTION${NC}"
echo -e "  新索引: ${GREEN}{ deviceId: 1 } (唯一)${NC}"
echo -e "  舊索引: ${RED}已刪除${NC}"
echo -e "  備份位置: ${BLUE}$BACKUP_DIR${NC}\n"

echo -e "${BOLD}${YELLOW}⚠️  重要提醒：${NC}"
echo -e "  • 一個 deviceId 現在只能對應一個用戶"
echo -e "  • 不同用戶使用同一 deviceId 註冊會覆蓋舊記錄"
echo -e "  • 請記得重啟 notification-service 讓新 schema 生效\n"

echo -e "${BOLD}${GREEN}下一步：${NC}"
echo -e "  1. 重啟服務: ${YELLOW}docker-compose restart notification-service${NC}"
echo -e "  2. 檢查日誌: ${YELLOW}docker-compose logs -f notification-service${NC}"
echo -e "  3. 測試推播功能\n"

echo -e "${BOLD}${BLUE}如需回滾：${NC}"
echo -e "  執行: ${YELLOW}./rollback-migration.sh${NC}"
echo -e "  備份: ${BLUE}容器內 $BACKUP_DIR${NC}\n"
