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

export interface RendererOptions {
  shadows: boolean;
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

export const isCoarsePointer = (): boolean =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;

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

  constructor(
    readonly canvas: HTMLCanvasElement,
    options: Partial<RendererOptions> = {},
  ) {
    const coarse = isCoarsePointer();
    this.options = {
      shadows: options.shadows ?? !coarse,
      maxPixelRatio: options.maxPixelRatio ?? (coarse ? 1.75 : 2),
    };
    this.gl = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = DEFAULT_EXPOSURE;
    this.gl.shadowMap.enabled = this.options.shadows;
    this.gl.shadowMap.type = PCFSoftShadowMap;

    this.onResize = () => this.resize();
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

  resize(): void {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
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
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.dprMedia?.removeEventListener('change', this.onDprChange);
    this.gl.dispose();
  }
}
