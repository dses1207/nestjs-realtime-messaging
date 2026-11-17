# 反向代理與SSL驗證架構設計

## 概述

本文件描述如何建立一個完整的反向代理和SSL驗證機制，讓內部API服務可以透過Cloudflare網域安全地對外提供服務。

## 整體架構

```
Internet → Cloudflare → Nginx (反向代理) → API Gateway → 後端服務
   ↓           ↓              ↓                ↓           ↓
  HTTPS    SSL終止/代理    SSL憑證管理      gRPC路由    NestJS服務
```

## 技術堆疊

### 核心組件
- **Cloudflare**: DNS管理、CDN、DDoS防護
- **Nginx**: 反向代理、SSL終止、負載均衡
- **Certbot**: Let's Encrypt SSL憑證自動管理
- **Docker**: 容器化部署
- **API Gateway**: 現有的gRPC路由服務

### 安全機制
- **SSL/TLS加密**: 端到端加密通訊
- **JWT驗證**: API存取權限控制
- **Rate Limiting**: 防止API濫用
- **CORS設定**: 跨域請求控制

## 目錄結構

```
project/
├── nginx/
│   ├── nginx.conf              # Nginx主配置
│   ├── sites-available/
│   │   └── api.yourdomain.com  # 網站配置
│   ├── ssl/                    # SSL憑證目錄
│   └── logs/                   # 日誌目錄
├── certbot/
│   ├── conf/                   # Certbot配置
│   └── www/                    # ACME挑戰目錄
├── docker-compose.ssl.yml      # SSL版本的Docker配置
└── scripts/
    ├── setup-ssl.sh           # SSL設定腳本
    └── renew-ssl.sh           # 憑證更新腳本
```

## SSL憑證管理策略

### 方案一：Let's Encrypt + Certbot (推薦)
**優點**:
- 免費SSL憑證
- 自動更新
- 廣泛支援

**實作步驟**:
1. 使用Certbot獲取憑證
2. 配置自動更新
3. Nginx配置SSL

### 方案二：Cloudflare Origin Certificate
**優點**:
- 與Cloudflare深度整合
- 15年有效期
- 簡化管理

**實作步驟**:
1. 在Cloudflare生成Origin Certificate
2. 下載憑證和私鑰
3. 配置Nginx使用憑證

## Nginx配置架構

### 主要功能
1. **SSL終止**: 處理HTTPS連線
2. **反向代理**: 轉發請求到API Gateway
3. **負載均衡**: 多實例支援
4. **安全標頭**: 添加安全相關HTTP標頭
5. **Rate Limiting**: API請求頻率限制

### 配置模板
```nginx
# 基本配置
server {
    listen 80;
    server_name api.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.yourdomain.com;
    
    # SSL配置
    ssl_certificate /etc/ssl/certs/api.yourdomain.com.crt;
    ssl_certificate_key /etc/ssl/private/api.yourdomain.com.key;
    
    # 反向代理到API Gateway
    location / {
        proxy_pass http://api-gateway:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 安全配置

### 1. SSL/TLS設定
```nginx
# 現代SSL配置
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
```

### 2. 安全標頭
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options DENY always;
add_header X-Content-Type-Options nosniff always;
add_header X-XSS-Protection "1; mode=block" always;
```

### 3. Rate Limiting
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req zone=api burst=20 nodelay;
```

## Docker配置

### docker-compose.ssl.yml
```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf
      - ./nginx/sites-available:/etc/nginx/sites-available
      - ./nginx/ssl:/etc/ssl
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    depends_on:
      - api-gateway
    restart: unless-stopped

  certbot:
    image: certbot/certbot
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done;'"

  api-gateway:
    # 現有的API Gateway配置
    build: ./services/api-gateway
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - SSL_ENABLED=true
    depends_on:
      - user-service
      - message-service
      - notification-service
```

## 部署流程

### 階段一：準備工作
1. **DNS設定**: 在Cloudflare設定A記錄指向伺服器IP
2. **防火牆**: 開放80、443端口
3. **網域驗證**: 確認網域解析正確

### 階段二：SSL憑證獲取
```bash
# 方法1: Let's Encrypt
./scripts/setup-ssl.sh api.yourdomain.com

# 方法2: Cloudflare Origin Certificate
# 手動下載並放置憑證檔案
```

### 階段三：服務部署
```bash
# 啟動SSL版本的服務
docker compose -f docker-compose.ssl.yml up -d

# 驗證服務狀態
docker compose -f docker-compose.ssl.yml ps
```

### 階段四：測試驗證
```bash
# SSL憑證測試
curl -I https://api.yourdomain.com

# API功能測試
curl -X POST https://api.yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"test","password":"test"}'
```

## 監控與維護

### 1. 日誌監控
- Nginx存取日誌
- SSL憑證到期監控
- API回應時間監控

### 2. 自動化維護
- SSL憑證自動更新
- 日誌輪轉
- 健康檢查

### 3. 備份策略
- SSL憑證備份
- Nginx配置備份
- 監控數據備份

## Cloudflare設定

### DNS記錄
```
類型: A
名稱: api
內容: YOUR_SERVER_IP
代理狀態: 已代理 (橙色雲朵)
```

### SSL/TLS設定
- **加密模式**: 完整 (嚴格)
- **最低TLS版本**: 1.2
- **自動HTTPS重寫**: 開啟
- **HSTS**: 開啟

### 安全設定
- **WAF**: 開啟
- **DDoS防護**: 開啟
- **Bot Fight Mode**: 開啟
- **Rate Limiting**: 根據需求設定

## 成本評估

### 免費方案
- Let's Encrypt SSL憑證: 免費
- Cloudflare基本方案: 免費
- 總成本: $0/月

### 付費方案 (可選)
- Cloudflare Pro: $20/月
- 額外功能: 進階DDoS防護、詳細分析

## 注意事項

### 安全考量
1. **定期更新**: 保持Nginx和SSL憑證最新
2. **存取控制**: 限制管理介面存取
3. **日誌監控**: 定期檢查異常存取

### 效能考量
1. **快取策略**: 配置適當的快取標頭
2. **壓縮**: 啟用gzip壓縮
3. **連線池**: 優化upstream連線

### 維護考量
1. **備份**: 定期備份配置和憑證
2. **測試**: 定期測試SSL和API功能
3. **文件**: 維護操作文件

## 下一步行動

1. **評估架構**: 確認架構符合需求
2. **準備網域**: 確保Cloudflare網域可用
3. **伺服器準備**: 確保伺服器規格足夠
4. **開始實作**: 按照部署流程執行

---

**注意**: 此架構設計考慮了安全性、可擴展性和維護性。實際實作時請根據具體需求調整配置。 