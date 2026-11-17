#!/bin/bash

###############################################################################
# 執行 device_tokens 資料庫遷移
#
# 用途：自動執行完整的遷移流程
# 使用方式：./migrate-database.sh [--skip-backup]
###############################################################################

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# 配置
DB_NAME="messageapp"
COLLECTION="device_tokens"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_BACKUP=false

# 自動檢測容器名稱
CONTAINER_NAME=$(docker ps --filter "ancestor=mongo:8.0" --format "{{.Names}}" 2>/dev/null | head -n 1)
if [ -z "$CONTAINER_NAME" ]; then
    CONTAINER_NAME=$(docker ps --filter "name=mongodb" --format "{{.Names}}" 2>/dev/null | head -n 1)
fi

# 處理參數
if [ "$1" = "--skip-backup" ]; then
    SKIP_BACKUP=true
    echo -e "${YELLOW}⚠️  跳過備份步驟（使用 --skip-backup 參數）${NC}\n"
fi

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   device_tokens 資料庫遷移工具        ║${NC}"
echo -e "${CYAN}║   DeviceId 全局唯一性遷移             ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}\n"

# 檢查容器是否檢測到
echo -e "${YELLOW}[預檢]${NC} 檢查 MongoDB 容器狀態..."
if [ -z "$CONTAINER_NAME" ]; then
    echo -e "${RED}❌ MongoDB 容器未運行！${NC}"
    echo -e "請先啟動容器: ${YELLOW}docker-compose up -d mongodb${NC}"
    exit 1
fi
echo -e "${GREEN}✅ MongoDB 容器運行中${NC} (${CONTAINER_NAME})\n"

# 步驟 1: 備份資料庫
if [ "$SKIP_BACKUP" = false ]; then
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo -e "${BLUE}步驟 1/5: 備份資料庫${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}\n"

    if [ -f "$SCRIPT_DIR/backup-database.sh" ]; then
        bash "$SCRIPT_DIR/backup-database.sh"
        if [ $? -ne 0 ]; then
            echo -e "\n${RED}❌ 備份失敗，終止遷移！${NC}"
            exit 1
        fi
    else
        echo -e "${RED}❌ 找不到備份腳本: backup-database.sh${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️  步驟 1/5: 跳過備份${NC}\n"
fi

# 步驟 2: 複製遷移腳本到容器
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}步驟 2/5: 複製遷移腳本到容器${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "複製 JavaScript 腳本到容器 /tmp/..."

# 複製腳本到 /tmp（臨時目錄，符合標準實踐）
docker cp "$SCRIPT_DIR/1-migrate-device-id-unique.js" "$CONTAINER_NAME:/tmp/" 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 複製遷移腳本失敗！${NC}"
    exit 1
fi

docker cp "$SCRIPT_DIR/2-verify-migration.js" "$CONTAINER_NAME:/tmp/" 2>/dev/null
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 複製驗證腳本失敗！${NC}"
    exit 1
fi

echo -e "${GREEN}✅ 腳本複製完成${NC}"
echo -e "  • 1-migrate-device-id-unique.js"
echo -e "  • 2-verify-migration.js\n"

# 步驟 3: 執行遷移腳本
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}步驟 3/5: 執行資料遷移${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}提示：${NC}遷移過程中會顯示詳細日誌\n"
echo -e "${CYAN}--- 開始執行遷移腳本 ---${NC}\n"

MIGRATION_OUTPUT=$(docker exec -i "$CONTAINER_NAME" mongosh "$DB_NAME" < "$SCRIPT_DIR/1-migrate-device-id-unique.js" 2>&1)
MIGRATION_EXIT_CODE=$?

echo "$MIGRATION_OUTPUT"

echo -e "\n${CYAN}--- 遷移腳本執行完畢 ---${NC}\n"

if [ $MIGRATION_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}❌ 遷移腳本執行失敗！${NC}"
    echo -e "${YELLOW}建議：${NC}"
    echo -e "  1. 檢查上方錯誤訊息"
    echo -e "  2. 如需回滾，執行: ${YELLOW}./rollback-database.sh${NC}"
    exit 1
fi

# 檢查是否成功（簡單檢查輸出中是否有成功標記）
if echo "$MIGRATION_OUTPUT" | grep -q "✅ 資料遷移完成"; then
    echo -e "${GREEN}✅ 遷移執行成功${NC}\n"
else
    echo -e "${YELLOW}⚠️  遷移可能未完全成功，請檢查上方日誌${NC}\n"
fi

# 步驟 4: 執行驗證
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}步驟 4/5: 驗證遷移結果${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${CYAN}--- 開始執行驗證腳本 ---${NC}\n"

VERIFY_OUTPUT=$(docker exec -i "$CONTAINER_NAME" mongosh "$DB_NAME" < "$SCRIPT_DIR/2-verify-migration.js" 2>&1)
VERIFY_EXIT_CODE=$?

echo "$VERIFY_OUTPUT"

echo -e "\n${CYAN}--- 驗證腳本執行完畢 ---${NC}\n"

if [ $VERIFY_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}❌ 驗證腳本執行失敗！${NC}"
    exit 1
fi

# 檢查驗證結果
if echo "$VERIFY_OUTPUT" | grep -q "✅ 所有檢查通過"; then
    echo -e "${GREEN}✅ 驗證通過${NC}\n"
    VERIFICATION_PASSED=true
else
    echo -e "${YELLOW}⚠️  部分驗證失敗，請檢查上方日誌${NC}\n"
    VERIFICATION_PASSED=false
fi

# 步驟 5: 重啟服務
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}步驟 5/5: 重啟 notification-service${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}是否要重啟 notification-service？${NC}"
echo -e "（讓新的 schema 定義生效）\n"
echo -e "輸入 ${GREEN}y${NC} 重啟，其他鍵跳過: "
read -r RESTART_CONFIRM

if [ "$RESTART_CONFIRM" = "y" ] || [ "$RESTART_CONFIRM" = "Y" ]; then
    echo -e "\n重啟服務中..."

    # 檢查是否使用 docker-compose
    if [ -f "$(dirname "$SCRIPT_DIR")/docker-compose.yml" ]; then
        cd "$(dirname "$SCRIPT_DIR")" && docker-compose restart notification-service
        if [ $? -eq 0 ]; then
            echo -e "${GREEN}✅ 服務重啟成功${NC}\n"
        else
            echo -e "${YELLOW}⚠️  重啟失敗，請手動重啟${NC}\n"
        fi
    else
        echo -e "${YELLOW}⚠️  找不到 docker-compose.yml，請手動重啟服務${NC}\n"
    fi
else
    echo -e "\n${YELLOW}跳過重啟${NC}"
    echo -e "${BLUE}提醒：${NC}請記得手動重啟 notification-service\n"
fi

# 最終總結
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
if [ "$VERIFICATION_PASSED" = true ]; then
    echo -e "${CYAN}║         ${GREEN}✅ 遷移成功完成！${CYAN}            ║${NC}"
else
    echo -e "${CYAN}║      ${YELLOW}⚠️  遷移完成但有警告${CYAN}           ║${NC}"
fi
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}\n"

echo -e "${BLUE}遷移摘要：${NC}"
echo -e "  資料庫: ${YELLOW}$DB_NAME${NC}"
echo -e "  Collection: ${YELLOW}$COLLECTION${NC}"
echo -e "  新索引: ${GREEN}{ deviceId: 1 } (唯一)${NC}"
echo -e "  舊索引: ${RED}已刪除${NC}\n"

echo -e "${YELLOW}重要提醒：${NC}"
echo -e "  • 一個 deviceId 現在只能對應一個用戶"
echo -e "  • 不同用戶使用同一 deviceId 註冊會覆蓋舊記錄"
echo -e "  • 建議監控推播功能是否正常\n"

if [ "$SKIP_BACKUP" = false ] && [ -f /tmp/last-device-tokens-backup.txt ]; then
    BACKUP_PATH=$(cat /tmp/last-device-tokens-backup.txt)
    echo -e "${BLUE}備份位置：${NC}"
    echo -e "  ${YELLOW}容器內: $BACKUP_PATH${NC}\n"
    echo -e "${YELLOW}如需回滾：${NC}"
    echo -e "  ${BLUE}./rollback-database.sh${NC}\n"
fi

echo -e "${GREEN}下一步：${NC}"
echo -e "  1. 檢查服務日誌: ${YELLOW}docker-compose logs -f notification-service${NC}"
echo -e "  2. 測試推播功能"
echo -e "  3. 監控錯誤日誌\n"
