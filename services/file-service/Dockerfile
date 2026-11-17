# 開發用映像：docker-compose.dev.yml 會把原始碼掛進 /app、跑 `pnpm run start:dev`（熱重載），
# node_modules 用映像裡裝好的這份（compose 以匿名 volume 保留 /app/node_modules）。
# 正式環境用 Dockerfile.prod。
FROM node:22-alpine

RUN apk add --no-cache tzdata
ENV TZ=Asia/Taipei

# pnpm 版本固定，跟 pnpm-lock.yaml 的產生版本一致
RUN npm install -g pnpm@10

WORKDIR /app

# 相依套件單獨一層：只改程式碼時不必重裝
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

CMD ["pnpm", "run", "start:dev"]
