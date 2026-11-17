# user-service

[繁體中文](README.zh-TW.md)

Accounts and authentication for the platform. Other services reach it over gRPC (`protos/user.proto`,
port 50052); clients go through the API Gateway.

Passwords are hashed with bcrypt and stored in MongoDB. `Login` returns a JWT. The API Gateway verifies
tokens on each request itself, using the shared `JWT_SECRET`.

| RPC | Purpose |
|---|---|
| `Register`, `Login`, `ValidateToken` | Sign-up, sign-in, token check |
| `GetUserById`, `GetUserByUsername` | Look up one user |
| `GetAllUsers`, `GetAllUsernames` | List users |
| `UpdateUser` | Update profile fields |

Run it as part of the full stack with `docker compose` from the repository root (see the
[top-level README](../../README.md)). For local development:

```bash
pnpm install
pnpm run start:dev
pnpm run test
```
