#!/bin/bash

###############################################################################
# 備份 device_tokens Collection
#
# 用途：在執行遷移前備份資料
# 使用方式：./backup-database.sh
###############################################################################

# 顏色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
DB_NAME="messageapp"
COLLECTION="device_tokens"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR="/backup/device-tokens-backup-$TIMESTAMP"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}備份 device_tokens Collection${NC}"
echo -e "${BLUE}========================================${NC}\n"

# 自動檢測容器名稱
echo -e "${YELLOW}[1/5]${NC} 檢查 MongoDB 容器狀態..."

CONTAINER_NAME=$(docker ps --filter "ancestor=mongo:8.0" --format "{{.Names}}" 2>/dev/null | head -n 1)
if [ -z "$CONTAINER_NAME" ]; then
    CONTAINER_NAME=$(docker ps --filter "name=mongodb" --format "{{.Names}}" 2>/dev/null | head -n 1)
fi

if [ -z "$CONTAINER_NAME" ]; then
    echo -e "${RED}❌ MongoDB 容器未運行！${NC}"
    echo -e "請先啟動容器: ${YELLOW}docker-compose up -d mongodb${NC}"
    exit 1
fi

echo -e "${GREEN}✅ MongoDB 容器運行中${NC} (${CONTAINER_NAME})\n"

# 檢查資料庫連接
echo -e "${YELLOW}[2/5]${NC} 檢查資料庫連接..."
if ! docker exec "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet --eval "db.runCommand({ ping: 1 })" > /dev/null 2>&1; then
    echo -e "${RED}❌ 無法連接到資料庫！${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 資料庫連接正常${NC}\n"

# 統計要備份的資料
echo -e "${YELLOW}[3/5]${NC} 統計要備份的資料..."
TOTAL_COUNT=$(docker exec "$CONTAINER_NAME" mongosh "$DB_NAME" --quiet --eval "db.$COLLECTION.countDocuments()" 2>/dev/null | tail -1)
echo -e "  Collection: ${BLUE}$COLLECTION${NC}"
echo -e "  總記錄數: ${GREEN}$TOTAL_COUNT${NC}"
echo -e "  備份位置: ${YELLOW}$BACKUP_DIR${NC}\n"

# 執行備份
echo -e "${YELLOW}[4/5]${NC} 執行備份..."
echo -e "${BLUE}提示：${NC}備份過程可能需要幾秒到幾分鐘，取決於資料量\n"

BACKUP_OUTPUT=$(docker exec "$CONTAINER_NAME" mongodump \
  --username="admin" \
  --password="admin_password" \
  --authenticationDatabase="admin" \
  --db="$DB_NAME" \
  --collection="$COLLECTION" \
  --out="$BACKUP_DIR" 2>&1)

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ 備份完成${NC}\n"
else
    echo -e "${RED}❌ 備份失敗！${NC}"
    echo -e "${RED}錯誤訊息：${NC}"
    echo "$BACKUP_OUTPUT"
    exit 1
fi

# 驗證備份
echo -e "${YELLOW}[5/5]${NC} 驗證備份..."

# 檢查備份檔案是否存在
BACKUP_CHECK=$(docker exec "$CONTAINER_NAME" sh -c "
    if [ -f '$BACKUP_DIR/$DB_NAME/$COLLECTION.bson' ]; then
        ls -lh '$BACKUP_DIR/$DB_NAME/$COLLECTION.bson' | awk '{print \$5}'
    else
        echo 'NOT_FOUND'
    fi
" 2>/dev/null)

if [ "$BACKUP_CHECK" = "NOT_FOUND" ]; then
    echo -e "${RED}❌ 備份檔案不存在！${NC}"
    exit 1
fi

echo -e "  備份檔案大小: ${GREEN}$BACKUP_CHECK${NC}"

# 檢查 metadata
METADATA_CHECK=$(docker exec "$CONTAINER_NAME" sh -c "
    if [ -f '$BACKUP_DIR/$DB_NAME/$COLLECTION.metadata.json' ]; then
        echo 'EXISTS'
    else
        echo 'NOT_FOUND'
    fi
" 2>/dev/null)

if [ "$METADATA_CHECK" = "EXISTS" ]; then
    echo -e "  Metadata 檔案: ${GREEN}✅ 存在${NC}"
else
    echo -e "  Metadata 檔案: ${YELLOW}⚠️  不存在（可能不影響還原）${NC}"
fi

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✅ 備份成功完成！${NC}"
echo -e "${GREEN}========================================${NC}\n"

echo -e "${BLUE}備份資訊：${NC}"
echo -e "  位置: ${YELLOW}容器內 $BACKUP_DIR${NC}"
echo -e "  檔案: ${YELLOW}$COLLECTION.bson${NC}"
echo -e "  記錄數: ${GREEN}$TOTAL_COUNT${NC}"
echo -e "  時間戳: ${BLUE}$TIMESTAMP${NC}\n"

echo -e "${YELLOW}如何還原備份：${NC}"
echo -e "${BLUE}docker exec $CONTAINER_NAME mongorestore \\${NC}"
echo -e "${BLUE}  --db=$DB_NAME \\${NC}"
echo -e "${BLUE}  --collection=$COLLECTION \\${NC}"
echo -e "${BLUE}  --drop \\${NC}"
echo -e "${BLUE}  $BACKUP_DIR/$DB_NAME/$COLLECTION.bson${NC}\n"

echo -e "${YELLOW}匯出備份到本機：${NC}"
echo -e "${BLUE}docker cp $CONTAINER_NAME:$BACKUP_DIR ./backups/${NC}\n"

echo -e "${GREEN}下一步：${NC}"
echo -e "  執行遷移: ${YELLOW}./migrate-database.sh${NC}\n"

# 保存備份路徑到臨時檔案，供其他腳本使用
echo "$BACKUP_DIR" > /tmp/last-device-tokens-backup.txt
