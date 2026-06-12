/**
 * Minimal type shim for apify-client.
 * The real package is added to package.json and will be installed at deploy time.
 * This shim keeps tsc clean without requiring node_modules.
 */
declare module "apify-client" {
  export interface ApifyClientOptions {
    token: string;
  }

  export interface ActorStartOptions {
    waitForFinish?: number;
  }

  export interface RunInfo {
    defaultDatasetId: string;
    [key: string]: unknown;
  }

  export interface DatasetItems {
    items: unknown[];
  }

  export interface ActorHandle {
    call(input: Record<string, unknown>, options?: ActorStartOptions): Promise<RunInfo>;
  }

  export interface DatasetHandle {
    listItems(): Promise<DatasetItems>;
  }

  export class ApifyClient {
    constructor(options: ApifyClientOptions);
    actor(actorName: string): ActorHandle;
    dataset(datasetId: string): DatasetHandle;
  }
}
