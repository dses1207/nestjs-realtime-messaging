# user-service

[English](README.md)

平台的帳號與身分驗證服務。其他服務透過 gRPC 呼叫它（`protos/user.proto`，port 50052），
用戶端則經由 API Gateway。

密碼以 bcrypt 雜湊後存在 MongoDB。`Login` 會回傳 JWT。API Gateway 每個請求都用共用的 `JWT_SECRET` 自行驗證 token。

| RPC | 用途 |
|---|---|
| `Register`、`Login`、`ValidateToken` | 註冊、登入、檢查 token |
| `GetUserById`、`GetUserByUsername` | 查詢單一使用者 |
| `GetAllUsers`、`GetAllUsernames` | 列出使用者 |
| `UpdateUser` | 更新個人資料 |

完整環境請在 repo 根目錄用 `docker compose` 啟動（見[根目錄 README](../../README.zh-TW.md)）。本機開發：

```bash
pnpm install
pnpm run start:dev
pnpm run test
```
