export interface HttpExceptionResponse {
  statusCode: number;
  message: string | string[];
  error?: string;
  timestamp?: string;
  path?: string;
}

export interface ValidationError {
  property: string;
  constraints: Record<string, string>;
}
