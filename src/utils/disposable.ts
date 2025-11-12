/**
 * Resource manager with automatic cleanup
 * Ensures all registered cleanup functions are called in reverse order
 *
 * Usage:
 *   const rm = new ResourceManager();
 *   const watcher = rm.register(fs.watch(...), w => w.close());
 *   const timeout = rm.register(setTimeout(...), t => clearTimeout(t));
 *   try {
 *     // ... work with resources
 *   } finally {
 *     rm.dispose();  // Automatically cleans up watcher and timeout
 *   }
 */
export class ResourceManager {
  private cleanupCallbacks: Array<() => void> = [];
  private disposed = false;

  /**
   * Register a resource with its cleanup function
   * Returns the resource for use
   */
  register<T>(resource: T, cleanup: (resource: T) => void): T {
    if (this.disposed) {
      throw new Error('ResourceManager has been disposed');
    }
    // Store cleanup to execute later
    this.cleanupCallbacks.push(() => cleanup(resource));
    return resource;
  }

  /**
   * Dispose all registered resources in LIFO order (like Go defer)
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    // Execute cleanups in reverse order (LIFO - last registered, first cleaned)
    for (let i = this.cleanupCallbacks.length - 1; i >= 0; i--) {
      try {
        this.cleanupCallbacks[i]();
      } catch {
        // Ignore cleanup errors to ensure all cleanups run
      }
    }
    this.cleanupCallbacks = [];
  }
}

/**
 * Execute async operation with automatic resource cleanup
 *
 * Example:
 *   await withResources(async (rm) => {
 *     const watcher = rm.register(fs.watch(...), w => w.close());
 *     const timeout = rm.register(setTimeout(...), t => clearTimeout(t));
 *     // ... work with resources
 *     // automatic cleanup on success, error, or throw
 *   });
 */
export const withResources = async <T>(work: (rm: ResourceManager) => Promise<T>): Promise<T> => {
  const rm = new ResourceManager();
  try {
    return await work(rm);
  } finally {
    rm.dispose();
  }
};
