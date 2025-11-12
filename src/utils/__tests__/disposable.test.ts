import {describe, it, expect, vi, beforeEach} from 'vitest';
import {ResourceManager, withResources} from '../disposable';

describe('ResourceManager', () => {
  let rm: ResourceManager;

  beforeEach(() => {
    rm = new ResourceManager();
  });

  describe('register', () => {
    it('should register resource and return it', () => {
      const resource = {value: 42};
      const cleanup = vi.fn();

      const result = rm.register(resource, cleanup);

      expect(result).toBe(resource);
      expect(cleanup).not.toHaveBeenCalled();
    });

    it('should throw when registering after dispose', () => {
      rm.dispose();

      expect(() => {
        rm.register({}, vi.fn());
      }).toThrow('ResourceManager has been disposed');
    });
  });

  describe('dispose', () => {
    it('should call cleanup functions in LIFO order', () => {
      const order: number[] = [];
      const cleanup1 = vi.fn(() => order.push(1));
      const cleanup2 = vi.fn(() => order.push(2));
      const cleanup3 = vi.fn(() => order.push(3));

      rm.register('resource1', cleanup1);
      rm.register('resource2', cleanup2);
      rm.register('resource3', cleanup3);

      rm.dispose();

      // LIFO: last registered (3) cleaned first
      expect(order).toEqual([3, 2, 1]);
      expect(cleanup1).toHaveBeenCalledTimes(1);
      expect(cleanup2).toHaveBeenCalledTimes(1);
      expect(cleanup3).toHaveBeenCalledTimes(1);
    });

    it('should call cleanup with the registered resource', () => {
      const resource1 = {id: 'a'};
      const resource2 = {id: 'b'};
      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn();

      rm.register(resource1, cleanup1);
      rm.register(resource2, cleanup2);

      rm.dispose();

      expect(cleanup1).toHaveBeenCalledWith(resource1);
      expect(cleanup2).toHaveBeenCalledWith(resource2);
    });

    it('should continue cleaning up even if one cleanup throws', () => {
      const cleanup1 = vi.fn();
      const cleanup2 = vi.fn(() => {
        throw new Error('Cleanup failed');
      });
      const cleanup3 = vi.fn();

      rm.register('r1', cleanup1);
      rm.register('r2', cleanup2);
      rm.register('r3', cleanup3);

      // Should not throw
      expect(() => rm.dispose()).not.toThrow();

      // All cleanups should have been attempted
      expect(cleanup1).toHaveBeenCalled();
      expect(cleanup2).toHaveBeenCalled();
      expect(cleanup3).toHaveBeenCalled();
    });

    it('should be idempotent', () => {
      const cleanup = vi.fn();
      rm.register('resource', cleanup);

      rm.dispose();
      rm.dispose();
      rm.dispose();

      // Cleanup should only be called once
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('should handle empty resource manager', () => {
      expect(() => rm.dispose()).not.toThrow();
    });
  });
});

describe('withResources', () => {
  it('should automatically dispose resources on success', async () => {
    const cleanup = vi.fn();

    const result = await withResources(async (rm) => {
      rm.register('resource', cleanup);
      return 42;
    });

    expect(result).toBe(42);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('should automatically dispose resources on error', async () => {
    const cleanup = vi.fn();

    await expect(
      withResources(async (rm) => {
        rm.register('resource', cleanup);
        throw new Error('Test error');
      }),
    ).rejects.toThrow('Test error');

    // Cleanup should still be called
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('should dispose multiple resources in LIFO order', async () => {
    const order: number[] = [];
    const cleanup1 = vi.fn(() => order.push(1));
    const cleanup2 = vi.fn(() => order.push(2));

    await withResources(async (rm) => {
      rm.register('r1', cleanup1);
      rm.register('r2', cleanup2);
      return 'done';
    });

    expect(order).toEqual([2, 1]);
  });

  it('should work with real setTimeout', async () => {
    let timeoutCalled = false;
    const timeoutIds: NodeJS.Timeout[] = [];

    await withResources(async (rm) => {
      const timeout = rm.register(
        setTimeout(() => {
          timeoutCalled = true;
        }, 100),
        (t) => clearTimeout(t),
      );
      timeoutIds.push(timeout);

      // Return immediately without waiting for timeout
      return 'done';
    });

    // Wait a bit to see if timeout was cleared
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Timeout should NOT have fired because it was cleaned up
    expect(timeoutCalled).toBe(false);
  });

  it('should cleanup resources even when work function throws', async () => {
    const cleanup = vi.fn();
    let resourceAcquired = false;

    await expect(
      withResources(async (rm) => {
        rm.register('resource', cleanup);
        resourceAcquired = true;
        throw new Error('Intentional error');
      }),
    ).rejects.toThrow('Intentional error');

    expect(resourceAcquired).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
