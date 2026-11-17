export interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data: T | null;
  meta: {
    timestamp: string;
    requestId?: string;
  };
}

export class ApiResponseHelper {
  static success<T>(data?: T, message: string = '操作成功'): ApiResponse<T> {
    return {
      success: true,
      message,
      data: data !== undefined ? data : null,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  }

  static error(message: string = '操作失敗'): ApiResponse<null> {
    return {
      success: false,
      message,
      data: null,
      meta: {
        timestamp: new Date().toISOString(),
      },
    };
  }
} 