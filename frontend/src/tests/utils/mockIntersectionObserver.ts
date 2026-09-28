type ObserverCallback = IntersectionObserverCallback;

type MockObserverInstance = {
  callback: ObserverCallback;
  targets: Set<Element>;
};

let instances: MockObserverInstance[] = [];
let originalDescriptor: PropertyDescriptor | undefined;

export const installMockIntersectionObserver = () => {
  instances = [];
  originalDescriptor = Object.getOwnPropertyDescriptor(window, 'IntersectionObserver');

  class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin: string;
    readonly thresholds: ReadonlyArray<number> = [0];
    private readonly instance: MockObserverInstance;

    constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
      this.rootMargin = options?.rootMargin ?? '0px';
      this.instance = { callback, targets: new Set() };
      instances.push(this.instance);
    }

    observe(target: Element) {
      this.instance.targets.add(target);
    }
    unobserve(target: Element) {
      this.instance.targets.delete(target);
    }
    disconnect() {
      this.instance.targets.clear();
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }

  Object.defineProperty(window, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: MockIntersectionObserver,
  });

  return restoreMockIntersectionObserver;
};

export const restoreMockIntersectionObserver = () => {
  if (originalDescriptor) {
    Object.defineProperty(window, 'IntersectionObserver', originalDescriptor);
    originalDescriptor = undefined;
  } else if (instances.length) {
    delete (window as Window & { IntersectionObserver?: typeof IntersectionObserver })
      .IntersectionObserver;
  }
  instances = [];
};

export const triggerIntersectionObservers = (isIntersecting = true) => {
  for (const instance of [...instances]) {
    const entries = [...instance.targets].map(
      (target) =>
        ({
          isIntersecting,
          target,
          intersectionRatio: isIntersecting ? 1 : 0,
          boundingClientRect: target.getBoundingClientRect(),
          intersectionRect: target.getBoundingClientRect(),
          rootBounds: null,
          time: Date.now(),
        }) satisfies IntersectionObserverEntry
    );
    if (entries.length) instance.callback(entries, {} as IntersectionObserver);
  }
};
