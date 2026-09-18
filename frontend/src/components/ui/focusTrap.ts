const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true'
  );
}

export function wrapTabFocus(event: KeyboardEvent, container: HTMLElement) {
  if (event.key !== 'Tab') {
    return;
  }

  const focusableElements = getFocusableElements(container);
  if (focusableElements.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];
  const activeElement = document.activeElement;

  if (event.shiftKey && (activeElement === firstElement || !container.contains(activeElement))) {
    event.preventDefault();
    lastElement.focus();
  } else if (
    !event.shiftKey &&
    (activeElement === lastElement || !container.contains(activeElement))
  ) {
    event.preventDefault();
    firstElement.focus();
  }
}
