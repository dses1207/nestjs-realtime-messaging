#!/bin/bash

# 顏色輸出設定
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m' # No Color

# 記錄開始時間
START_TIME=$(date +%s)

# 輸出帶顏色的訊息
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_phase() {
    echo -e "${MAGENTA}[PHASE]${NC} $1"
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# --- 環境設定 ---
# 檢查是否提供環境參數
if [ -z "$1" ]; then
    log_error "請提供環境參數 (dev 或 prod)"
    echo "用法: $0 [dev|prod]"
    exit 1
fi

ENV=$1
ENV_FILE=""
COMPOSE_FILE=""

log_info "選擇的環境: $ENV"

if [ "$ENV" == "dev" ]; then
    ENV_FILE=".env.dev"
    COMPOSE_FILE="docker-compose.dev.yml"
elif [ "$ENV" == "prod" ]; then
    ENV_FILE=".env.prod"
    COMPOSE_FILE="docker-compose.prod.yml"
else
    log_error "無效的環境參數: '$ENV'. 只接受 'dev' 或 'prod'."
    exit 1
fi

# 檢查必要的設定檔案是否存在
if [ ! -f "$ENV_FILE" ]; then
    log_error "環境設定檔 '$ENV_FILE' 不存在。"
    log_warning "您是否忘記從 '$ENV_FILE.example' 複製一份？"
    echo "指令: cp $ENV_FILE.example $ENV_FILE"
    exit 1
fi

if [ ! -f "$COMPOSE_FILE" ]; then
    log_error "Docker Compose 設定檔 '$COMPOSE_FILE' 不存在。"
    exit 1
fi

# 將 docker compose 命令加上環境參數，方便後續使用
DOCKER_COMPOSE_CMD="docker compose --env-file $ENV_FILE -f $COMPOSE_FILE"

log_info "使用設定檔: $ENV_FILE"
log_info "使用 Compose 檔: $COMPOSE_FILE"

# 載入環境變數，以便在腳本中使用
export $(grep -v '^#' $ENV_FILE | grep -v '^$' | xargs)

# 檢查服務是否健康
check_service_health() {
    local service=$1
    local max_attempts=45
    local attempt=1
    
    log_step "檢查 $service 服務狀態..."
    
    while [ $attempt -le $max_attempts ]; do
        if $DOCKER_COMPOSE_CMD ps $service | grep -q "Up"; then
            log_success "$service 服務已啟動並運行中"
            return 0
        fi
        
        echo -n "."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    log_error "$service 服務啟動失敗或超時 (90秒)"
    return 1
}

# 建立單一服務
build_service() {
    local service=$1
    local description=$2
    local wait_time=${3:-5}
    
    echo ""
    log_step "=== 建立 $service ($description) ==="
    
    # 先停止可能存在的舊容器
    $DOCKER_COMPOSE_CMD stop $service 2>/dev/null || true
    $DOCKER_COMPOSE_CMD rm -f $service 2>/dev/null || true
    
    # 建立並啟動服務
    if $DOCKER_COMPOSE_CMD up -d --build $service; then
        if check_service_health $service; then
            log_success "$service 建立完成，等待 ${wait_time} 秒讓服務穩定..."
            sleep $wait_time
            return 0
        else
            log_error "$service 健康檢查失敗"
            return 1
        fi
    else
        log_error "$service 建立失敗"
        return 1
    fi
}

# 建立一組服務（按順序，每個服務間有小延遲）
build_services_group() {
    local services=("$@")
    local wait_time=8
    
    echo ""
    log_step "=== 建立服務組: ${services[*]} ==="
    
    # 先停止所有服務
    for service in "${services[@]}"; do
        $DOCKER_COMPOSE_CMD stop $service 2>/dev/null || true
        $DOCKER_COMPOSE_CMD rm -f $service 2>/dev/null || true
    done
    
    # 逐一建立服務，每個服務間有延遲
    local all_successful=true
    for service in "${services[@]}"; do
        local description=$(get_service_description $service)
        
        log_step "建立 $service ($description)..."
        
        if $DOCKER_COMPOSE_CMD up -d --build $service; then
            if check_service_health $service; then
                log_success "$service 建立完成"
                sleep $wait_time
            else
                log_warning "$service 健康檢查失敗，但繼續流程"
                all_successful=false
                sleep 3
            fi
        else
            log_error "$service 建立失敗，但繼續流程"
            all_successful=false
            sleep 3
        fi
    done
    
    if $all_successful; then
        log_success "服務組建立完成: ${services[*]}"
        return 0
    else
        log_warning "服務組部分建立失敗: ${services[*]}"
        return 1
    fi
}

# 取得服務描述
get_service_description() {
    local service=$1
    case $service in
        "mongodb") echo "MongoDB 資料庫" ;;
        "livekit-server") echo "LiveKit WebRTC 媒體服務器" ;;
        "coturn") echo "Coturn STUN/TURN 服務器" ;;
        "user-service") echo "用戶管理服務 (gRPC)" ;;
        "notification-service") echo "推播通知服務 (gRPC)" ;;
        "chat-service") echo "聊天訊息服務 (gRPC)" ;;
        "rtc-service") echo "通話管理服務 (gRPC)" ;;
        "websocket-server") echo "WebSocket 即時通訊" ;;
        "file-service") echo "檔案管理服務 (gRPC)" ;;
        "api-gateway") echo "API 閘道 (HTTP/gRPC 橋接)" ;;
        *) echo "微服務" ;;
    esac
}

# 主要建立流程
main() {
    echo ""
    log_info "=== 開始微服務架構分階段建立 ($ENV 環境) ==="
    log_info "服務構建策略：分階段、控制並發、確保依賴順序"
    echo ""
    
    # 清理可能的孤立容器
    log_info "清理孤立容器和無效網路..."
    $DOCKER_COMPOSE_CMD down --remove-orphans 2>/dev/null || true
    
    # 建立網路，確保在所有服務之前建立
    log_info "確保 Docker 網路存在..."
    if ! docker network ls | grep -q "message_app-network"; then
        log_step "建立應用網路..."
    fi
    
    # ===== 第一階段：基礎設施服務 =====
    log_phase "第一階段：建立基礎設施 (資料庫、媒體服務器)"
    if ! build_service "mongodb" "MongoDB 資料庫" 10; then
        log_error "MongoDB 建立失敗，無法繼續"
        exit 1
    fi

    # 建立 LiveKit Server
    if ! build_service "livekit-server" "LiveKit WebRTC 媒體服務器" 8; then
        log_warning "LiveKit Server 建立失敗，但繼續流程"
    fi

    # 建立 Coturn
    if ! build_service "coturn" "Coturn STUN/TURN 服務器" 5; then
        log_warning "Coturn 建立失敗，但繼續流程"
    fi

    log_success "基礎設施建立完成，等待服務完全就緒..."
    sleep 15

    # ===== 第二階段：核心業務服務 =====
    log_phase "第二階段：建立核心業務服務 (用戶認證、通知)"

    # 先建立用戶服務（認證基礎）
    if ! build_service "user-service" "用戶管理服務 (gRPC)" 8; then
        log_warning "用戶服務建立失敗，但繼續流程"
    fi

    # 建立通知服務（獨立服務）
    if ! build_service "notification-service" "推播通知服務 (gRPC)" 8; then
        log_warning "通知服務建立失敗，但繼續流程"
    fi

    log_success "核心業務服務建立完成"
    sleep 10

    # ===== 第三階段：通訊相關服務 =====
    log_phase "第三階段：建立通訊服務 (聊天、RTC、WebSocket)"

    # 先建立聊天服務
    if ! build_service "chat-service" "聊天訊息服務 (gRPC)" 8; then
        log_warning "聊天服務建立失敗，但繼續流程"
    fi

    # 建立 RTC Service（依賴 LiveKit）
    if ! build_service "rtc-service" "通話管理服務 (gRPC)" 8; then
        log_warning "RTC服務建立失敗，但繼續流程"
    fi

    # 再建立WebSocket服務（依賴 chat 和 rtc）
    if ! build_service "websocket-server" "WebSocket 即時通訊" 8; then
        log_warning "WebSocket服務建立失敗，但繼續流程"
    fi

    log_success "通訊服務建立完成"
    sleep 10

    # ===== 第四階段：輔助服務 =====
    log_phase "第四階段：建立輔助服務 (檔案)"

    # 檔案服務
    if ! build_service "file-service" "檔案管理服務 (gRPC)" 5; then
        log_warning "檔案服務建立失敗，但繼續流程"
    fi

    log_success "輔助服務建立完成"
    sleep 10

    # ===== 第五階段：API Gateway =====
    log_phase "第五階段：建立 API Gateway (對外服務入口)"
    if ! build_service "api-gateway" "API 閘道 (HTTP/gRPC 橋接)" 10; then
        log_warning "API Gateway 建立失敗"
    fi

    log_success "API Gateway 建立完成"
    sleep 15
    
    # ===== 最終檢查和狀態顯示 =====
    echo ""
    log_info "=== 最終系統狀態檢查 ==="
    $DOCKER_COMPOSE_CMD ps
    
    # 計算總耗時
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    MINUTES=$((DURATION / 60))
    SECONDS=$((DURATION % 60))
    
    echo ""
    log_success "=== 微服務架構建立完成！總耗時: ${MINUTES}分${SECONDS}秒 ==="
    
    # ===== 服務訪問信息 =====
    echo ""
    log_info "=== 服務訪問信息 ($ENV 環境) ==="
    echo "┌─────────────────────────────────────────────────────────────┐"
    echo "│                        對外服務                             │"
    echo "├─────────────────────────────────────────────────────────────┤"
    echo "│ • API Gateway (HTTP):     ${API_GATEWAY_URL}"
    echo "│ • WebSocket Server:       ws://$(echo $WEBSOCKET_SERVICE_URL | cut -d':' -f1):${WEBSOCKET_SERVICE_PORT}"
    
    if [ ! -z "$MONGODB_EXTERNAL_PORT" ]; then
        echo "│ • MongoDB (外部訪問):     mongodb://localhost:${MONGODB_EXTERNAL_PORT}"
    fi
    
    echo "│                                                             │"
    echo "├─────────────────────────────────────────────────────────────┤"
    echo "│                      內部 gRPC 服務                         │"
    echo "├─────────────────────────────────────────────────────────────┤"
    echo "│ • 用戶服務:               ${USER_SERVICE_URL}"
    echo "│ • 聊天服務:               ${CHAT_SERVICE_URL}"
    echo "│ • 通話服務:               ${RTC_SERVICE_URL}"
    echo "│ • 檔案服務:               ${FILE_SERVICE_URL}"
    echo "│ • 通知服務:               ${NOTIFICATION_SERVICE_URL}"
    echo "├─────────────────────────────────────────────────────────────┤"
    echo "│                      媒體服務                               │"
    echo "├─────────────────────────────────────────────────────────────┤"
    echo "│ • LiveKit Server:         ws://livekit-server:7880"
    echo "│ • Coturn STUN/TURN:       ${TURN_SERVER_URL}"
    echo "└─────────────────────────────────────────────────────────────┘"
    echo ""
    
    # ===== 重要提示 =====
    log_warning "📋 重要架構說明："
    echo "   • 所有微服務僅提供 gRPC 接口，無直接 HTTP 端點"
    echo "   • 前端應用必須通過 API Gateway 訪問後端服務"
    echo "   • WebSocket 連接用於即時通訊功能"
    echo "   • 推播通知支援 FCM (Android) 和 APNs (iOS)"
    echo ""
    
    # ===== 常用操作指令 =====
    log_info "🔧 常用操作指令："
    echo "   查看所有服務狀態:     $DOCKER_COMPOSE_CMD ps"
    echo "   查看特定服務日誌:     $DOCKER_COMPOSE_CMD logs -f [服務名稱]"
    echo "   重啟特定服務:         $DOCKER_COMPOSE_CMD restart [服務名稱]"
    echo "   停止所有服務:         $DOCKER_COMPOSE_CMD down"
    echo "   查看資源使用:         docker stats"
    echo ""
    
    # ===== 服務健康檢查建議 =====
    log_info "🏥 建議進行的健康檢查："
    echo "   1. 測試 API Gateway:      curl ${API_GATEWAY_URL}/health"
    echo "   2. 檢查 WebSocket 連接"
    echo "   3. 驗證用戶認證流程"
    echo "   4. 測試聊天訊息傳送"
    if [ ! -z "$MONGODB_EXTERNAL_PORT" ]; then
        echo "   5. 檢查 MongoDB 連接:     mongo --host localhost --port ${MONGODB_EXTERNAL_PORT}"
    fi
    echo ""
}

# 錯誤處理
set -e
trap 'log_error "腳本執行過程中發生錯誤，請檢查上方日誌"; exit 1' ERR

# 檢查 Docker 是否運行
if ! docker info >/dev/null 2>&1; then
    log_error "Docker 未運行，請先啟動 Docker"
    exit 1
fi

# 檢查 Docker Compose 版本
if ! docker compose version >/dev/null 2>&1; then
    log_error "Docker Compose 不可用，請安裝 Docker Compose V2"
    exit 1
fi

# 執行主要流程
main "$@"