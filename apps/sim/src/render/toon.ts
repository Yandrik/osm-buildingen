import {
  type Camera,
  Color,
  DataTexture,
  DepthTexture,
  FloatType,
  Mesh,
  MeshToonMaterial,
  type MeshToonMaterialParameters,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  RedFormat,
  type Scene,
  ShaderMaterial,
  type WebGLProgramParametersWithUniforms,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';

/** Three light bands: shadow side, half lit, lit. */
const bands = new Uint8Array([90, 170, 255]);
export const gradientMap = new DataTexture(bands, bands.length, 1, RedFormat);
gradientMap.minFilter = NearestFilter;
gradientMap.magFilter = NearestFilter;
gradientMap.generateMipmaps = false;
gradientMap.needsUpdate = true;

/**
 * Makes a toon material also write its view-space normal to the second colour attachment,
 * which the outline pass uses for crease lines. Writing to an attachment that does not
 * exist (rendering straight to the canvas) is harmless.
 */
export function writeNormals(shader: WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nlayout(location = 1) out highp vec4 gNormal;')
    .replace(
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\ngNormal = vec4(normalize(normal) * 0.5 + 0.5, 1.0);',
    );
}

export function toon(parameters: MeshToonMaterialParameters = {}): MeshToonMaterial {
  const material = new MeshToonMaterial({ gradientMap, ...parameters });
  material.onBeforeCompile = writeNormals;
  return material;
}

/**
 * Ink outlines. Creases come from the normal buffer (stable while moving, since normals do
 * not change with distance). Silhouettes come from depth: the renderer uses a logarithmic
 * depth buffer, so depth is turned back into view distance first. A silhouette needs both a
 * depth jump and a kink in 1/distance (the Laplacian, zero on any plane however steeply it
 * is seen), so grazing ground does not get inked.
 */
export class OutlinePass {
  private readonly target: WebGLRenderTarget;
  private readonly material: ShaderMaterial;
  private readonly quad: Mesh;
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  enabled = true;

  /** `lineWidth` in render-target pixels; pass the device pixel ratio so lines keep their size. */
  constructor(
    width: number,
    height: number,
    samples: number,
    private readonly lineWidth = 1,
  ) {
    this.target = new WebGLRenderTarget(width, height, { samples, count: 2 });
    this.target.depthTexture = new DepthTexture(width, height, FloatType);
    this.material = new ShaderMaterial({
      uniforms: {
        tColor: { value: this.target.textures[0] },
        tNormal: { value: this.target.textures[1] },
        tDepth: { value: this.target.depthTexture },
        texel: { value: [lineWidth / width, lineWidth / height] },
        far: { value: 1 },
        ink: { value: new Color('#2a2622') },
        fadeEnd: { value: 3000 },
        creaseEnd: { value: 400 },
        debugView: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tNormal;
        uniform sampler2D tDepth;
        uniform vec2 texel;
        uniform float far;
        uniform vec3 ink;
        uniform float fadeEnd;
        uniform float creaseEnd;
        uniform int debugView;
        varying vec2 vUv;
        float dist(vec2 uv) {
          return pow(far + 1.0, texture2D(tDepth, uv).x) - 1.0;
        }
        vec3 nrm(vec2 uv) {
          return texture2D(tNormal, uv).xyz * 2.0 - 1.0;
        }
        void main() {
          vec4 c = texture2D(tColor, vUv);
          float d0 = dist(vUv);
          if (d0 > far * 0.98) { gl_FragColor = c; return; }
          vec2 dx = vec2(texel.x, 0.0);
          vec2 dy = vec2(0.0, texel.y);
          float l = dist(vUv - dx);
          float r = dist(vUv + dx);
          float u = dist(vUv + dy);
          float b = dist(vUv - dy);

          // Silhouettes: only the near side of a depth step gets ink, so lines stay 1 px.
          float i0 = 1.0 / d0;
          float lap = abs(1.0 / l + 1.0 / r + 1.0 / u + 1.0 / b - 4.0 * i0) / i0;
          float jump = (max(max(l, r), max(u, b)) - d0) / d0;
          float sil = smoothstep(0.01, 0.04, lap) * smoothstep(0.03, 0.08, jump);

          // Creases: angle between neighbouring normals, ignored between nearly coplanar
          // faces (smooth terrain, the facets of a tree crown at a distance).
          vec3 n0 = nrm(vUv);
          float nd = 0.0;
          nd = max(nd, 1.0 - dot(n0, nrm(vUv + dx)));
          nd = max(nd, 1.0 - dot(n0, nrm(vUv - dx)));
          nd = max(nd, 1.0 - dot(n0, nrm(vUv + dy)));
          nd = max(nd, 1.0 - dot(n0, nrm(vUv - dy)));
          float crease = smoothstep(0.35, 0.6, nd) * (1.0 - smoothstep(creaseEnd * 0.5, creaseEnd, d0));

          float edge = max(sil, crease) * (1.0 - smoothstep(fadeEnd * 0.5, fadeEnd, d0));
          gl_FragColor = vec4(mix(c.rgb, ink, edge * 0.85), c.a);
          if (debugView == 1) gl_FragColor = vec4(n0 * 0.5 + 0.5, 1.0);
          if (debugView == 2) gl_FragColor = vec4(vec3(1.0 - edge), 1.0);
          #include <colorspace_fragment>
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.material);
    this.quad.frustumCulled = false;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    (this.material.uniforms.texel as { value: number[] }).value = [
      this.lineWidth / width,
      this.lineWidth / height,
    ];
  }

  /** 0 = normal, 1 = normal buffer, 2 = edge mask. */
  set debugView(v: number) {
    (this.material.uniforms.debugView as { value: number }).value = v;
  }

  set fadeEnd(v: number) {
    (this.material.uniforms.fadeEnd as { value: number }).value = v;
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: Camera & { far: number }): void {
    if (!this.enabled) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    (this.material.uniforms.far as { value: number }).value = camera.far;
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(this.quad, this.camera);
  }
}
