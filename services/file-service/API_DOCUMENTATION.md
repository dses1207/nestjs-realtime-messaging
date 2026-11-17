# File Service API Documentation

This documentation provides detailed information about the File Service APIs, including both the new unified pre-signed URL upload method and the legacy APIs for backward compatibility. All APIs are accessible via gRPC.

## Table of Contents

- [Base Configuration](#base-configuration)
- [New Unified Pre-signed URL Upload (Recommended)](#new-unified-pre-signed-url-upload-recommended)
  - [1. RequestUpload](#1-requestupload)
  - [2. ConfirmUpload](#2-confirmupload)
- [File Access and Management](#file-access-and-management)
  - [GetSecureFile](#getsecurefile)
  - [CheckFilePermission](#checkfilepermission)
  - [GetFileInfo](#getfileinfo)
  - [DownloadFile (with Preview/Download Support)](#downloadfile-with-previewdownload-support)
- [Legacy APIs (Backward Compatibility)](#legacy-apis-backward-compatibility)
  - [UploadFile](#uploadfile)
  - [GetFileUrl](#getfileurl)
- [File Storage Details (MinIO)](#file-storage-details-minio)

---

## Base Configuration

- **Service Name**: `FileService`
- **Protocol**: gRPC
- **File Identification**: All new file operations use a unique `fileId` (UUID) for secure and consistent file identification.

## New Unified Pre-signed URL Upload (Recommended)

This is the recommended approach for uploading files. It's more secure and efficient, especially for large files, as it allows direct upload to MinIO storage without passing through the service.

### 1. RequestUpload

Generates a pre-signed URL for uploading a file directly to MinIO.

**Method**: `RequestUpload(RequestUploadRequest) returns (RequestUploadResponse)`

**Request**:
```protobuf
message RequestUploadRequest {
  string filename = 1;       // Original filename
  int64 fileSize = 2;        // File size in bytes
  string contentType = 3;    // MIME type (e.g., image/png)
  string uploaderId = 4;     // User ID of the uploader
  string conversationId = 5; // [Optional] Associated conversation ID
  string messageId = 6;      // [Optional] Associated message ID
  string category = 7;       // [Optional] File category (default: 'general')
                             // Supported categories: 'message', 'avatar', 'general'
}
```

**Response**:
```protobuf
message RequestUploadResponse {
  bool success = 1;          // Operation success
  string message = 2;        // Status message
  string fileId = 3;         // Secure file ID (UUID) for future reference
  string uploadUrl = 4;      // Pre-signed URL for direct MinIO upload
  string expiresAt = 5;      // URL expiration time (ISO string)
}
```

**Process**:
1. Client calls `RequestUpload` with file details.
2. Service generates a pre-signed URL and creates a pending file record.
3. Client uses the `uploadUrl` to upload the file directly to MinIO.

### 2. ConfirmUpload

Confirms that the file has been successfully uploaded to MinIO and finalizes the file record.

**Method**: `ConfirmUpload(ConfirmUploadRequest) returns (ConfirmUploadResponse)`

**Request**:
```protobuf
message ConfirmUploadRequest {
  string fileId = 1;         // Secure file ID from RequestUpload
  string uploaderId = 2;     // User ID (for permission verification)
}
```

**Response**:
```protobuf
message ConfirmUploadResponse {
  bool success = 1;          // Operation success
  string message = 2;        // Status message
  string fileId = 3;         // Secure file ID
  string fileUrl = 4;        // API Gateway URL to download the file
  int64 fileSize = 5;        // Actual file size in bytes
  string contentType = 6;    // MIME type
}
```

**Process**:
1. After uploading to MinIO, client calls `ConfirmUpload`.
2. Service verifies the file exists in MinIO and updates the file record status.
3. Service returns a permanent `fileUrl` for accessing the file.

## File Access and Management

### GetSecureFile

Retrieves a file's content with permission verification.

**Method**: `GetSecureFile(GetSecureFileRequest) returns (GetSecureFileResponse)`

**Request**:
```protobuf
message GetSecureFileRequest {
  string fileId = 1;         // Secure file ID
  string userId = 2;         // User ID requesting access
}
```

**Response**:
```protobuf
message GetSecureFileResponse {
  bool success = 1;          // Operation success
  string message = 2;        // Status message
  bytes fileData = 3;        // File content (binary data)
  string contentType = 4;    // MIME type
  string filename = 5;       // Original filename
  int64 fileSize = 6;        // File size in bytes
}
```

### CheckFilePermission

Checks if a user has permission to access a specific file.

**Method**: `CheckFilePermission(CheckFilePermissionRequest) returns (CheckFilePermissionResponse)`

**Request**:
```protobuf
message CheckFilePermissionRequest {
  string fileId = 1;         // Secure file ID
  string userId = 2;         // User ID to check permissions for
}
```

**Response**:
```protobuf
message CheckFilePermissionResponse {
  bool success = 1;          // Operation success
  bool hasPermission = 2;    // Permission status
}
```

### GetFileInfo

Retrieves metadata information about a file without downloading its content.

**Method**: `GetFileInfo(GetFileInfoRequest) returns (GetFileInfoResponse)`

**Request**:
```protobuf
message GetFileInfoRequest {
  string fileId = 1;         // Secure file ID
}
```

**Response**:
```protobuf
message GetFileInfoResponse {
  bool success = 1;          // Operation success
  string fileId = 2;         // Secure file ID
  string originalName = 3;   // Original filename
  string contentType = 4;    // MIME type
  int64 fileSize = 5;        // File size in bytes
  string uploaderId = 6;     // User ID of the uploader
  string conversationId = 7; // Associated conversation ID (if any)
  string messageId = 8;      // Associated message ID (if any)
  string category = 9;       // File category
  string createdAt = 10;     // Creation timestamp (ISO string)
}
```

### DownloadFile (with Preview/Download Support)

Downloads a file with support for both preview (inline display) and download (attachment) modes. This endpoint includes comprehensive permission checks.

**Method**: `DownloadFile(DownloadFileRequest) returns (DownloadFileResponse)`

**Request**:
```protobuf
message DownloadFileRequest {
  string fileId = 1;         // Secure file ID
  string userId = 2;         // User ID requesting download
  bool preview = 3;          // [Optional] Preview mode (default: false)
                             // true: Content-Disposition = 'inline'
                             // false: Content-Disposition = 'attachment'
}
```

**Response**:
```protobuf
message DownloadFileResponse {
  bool success = 1;          // Operation success
  string message = 2;        // Status message
  bytes fileData = 3;        // File content (binary data)
  string contentType = 4;    // MIME type
  string filename = 5;       // Original filename
  int64 fileSize = 6;        // File size in bytes
  string disposition = 7;    // Content-Disposition header value
}
```

**Permission Logic**:
- If the file is associated with a conversation (`conversationId`):
  - The requesting user must be a member of that conversation.
- If the file is not associated with a conversation:
  - Only the uploader (`uploaderId`) can access the file.

## Legacy APIs (Backward Compatibility)

These APIs are maintained for backward compatibility but are not recommended for new implementations.

### UploadFile

Uploads a file by sending its content directly to the service.

**Method**: `UploadFile(UploadFileRequest) returns (UploadFileResponse)`

**Request**:
```protobuf
message UploadFileRequest {
  string filename = 1;       // Original filename
  bytes data = 2;            // File content (binary data)
  string content_type = 3;   // MIME type
  string context_prefix = 4; // [Optional] Storage path prefix
}
```

**Response**:
```protobuf
message UploadFileResponse {
  bool success = 1;          // Operation success
  string message = 2;        // Status message
  string file_url = 3;       // URL to access the file
}
```

### GetFileUrl

Generates a pre-signed URL for temporary access to a file.

**Method**: `GetFileUrl(GetFileUrlRequest) returns (GetFileUrlResponse)`

**Request**:
```protobuf
message GetFileUrlRequest {
  string filename = 1;       // Full object name including path
}
```

**Response**:
```protobuf
message GetFileUrlResponse {
  bool success = 1;          // Operation success
  string message = 2;        // Status message
  string url = 3;            // Pre-signed URL for temporary access
}
```

## File Storage Details (MinIO)

Files are stored in a MinIO bucket with the following structure:

- **Bucket Name**: Configured via `MINIO_BUCKET_NAME` environment variable (default: `files`)
- **Object Naming Convention**: `{category}/{fileId}{extension}`
  - `category`: File category (e.g., `message`, `avatar`, `general`)
  - `fileId`: Secure UUID generated by the service
  - `extension`: Derived from the original filename
- **Access Control**: All files are stored with private ACL. Access is controlled through the service APIs.
- **URL Access**: Files are accessed via the API Gateway URL: `{API_GATEWAY_URL}/api/files/{fileId}/download`