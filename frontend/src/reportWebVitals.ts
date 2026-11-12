const reportWebVitals = (onPerfEntry?: (metric: unknown) => void) => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    // FID was removed upstream in web-vitals v5; INP replaces it.
    import('web-vitals').then(({ onCLS, onINP, onFCP, onLCP, onTTFB }) => {
      onCLS(onPerfEntry);
      onINP(onPerfEntry);
      onFCP(onPerfEntry);
      onLCP(onPerfEntry);
      onTTFB(onPerfEntry);
    });
  }
};

export default reportWebVitals;
