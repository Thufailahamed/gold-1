export type ApiResponse<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        approvalId?: string;
        entity?: string;
        entityId?: string;
        metric?: number;
      };
    };
