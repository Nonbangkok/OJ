import { isApplePlatform, modifierLabel, shortcutLabel } from '../../utils/shortcuts';

const setPlatform = (value: string) => Object.defineProperty(window.navigator, 'platform', { value, configurable: true });

describe('shortcut labels', () => {
  afterEach(() => setPlatform(''));

  it.each([['MacIntel', true], ['iPhone', true], ['iPad', true], ['Win32', false], ['Linux x86_64', false], ['', false]])(
    'platform %p is Apple: %p', (platform, apple) => {
      setPlatform(platform);
      expect(isApplePlatform()).toBe(apple);
    },
  );

  it('shows ⌘ on Apple and Ctrl elsewhere', () => {
    setPlatform('MacIntel');
    expect(modifierLabel()).toBe('⌘');
    expect(shortcutLabel('K')).toBe('⌘K');
    expect(shortcutLabel('↵')).toBe('⌘↵');
    setPlatform('Win32');
    expect(modifierLabel()).toBe('Ctrl');
    expect(shortcutLabel('K')).toBe('Ctrl+K');
    expect(shortcutLabel('↵')).toBe('Ctrl+↵');
  });
});
