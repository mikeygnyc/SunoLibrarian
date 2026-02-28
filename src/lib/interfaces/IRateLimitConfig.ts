export interface IRateLimitConfig {
  baseDelay: number;
  workspaceDelay: number;
  trackDelay: number;
  metadataDelay: number;
  maxRetries: number;
  initialBackoff: number;
  maxBackoff: number;
  backoffMultiplier: number;
  rateLimitDetected: boolean;
}
