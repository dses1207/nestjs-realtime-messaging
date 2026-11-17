#!/bin/bash

###############################################################################
# 回滾 device_tokens 資料庫遷移
#
# 用途：回滾到遷移前的狀態
# 使用方式：./rollback-database.sh [--restore-data]
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
RESTORE_DATA=false

# 自動檢測容器名稱
CONTAINER_NAME=$(docker ps --filter "ancestor=mongo:8.0" --format "{{.Names}}" 2>/dev/null | head -n 1)
if [ -z "$CONTAINER_NAME" ]; then
    CONTAINER_NAME=$(docker ps --filter "name=mongodb" --format "{{.Names}}" 2>/dev/null | head -n 1)
fi

# 處理參數
if [ "$1" = "--restore-data" ]; then
    RESTORE_DATA=true
fi

echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║      資料庫遷移回滾工具               ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}\n"

echo -e "${RED}⚠️  警告：此操作將回滾資料庫變更${NC}\n"

# 檢查容器是否檢測到
echo -e "${YELLOW}[預檢]${NC} 檢查 MongoDB 容器狀態..."
if [ -z "$CONTAINER_NAME" ]; then
    echo -e "${RED}❌ MongoDB 容器未運行！${NC}"
    exit 1
fi
echo -e "${GREEN}✅ MongoDB 容器運行中${NC} (${CONTAINER_NAME})\n"

# 顯示回滾選項
echo -e "${BLUE}回滾選項：${NC}\n"
echo -e "  1. ${YELLOW}只回滾索引${NC}（恢復舊的索引結構）"
echo -e "     • 刪除新索引: unique_device_id"
echo -e "     • 建立舊索引: unique_user_device_platform"
echo -e "     • ${RED}無法恢復已刪除的重複資料${NC}\n"

echo -e "  2. ${YELLOW}完整回滾${NC}（索引 + 資料）"
echo -e "     • 回滾索引結構"
echo -e "     • 從備份還原資料"
echo -e "     • ${GREEN}可以恢復遷移前的所有資料${NC}\n"

if [ "$RESTORE_DATA" = false ]; then
    echo -e "${YELLOW}您要執行哪種回滾？${NC}"
    echo -e "  輸入 ${GREEN}1${NC} = 只回滾索引"
    echo -e "  輸入 ${GREEN}2${NC} = 完整回滾（需要備份）"
    echo -e "  輸入 ${RED}q${NC} = 取消\n"
    read -r ROLLBACK_OPTION

    case $ROLLBACK_OPTION in
        1)
            RESTORE_DATA=false
            ;;
        2)
            RESTORE_DATA=true
            ;;
        q|Q)
            echo -e "\n${YELLOW}已取消回滾${NC}\n"
            exit 0
            ;;
        *)
            echo -e "\n${RED}❌ 無效的選項${NC}\n"
            exit 1
            ;;
    esac
fi

echo ""

# ========================================
# 步驟 1: 回滾索引
# ========================================
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}步驟 1/3: 回滾索引結構${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

# 複製回滾腳本到容器 /tmp
echo -e "複製回滾腳本到容器 /tmp/..."
docker cp "$SCRIPT_DIR/3-rollback.js" "$CONTAINER_NAME:/tmp/" 2>/dev/null

if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 複製回滾腳本失敗！${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 腳本複製完成${NC}\n"

# 執行回滾腳本
echo -e "${CYAN}--- 開始執行回滾腳本 ---${NC}\n"

ROLLBACK_OUTPUT=$(docker exec -i "$CONTAINER_NAME" mongosh "$DB_NAME" < "$SCRIPT_DIR/3-rollback.js" 2>&1)
ROLLBACK_EXIT_CODE=$?

echo "$ROLLBACK_OUTPUT"

echo -e "\n${CYAN}--- 回滾腳本執行完畢 ---${NC}\n"

if [ $ROLLBACK_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}❌ 索引回滾失敗！${NC}"
    exit 1
fi

if echo "$ROLLBACK_OUTPUT" | grep -q "✅ 回滾成功"; then
    echo -e "${GREEN}✅ 索引回滾成功${NC}\n"
else
    echo -e "${YELLOW}⚠️  索引回滾可能未完全成功，請檢查上方日誌${NC}\n"
fi

# ========================================
# 步驟 2: 還原資料（如果需要）
# ========================================
if [ "$RESTORE_DATA" = true ]; then
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo -e "${BLUE}步驟 2/3: 還原資料${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}\n"

    # 查找最近的備份
    if [ -f /tmp/last-device-tokens-backup.txt ]; then
        BACKUP_PATH=$(cat /tmp/last-device-tokens-backup.txt)
        echo -e "找到最近的備份: ${YELLOW}$BACKUP_PATH${NC}\n"
    else
        echo -e "${YELLOW}未找到自動備份記錄${NC}"
        echo -e "請手動輸入備份路徑（容器內路徑）："
        echo -e "例如: ${BLUE}/backup/device-tokens-backup-20251110-123456${NC}\n"
        read -r BACKUP_PATH

        if [ -z "$BACKUP_PATH" ]; then
            echo -e "\n${RED}❌ 未提供備份路徑，跳過資料還原${NC}\n"
            RESTORE_DATA=false
        fi
    fi

    if [ "$RESTORE_DATA" = true ]; then
        # 驗證備份是否存在
        echo -e "驗證備份檔案..."
        BACKUP_CHECK=$(docker exec "$CONTAINER_NAME" sh -c "
            if [ -f '$BACKUP_PATH/$DB_NAME/$COLLECTION.bson' ]; then
                echo 'EXISTS'
            else
                echo 'NOT_FOUND'
            fi
        " 2>/dev/null)

        if [ "$BACKUP_CHECK" != "EXISTS" ]; then
            echo -e "${RED}❌ 備份檔案不存在: $BACKUP_PATH/$DB_NAME/$COLLECTION.bson${NC}"
            echo -e "${YELLOW}跳過資料還原${NC}\n"
        else
            echo -e "${GREEN}✅ 備份檔案存在${NC}\n"

            # 最後確認
            echo -e "${RED}⚠️  警告：還原資料會覆蓋當前的 $COLLECTION collection${NC}"
            echo -e "${YELLOW}確定要繼續嗎？(y/N)${NC} "
            read -r CONFIRM_RESTORE

            if [ "$CONFIRM_RESTORE" = "y" ] || [ "$CONFIRM_RESTORE" = "Y" ]; then
                echo -e "\n執行資料還原..."

                RESTORE_OUTPUT=$(docker exec "$CONTAINER_NAME" mongorestore \
                    --username="admin" \
                    --password="admin_password" \
                    --authenticationDatabase="admin" \
                    --db="$DB_NAME" \
                    --collection="$COLLECTION" \
                    --drop \
                    "$BACKUP_PATH/$DB_NAME/$COLLECTION.bson" 2>&1)

                if [ $? -eq 0 ]; then
                    echo -e "${GREEN}✅ 資料還原成功${NC}\n"
                    echo "$RESTORE_OUTPUT" | grep -E "inserted|documents"
                else
                    echo -e "${RED}❌ 資料還原失敗！${NC}"
                    echo "$RESTORE_OUTPUT"
                    exit 1
                fi
            else
                echo -e "\n${YELLOW}已取消資料還原${NC}\n"
            fi
        fi
    fi
else
    echo -e "${BLUE}════════════════════════════════════════${NC}"
    echo -e "${BLUE}步驟 2/3: 跳過資料還原${NC}"
    echo -e "${BLUE}════════════════════════════════════════${NC}\n"
    echo -e "${YELLOW}ℹ️  只回滾索引，不還原資料${NC}"
    echo -e "${RED}注意：遷移過程中刪除的重複資料無法恢復${NC}\n"
fi

# ========================================
# 步驟 3: 重啟服務
# ========================================
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}步驟 3/3: 重啟 notification-service${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}是否要重啟 notification-service？${NC}"
echo -e "輸入 ${GREEN}y${NC} 重啟，其他鍵跳過: "
read -r RESTART_CONFIRM

if [ "$RESTART_CONFIRM" = "y" ] || [ "$RESTART_CONFIRM" = "Y" ]; then
    echo -e "\n重啟服務中..."

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
    echo -e "\n${YELLOW}跳過重啟${NC}\n"
fi

# 最終總結
echo -e "${CYAN}╔════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         ${GREEN}✅ 回滾完成！${CYAN}                ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════╝${NC}\n"

echo -e "${BLUE}回滾摘要：${NC}"
echo -e "  索引回滾: ${GREEN}✅ 完成${NC}"
if [ "$RESTORE_DATA" = true ]; then
    echo -e "  資料還原: ${GREEN}✅ 完成${NC}"
else
    echo -e "  資料還原: ${YELLOW}跳過${NC}"
fi
echo ""

echo -e "${YELLOW}注意事項：${NC}"
echo -e "  • 系統已恢復到舊的索引結構"
echo -e "  • 唯一約束: { userId + deviceId + platform }"
if [ "$RESTORE_DATA" = false ]; then
    echo -e "  • ${RED}遷移時刪除的重複資料未恢復${NC}"
fi
echo ""

echo -e "${GREEN}下一步：${NC}"
echo -e "  1. 檢查服務日誌: ${YELLOW}docker-compose logs -f notification-service${NC}"
echo -e "  2. 驗證推播功能"
echo -e "  3. 檢查資料庫索引: ${YELLOW}./check-duplicates.sh${NC}\n"
