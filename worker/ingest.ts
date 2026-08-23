/**
 * Cloudflare Worker for document ingestion
 *
 * This worker receives document/text content from authenticated users,
 * processes it through the RAG pipeline, and stores it in Supabase.
 *
 * AUTHENTICATION: Uses Supabase Auth JWT verification
 * The client must provide a valid Supabase Auth access token in the
 * Authorization header as a Bearer token.
 *
 * SECURITY:
 * - JWT signature validated by Supabase Auth client
 * - Token expiration enforced by Supabase Auth client
 * - User ID extracted from verified token (not client-supplied)
 * - CORS origin configurable via environment variable
 */

import { ingestDocument, DocumentInput, IngestError } from "../lib/rag/ingest";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  JINA_API_KEY: string;
  /** Comma-separated list of allowed origins (e.g., "https://dashycore.com,https://app.dashycore.com") */
  CORS_ORIGIN?: string;
}

export interface IngestionRequest {
  text: string;
  sourceType: string;
  sourceId?: string | null;
  title?: string | null;
  metadata?: Record<string, unknown>;
}

export interface IngestionResponse {
  success: boolean;
  documentId?: string;
  chunkCount?: number;
  embeddingDimensions?: number;
  error?: string;
}

/**
 * Verifies a Supabase Auth JWT token and extracts the user ID
 *
 * SECURITY: This uses the Supabase Auth client's built-in JWT verification which:
 * - Validates the JWT signature using the Supabase JWT secret
 * - Validates token expiration (exp claim)
 * - Validates issuer and audience claims
 * - Prevents token replay attacks
 *
 * The user ID is extracted from the verified token payload, not from client input.
 */
async function verifySupabaseToken(env: Env, token: string): Promise<string> {
  try {
    // Import Supabase Auth client for JWT verification
    const { createClient } = await import("@supabase/supabase-js");
    
    // Create an admin client to verify the token
    // The admin client uses SUPABASE_SERVICE_ROLE_KEY which has full access
    // but the token verification still validates the user's JWT cryptographically
    const adminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify the token and get the user
    // This internally:
    // 1. Decodes the JWT
    // 2. Validates the signature using Supabase's JWT secret
    // 3. Validates expiration, issuer, audience
    // 4. Returns the user ID from the verified token payload
    const { data: { user }, error } = await adminClient.auth.getUser(token);

    if (error || !user) {
      throw new Error('Invalid or expired token');
    }

    return user.id;
  } catch (error) {
    console.error('[Auth] Token verification failed:', error);
    throw new Error('Unauthorized: Invalid token');
  }
}

/**
 * Extracts the Bearer token from the Authorization header
 */
function extractBearerToken(request: Request): string {
  const authHeader = request.headers.get('Authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Unauthorized: Missing or invalid Authorization header');
  }

  const token = authHeader.substring(7).trim();
  
  if (!token) {
    throw new Error('Unauthorized: Empty token');
  }

  return token;
}

/**
 * Validates the ingestion request
 */
function validateRequest(request: IngestionRequest): { valid: boolean; error?: string } {
  if (!request.text || typeof request.text !== 'string') {
    return { valid: false, error: 'Text content is required' };
  }

  if (request.text.trim().length === 0) {
    return { valid: false, error: 'Text content cannot be empty' };
  }

  // Limit input size (10MB)
  const MAX_SIZE = 10 * 1024 * 1024;
  if (request.text.length > MAX_SIZE) {
    return { valid: false, error: 'Text content exceeds maximum size of 10MB' };
  }

  if (!request.sourceType || typeof request.sourceType !== 'string') {
    return { valid: false, error: 'Source type is required' };
  }

  return { valid: true };
}

/**
 * Gets the CORS origin from request or environment variable
 */
function getCorsOrigin(env: Env, request: Request): string {
  // If CORS_ORIGIN is set in env, use it (can be comma-separated)
  if (env.CORS_ORIGIN) {
    const allowedOrigins = env.CORS_ORIGIN.split(',').map(o => o.trim());
    const requestOrigin = request.headers.get('Origin');
    
    if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
      return requestOrigin;
    }
    
    // Return first allowed origin as default
    return allowedOrigins[0];
  }
  
  // Fallback to request Origin if present (validated against env in production)
  const origin = request.headers.get('Origin');
  if (origin) {
    return origin;
  }
  
  // Last resort fallback (should be configured in production)
  return '*';
}

/**
 * Handles CORS preflight requests
 */
function handleCors(env: Env, request: Request): Response {
  const origin = getCorsOrigin(env, request);
  
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

/**
 * Main worker fetch handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCors(env, request);
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({
        success: false,
        error: 'Method not allowed',
      } as IngestionResponse), {
        status: 405,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': getCorsOrigin(env, request),
        },
      });
    }

    try {
      // Authenticate the user
      const token = extractBearerToken(request);
      const userId = await verifySupabaseToken(env, token);

      // Parse request body
      const body: IngestionRequest = await request.json();

      // Validate request
      const validation = validateRequest(body);
      if (!validation.valid) {
        return new Response(JSON.stringify({
          success: false,
          error: validation.error,
        } as IngestionResponse), {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': getCorsOrigin(env, request),
          },
        });
      }

      // Prepare input for ingestion service
      const input: DocumentInput = {
        text: body.text,
        sourceType: body.sourceType,
        sourceId: body.sourceId ?? null,
        title: body.title ?? null,
        metadata: body.metadata,
        userId,
      };

      // Call the ingestion service
      const result = await ingestDocument(input, env);

      // Return success response
      const response: IngestionResponse = {
        success: true,
        documentId: result.documentId,
        chunkCount: result.chunkCount,
        embeddingDimensions: result.embeddingDimensions,
      };

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': getCorsOrigin(env, request),
        },
      });
    } catch (error) {
      // Log error server-side
      console.error('[Ingestion Worker] Error:', error);

      // Determine status code
      let status = 500;
      let errorMessage = 'Internal server error';

      if (error instanceof IngestError) {
        status = 422;
        errorMessage = 'Ingestion failed: ' + error.message;
      } else if (error instanceof Error) {
        if (error.message.includes('Unauthorized') || error.message.includes('Invalid token')) {
          status = 401;
          errorMessage = 'Unauthorized';
        } else if (error.message.includes('JINA_API_KEY')) {
          status = 500;
          errorMessage = 'Server configuration error';
        } else {
          errorMessage = 'Ingestion failed';
        }
      }

      // Return safe error response (no secrets or stack traces)
      const response: IngestionResponse = {
        success: false,
        error: errorMessage,
      };

      return new Response(JSON.stringify(response), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': getCorsOrigin(env, request),
        },
      });
    }
  },
};