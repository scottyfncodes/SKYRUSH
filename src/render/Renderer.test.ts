// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { measureViewport } from './Renderer';

const setWindow = (width: number, height: number, screenW: number, screenH: number, standalone?: boolean) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: height, configurable: true });
  Object.defineProperty(window.screen, 'width', { value: screenW, configurable: true });
  Object.defineProperty(window.screen, 'height', { value: screenH, configurable: true });
  Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
};

describe('measureViewport', () => {
  afterEach(() => setWindow(1024, 768, 1024, 768, undefined));

  it('uses the window size in the browser', () => {
    setWindow(932, 360, 430, 932, undefined);
    expect(measureViewport()).toEqual({ width: 932, height: 360 });
  });

  it('fills the whole display in an iPhone Home Screen app when iOS reports a short height', () => {
    // iPhone in landscape: screen dimensions are reported in portrait terms.
    setWindow(932, 365, 430, 932, true);
    expect(measureViewport()).toEqual({ width: 932, height: 430 });
  });

  it('trusts the window when its width does not match the screen (split view, odd sizes)', () => {
    setWindow(700, 365, 430, 932, true);
    expect(measureViewport()).toEqual({ width: 700, height: 365 });
  });

  it('never shrinks below the reported window height', () => {
    setWindow(932, 430, 430, 932, true);
    expect(measureViewport().height).toBe(430);
  });
});
