/**
 * CONTRACT: DataSourceRegistry — maps logical source IDs to provider instances.
 *
 * GUARANTEES:
 *   - get() returns the provider for a known sourceId, or undefined if not found.
 *   - The registry is immutable after construction — no add/remove at runtime.
 *
 * EXPECTS:
 *   - Constructor receives a Record<string, DataSourceProvider> built at DI time.
 *   - Keys are logical source names (e.g. "predictions") — consumers never see backend config.
 */

import type { DataSourceProvider } from './datasource.types.js';

export class DataSourceRegistry {
  private sources: Map<string, DataSourceProvider>;

  constructor(sources: Record<string, DataSourceProvider>) {
    this.sources = new Map(Object.entries(sources));
  }

  get(sourceId: string): DataSourceProvider | undefined {
    return this.sources.get(sourceId);
  }
}
