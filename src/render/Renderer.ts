import {
  ACESFilmicToneMapping,
  PCFSoftShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
  type Camera,
  type Scene,
} from 'three';

/** Exposure for the garage; each course sets its own while racing. */
export const DEFAULT_EXPOSURE = 1.05;

export type RenderQuality = 'high' | 'low';

export interface RendererOptions {
  shadows: boolean;
  /** 'low' drops scenery props and coarsens the terrain mesh (used without a GPU). */
  quality: RenderQuality;
  maxPixelRatio: number;
}

export const detectWebGL = (): boolean => {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
};

/**
 * True when WebGL runs on a CPU rasterizer (SwiftShader, llvmpipe), e.g. a machine or VM
 * without a usable GPU. Such renderers manage only a few frames per second at full detail.
 */
export const isSoftwareRenderer = (gl: WebGLRenderingContext | WebGL2RenderingContext): boolean => {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof name === 'string' && /swiftshader|llvmpipe|softpipe|software/i.test(name);
};

export const isCoarsePointer = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;

/**
 * The size the game should fill, in CSS pixels. iOS can report a stale, short
 * `innerHeight` (and `100dvh`) after launching from the Home Screen or rotating,
 * which left a dark band under the game; a Home Screen web app owns the whole
 * display, so there the screen's own height wins when the width matches it.
 */
export const measureViewport = (): { width: number; height: number } => {
  const width = Math.max(1, window.innerWidth);
  let height = Math.max(1, window.innerHeight, document.documentElement.clientHeight);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone && screen.width > 0 && screen.height > 0) {
    const long = Math.max(screen.width, screen.height);
    const short = Math.min(screen.width, screen.height);
    const landscape = width >= height;
    const screenWidth = landscape ? long : short;
    const screenHeight = landscape ? short : long;
    if (Math.abs(width - screenWidth) <= 2) height = Math.max(height, screenHeight);
  }
  return { width, height };
};

/** Thin wrapper over WebGLRenderer handling sizing, DPR changes and context loss. */
export class Renderer {
  readonly gl: WebGLRenderer;
  readonly options: RendererOptions;
  width = 1;
  height = 1;
  contextLost = false;
  private readonly onResize: () => void;
  private readonly onContextLost: (event: Event) => void;
  private readonly onContextRestored: () => void;
  private dprMedia: MediaQueryList | null = null;
  private readonly onDprChange: () => void;
  private settleTimers: number[] = [];

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: Partial<RendererOptions> = {},
  ) {
    const coarse = isCoarsePointer();
    this.gl = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.options = {
      shadows: options.shadows ?? !coarse,
      maxPixelRatio: options.maxPixelRatio ?? (coarse ? 1.75 : 2),
      quality: options.quality ?? (isSoftwareRenderer(this.gl.getContext()) ? 'low' : 'high'),
    };
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = DEFAULT_EXPOSURE;
    this.gl.shadowMap.enabled = this.options.shadows;
    this.gl.shadowMap.type = PCFSoftShadowMap;

    this.onResize = () => this.resizeAndSettle();
    this.onContextLost = (event) => {
      event.preventDefault();
      this.contextLost = true;
    };
    this.onContextRestored = () => {
      this.contextLost = false;
    };
    this.onDprChange = () => {
      this.resize();
      this.watchDpr();
    };
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.addEventListener('pageshow', this.onResize);
    window.visualViewport?.addEventListener('resize', this.onResize);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.watchDpr();
    this.resize();
  }

  private watchDpr(): void {
    this.dprMedia?.removeEventListener('change', this.onDprChange);
    if (typeof window.matchMedia === 'function') {
      this.dprMedia = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      this.dprMedia.addEventListener('change', this.onDprChange);
    }
  }

  /** Resizes now and again as iOS settles, since it reports the final size late after rotation. */
  private resizeAndSettle(): void {
    this.resize();
    for (const timer of this.settleTimers) window.clearTimeout(timer);
    this.settleTimers = [150, 500, 1200].map((delay) => window.setTimeout(() => this.resize(), delay));
  }

  resize(): void {
    const { width, height } = measureViewport();
    // The page layout follows the same measurement as the canvas.
    document.documentElement.style.setProperty('--app-height', `${height}px`);
    this.width = width;
    this.height = height;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.options.maxPixelRatio));
    this.gl.setSize(width, height, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  get aspect(): number {
    return this.width / this.height;
  }

  render(scene: Scene, camera: Camera): void {
    if (this.contextLost) return;
    this.gl.render(scene, camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    window.removeEventListener('pageshow', this.onResize);
    window.visualViewport?.removeEventListener('resize', this.onResize);
    for (const timer of this.settleTimers) window.clearTimeout(timer);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.dprMedia?.removeEventListener('change', this.onDprChange);
    this.gl.dispose();
  }
}
