/**
 * Worker thread for parsing large Terraform workspaces
 */

import * as path from 'path';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

import { ProjectIndex, Address, ParseResult } from '../types';

import { buildIndex, BuildIndexOptions, BuildIndexResult } from './buildIndex';

/**
 * Message types for worker communication
 */
export interface WorkerMessage {
  type: 'build' | 'cancel' | 'result' | 'error' | 'progress';
  id: string;
  payload?: any;
}

/**
 * Build request sent to worker
 */
export interface WorkerBuildRequest {
  files: string[];
  options: BuildIndexOptions;
}

/**
 * Progress update from worker
 */
export interface WorkerProgressUpdate {
  processed: number;
  total: number;
  currentFile: string;
}

/**
 * Threshold for using worker thread (number of files)
 */
const WORKER_THRESHOLD = 500;

/**
 * Worker thread manager for parsing large Terraform workspaces
 */
export class TerraformWorkerManager {
  private currentWorker: Worker | null = null;
  private currentRequestId: string | null = null;
  private progressCallback: ((progress: WorkerProgressUpdate) => void) | null =
    null;

  /**
   * Build index using worker thread if file count exceeds threshold
   */
  public async buildIndex(
    files: string[],
    options: BuildIndexOptions = {},
    onProgress?: (progress: WorkerProgressUpdate) => void
  ): Promise<BuildIndexResult> {
    // Use main thread for small workspaces
    if (files.length <= WORKER_THRESHOLD) {
      console.log(
        `Building index on main thread (${files.length} files <= ${WORKER_THRESHOLD} threshold)`
      );
      return buildIndex(files, options);
    }

    console.log(
      `Building index on worker thread (${files.length} files > ${WORKER_THRESHOLD} threshold)`
    );

    this.progressCallback = onProgress || null;

    return this.buildIndexInWorker(files, options);
  }

  /**
   * Build index in worker thread
   */
  private async buildIndexInWorker(
    files: string[],
    options: BuildIndexOptions
  ): Promise<BuildIndexResult> {
    // Cancel any existing worker
    await this.cancelCurrentBuild();

    return new Promise<BuildIndexResult>((resolve, reject) => {
      const requestId = Date.now().toString();
      this.currentRequestId = requestId;

      // Create worker
      const workerPath = path.join(__dirname, 'worker.js');
      this.currentWorker = new Worker(workerPath, {
        workerData: { requestId },
      });

      // Handle worker messages
      this.currentWorker.on('message', (message: WorkerMessage) => {
        if (message.id !== requestId) {
          return; // Ignore messages from cancelled builds
        }

        switch (message.type) {
          case 'result':
            this.cleanup();
            resolve(message.payload as BuildIndexResult);
            break;

          case 'error':
            this.cleanup();
            reject(new Error(message.payload));
            break;

          case 'progress':
            if (this.progressCallback) {
              this.progressCallback(message.payload as WorkerProgressUpdate);
            }
            break;
        }
      });

      // Handle worker errors
      this.currentWorker.on('error', (error) => {
        this.cleanup();
        reject(error);
      });

      // Handle worker exit
      this.currentWorker.on('exit', (code) => {
        if (code !== 0 && this.currentRequestId === requestId) {
          this.cleanup();
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });

      // Send build request to worker
      const request: WorkerMessage = {
        type: 'build',
        id: requestId,
        payload: { files, options } as WorkerBuildRequest,
      };

      this.currentWorker.postMessage(request);
    });
  }

  /**
   * Cancel current build operation
   */
  public async cancelCurrentBuild(): Promise<void> {
    if (this.currentWorker && this.currentRequestId) {
      const cancelMessage: WorkerMessage = {
        type: 'cancel',
        id: this.currentRequestId,
      };

      this.currentWorker.postMessage(cancelMessage);

      // Wait a bit for graceful shutdown, then terminate
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (this.currentWorker) {
            this.currentWorker.terminate();
          }
          resolve();
        }, 1000);

        if (this.currentWorker) {
          this.currentWorker.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        } else {
          clearTimeout(timeout);
          resolve();
        }
      });
    }

    this.cleanup();
  }

  /**
   * Clean up current worker
   */
  private cleanup(): void {
    this.currentWorker = null;
    this.currentRequestId = null;
    this.progressCallback = null;
  }

  /**
   * Dispose of worker manager
   */
  public async dispose(): Promise<void> {
    await this.cancelCurrentBuild();
  }
}

// Worker thread code (runs when this file is loaded as a worker)
if (!isMainThread) {
  let cancelled = false;
  const requestId = workerData.requestId;

  // Handle messages from main thread
  parentPort?.on('message', async (message: WorkerMessage) => {
    if (message.id !== requestId) {
      return; // Ignore messages for other requests
    }

    try {
      switch (message.type) {
        case 'build':
          await handleBuildRequest(
            message.payload as WorkerBuildRequest,
            message.id
          );
          break;

        case 'cancel':
          cancelled = true;
          process.exit(0);
          break;
      }
    } catch (error) {
      const errorMessage: WorkerMessage = {
        type: 'error',
        id: message.id,
        payload: error instanceof Error ? error.message : String(error),
      };
      parentPort?.postMessage(errorMessage);
    }
  });

  /**
   * Handle build request in worker thread
   */
  async function handleBuildRequest(
    request: WorkerBuildRequest,
    id: string
  ): Promise<void> {
    const { files, options } = request;

    try {
      // Build index with progress reporting
      const result = await buildIndexWithProgress(files, options, id);

      if (!cancelled) {
        const resultMessage: WorkerMessage = {
          type: 'result',
          id,
          payload: result,
        };
        parentPort?.postMessage(resultMessage);
      }
    } catch (error) {
      if (!cancelled) {
        const errorMessage: WorkerMessage = {
          type: 'error',
          id,
          payload: error instanceof Error ? error.message : String(error),
        };
        parentPort?.postMessage(errorMessage);
      }
    }
  }

  /**
   * Build index with progress reporting
   */
  async function buildIndexWithProgress(
    files: string[],
    options: BuildIndexOptions,
    id: string
  ): Promise<BuildIndexResult> {
    // Override options to include progress reporting
    const workerOptions: BuildIndexOptions = {
      ...options,
      verbose: false, // Disable console logging in worker
      progressCallback: (
        processed: number,
        total: number,
        currentFile: string
      ) => {
        if (!cancelled) {
          const progressMessage: WorkerMessage = {
            type: 'progress',
            id,
            payload: { processed, total, currentFile } as WorkerProgressUpdate,
          };
          parentPort?.postMessage(progressMessage);
        }
      },
    };

    return buildIndex(files, workerOptions);
  }
}
