import type { StagingQuotaDO } from "../do/quota";
import type { JwtCacheDO } from "../do/jwtcache";

export interface Env {
  DB: D1Database;
  DOCS: R2Bucket;
  STAMP_QUEUE: Queue<QueueMessage>;
  STAGING_QUOTA: DurableObjectNamespace<StagingQuotaDO>;
  JWT_CACHE: DurableObjectNamespace<JwtCacheDO>;

  ENVIRONMENT: string;
  MOCK_PERURI: string;
  PERURI_STAGING_BASE_URL: string;
  PERURI_PROD_BASE_URL: string;
  PERURI_STAGING_STAMP_BASE_URL: string;
  PERURI_PROD_STAMP_BASE_URL: string;
  API_KEY_PREFIX: string;
  SESSION_TTL_SECONDS: string;

  STAMP_CREDENTIAL_ENCRYPTION_KEY: string;
  STAGING_PERURI_USERNAME: string;
  STAGING_PERURI_PASSWORD: string;
  ASSETS?: Fetcher;
}

export interface QueueMessage {
  type: "stamp";
  job_id: string;
  tenant_id: string;
}
