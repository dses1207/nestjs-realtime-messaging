# file-service

[English](README.md)

聊天附件的檔案儲存服務，後端是 MinIO。以 gRPC 對內提供（`protos/file.proto`，port 50055），
用戶端經由 API Gateway 使用。

上傳通常不經過服務本身。用戶端先要一個上傳位置（`RequestUpload`），拿到預簽章網址後直接把檔案 PUT 到 MinIO，
再呼叫 `ConfirmUpload`。下載也一樣是拿預簽章的 GET 網址。經由服務下載（`DownloadFile`）時，會先向 chat-service
確認呼叫者是檔案所屬對話的成員。

預簽章網址是用對外的 MinIO 位址（`MINIO_PUBLIC_ENDPOINT`）簽的，不是叢集內的主機名稱，
因為簽章會包含 Host header。

| RPC | 用途 |
|---|---|
| `RequestUpload`、`ConfirmUpload` | 預簽章上傳流程 |
| `GetSecureFile`、`CheckFilePermission` | 檢查權限後發下載網址 |
| `GetFileInfo`、`GetFileUrl` | 檔案資訊與網址 |
| `UploadSecureFile`、`UploadFile`、`DownloadFile` | 經由服務上傳或下載，給無法使用預簽章網址的用戶端 |

完整環境請在 repo 根目錄啟動（見[根目錄 README](../../README.zh-TW.md)）。
