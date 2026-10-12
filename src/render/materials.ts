import { Color, DoubleSide, MeshStandardMaterial, MeshBasicMaterial, AdditiveBlending } from 'three';

/** Shared palette so the world, gates and UI read as one product. */
export const PALETTE = {
  graphite: 0x1d2229,
  navy: 0x121a2a,
  warmWhite: 0xf3eee4,
  amber: 0xffa524,
  cyan: 0x2dd4ea,
  orange: 0xff6a1f,
  red: 0xe8392a,
  sand: 0xc4a97d,
  rock: 0x7c6251,
  rockDark: 0x3d3a3c,
  snow: 0xe9e6e0,
  skyTop: 0x1c2f55,
  skyHorizon: 0xe8cfae,
  fog: 0xd7c0a2,
} as const;

export const createBodyMaterial = (color: number): MeshStandardMaterial =>
  new MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.38 });

export const createAccentMaterial = (color: number): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.3,
    emissive: new Color(color),
    emissiveIntensity: 0.22,
  });

export const createDarkMetalMaterial = (): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.55, metalness: 0.7 });

export const createCanopyMaterial = (color: number): MeshStandardMaterial =>
  new MeshStandardMaterial({
    color,
    roughness: 0.15,
    metalness: 0.6,
    emissive: new Color(color),
    emissiveIntensity: 0.35,
  });

export const createGlowMaterial = (color: number, opacity = 0.9): MeshBasicMaterial =>
  new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
