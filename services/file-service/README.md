# file-service

[繁體中文](README.zh-TW.md)

File storage for chat attachments, backed by MinIO. Exposed over gRPC (`protos/file.proto`, port 50055)
and reached by clients through the API Gateway.

Uploads normally bypass the services entirely. The client asks for an upload slot (`RequestUpload`), gets a
pre-signed URL, PUTs the file straight to MinIO, and then calls `ConfirmUpload`. Downloads work the same way
with a pre-signed GET URL. When a file is downloaded through the service (`DownloadFile`), it first asks
chat-service whether the caller is a member of the conversation the file belongs to.

Pre-signed URLs are signed against the public MinIO address (`MINIO_PUBLIC_ENDPOINT`) rather than the
in-cluster hostname, because the signature covers the host header.

| RPC | Purpose |
|---|---|
| `RequestUpload`, `ConfirmUpload` | Pre-signed upload flow |
| `GetSecureFile`, `CheckFilePermission` | Permission-checked download URL |
| `GetFileInfo`, `GetFileUrl` | Metadata and URLs |
| `UploadSecureFile`, `UploadFile`, `DownloadFile` | Upload or download through the service, for clients that cannot use pre-signed URLs |

Run it as part of the full stack from the repository root (see the [top-level README](../../README.md)).
