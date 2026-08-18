/**
 * Embeddings Client for Vector Generation
 *
 * HTTP client for interacting with the embeddings service to generate
 * vector embeddings for text. Used by RAG and feedback loop features.
 */

import { getCloudRunAuthorization } from './cloud_run_auth';

const EMBEDDINGS_URL = process.env.EMBEDDINGS_URL || 'http://localhost:8002';
const EMBEDDINGS_BATCH_TIMEOUT_MS = Number(process.env.EMBEDDINGS_BATCH_TIMEOUT_MS || 300_000);

export interface EmbeddingRequest {
  text: string;
  task_type?: 'query' | 'passage' | 'classification';
  model_name?: string;
}

export interface EmbeddingResponse {
  embedding: number[];
  dimensions: number;
  model: string;
}

export interface BatchEmbedResponse {
  embeddings: number[][];
  dimensions: number;
}

export interface EmbeddingServiceStatus {
  status: 'healthy' | 'unhealthy';
  model_loaded: boolean;
  model_name?: string;
  dimensions?: number;
}

/**
 * Embeddings Client
 *
 * Provides vector embedding generation for text using the Jina Embeddings V5 service.
 */
export class EmbeddingsClient {
  private baseUrl: string;
  private expectedDimensions = 1024; // Jina Embeddings V5

  constructor(baseUrl: string = EMBEDDINGS_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Generate embedding for text
   *
   * @param text - The text to embed
   * @param taskType - Optional task type for optimization
   * @returns Vector embedding array
   */
  async generateEmbedding(text: string, taskType?: 'query' | 'passage' | 'classification'): Promise<number[]> {
    // Input size validation: prevent embedding service OOM
    if (text.length > 50000) {
      throw new Error(`Text exceeds maximum allowed size of 50000 characters (got ${text.length})`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
      const url = `${this.baseUrl}/embed`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...await getCloudRunAuthorization(url),
        },
        body: JSON.stringify({
          text,
          task_type: taskType,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embeddings service error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as EmbeddingResponse;

      if (data.dimensions !== this.expectedDimensions) {
        console.warn(
          `Unexpected embedding dimensions: expected ${this.expectedDimensions}, got ${data.dimensions}`
        );
      }

      return data.embedding;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to generate embedding: ${error.message}`);
      }
      throw new Error('Failed to generate embedding: Unknown error');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Generate embeddings for multiple texts (batch)
   *
   * @param texts - Array of texts to embed
   * @returns Array of vector embeddings
   */
  async generateBatchEmbeddings(texts: string[]): Promise<number[][]> {
    // Validate all inputs before making network calls
    for (let i = 0; i < texts.length; i++) {
      if (texts[i].length > 50000) {
        throw new Error(`Text at index ${i} exceeds maximum allowed size of 50000 characters (got ${texts[i].length})`);
      }
    }

    // H20: chunk large batches into groups of 32 to avoid overloading the
    // embeddings service. The service may have its own limits; splitting
    // client-side avoids 413/503 errors on oversized payloads.
    const CHUNK_SIZE = 32;
    const MAX_CHUNK_CHARACTERS = 200000;
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < texts.length;) {
      const batch: string[] = [];
      let batchCharacters = 0;
      while (i < texts.length && batch.length < CHUNK_SIZE) {
        const next = texts[i];
        if (batch.length > 0 && batchCharacters + next.length > MAX_CHUNK_CHARACTERS) break;
        batch.push(next);
        batchCharacters += next.length;
        i++;
      }
      const embeddings = await this._sendBatch(batch);
      allEmbeddings.push(...embeddings);
    }
    return allEmbeddings;
  }

  private async _sendBatch(texts: string[]): Promise<number[][]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EMBEDDINGS_BATCH_TIMEOUT_MS);

    try {
      const url = `${this.baseUrl}/embed/batch`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...await getCloudRunAuthorization(url),
        },
        body: JSON.stringify({
          texts,
          task_type: 'text-document',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Batch embeddings service error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as BatchEmbedResponse;

      if (data.dimensions !== this.expectedDimensions) {
        console.warn(
          `Unexpected batch embedding dimensions: expected ${this.expectedDimensions}, got ${data.dimensions}`
        );
      }

      return data.embeddings;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Failed to generate batch embeddings: timed out after ${EMBEDDINGS_BATCH_TIMEOUT_MS}ms`);
      }
      if (error instanceof Error) {
        throw new Error(`Failed to generate batch embeddings: ${error.message}`);
      }
      throw new Error('Failed to generate batch embeddings: Unknown error');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Health check for embeddings service
   */
  async healthCheck(): Promise<EmbeddingServiceStatus> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
      const url = `${this.baseUrl}/health`;
      const response = await fetch(url, {
        headers: await getCloudRunAuthorization(url),
        signal: controller.signal,
      });

      if (!response.ok) {
        return { status: 'unhealthy', model_loaded: false };
      }

      const data = await response.json() as any;
      return {
        status: data.status === 'ok' ? 'healthy' : 'unhealthy',
        model_loaded: data.model_loaded ?? true,
        model_name: data.model_name,
        dimensions: data.dimensions,
      };
    } catch (error) {
      return { status: 'unhealthy', model_loaded: false };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Export singleton instance
export const embeddingsClient = new EmbeddingsClient();
