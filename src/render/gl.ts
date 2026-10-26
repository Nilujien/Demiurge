/** Utilitaires WebGL2 minimaux : compilation, programmes, textures. */

export const ATTRIB = { pos: 0, mat: 1, inst: 2, seed: 3 } as const;

export class ShaderError extends Error {}

function compile(gl: WebGL2RenderingContext, type: number, src: string, label: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new ShaderError(`Création du shader impossible : ${label}`);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new ShaderError(`${label} : ${gl.getShaderInfoLog(s) ?? 'erreur inconnue'}`);
  }
  return s;
}

export interface Program {
  readonly handle: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string, label: string): Program {
  const p = gl.createProgram();
  if (!p) throw new ShaderError(`Création du programme impossible : ${label}`);
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, `${label}.vert`));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, `${label}.frag`));
  gl.bindAttribLocation(p, ATTRIB.pos, 'a_pos');
  gl.bindAttribLocation(p, ATTRIB.mat, 'a_mat');
  gl.bindAttribLocation(p, ATTRIB.inst, 'a_inst');
  gl.bindAttribLocation(p, ATTRIB.seed, 'a_seed');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new ShaderError(`${label} (link) : ${gl.getProgramInfoLog(p) ?? 'erreur inconnue'}`);
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    handle: p,
    uniform(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
      return cache.get(name) ?? null;
    },
  };
}

/** Texture 2D échantillonnée au plus proche voisin (aucun lissage : pixel art et données). */
export function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  internalFormat: number,
  format: number,
  type: number,
): WebGLTexture {
  const t = gl.createTexture();
  if (!t) throw new Error('Création de texture impossible');
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

/** VAO avec un tampon de positions vec3 (attribut 0), optionnellement indexé. */
export function createPositionVAO(
  gl: WebGL2RenderingContext,
  data: Float32Array,
  usage: number,
  indices?: Uint32Array,
): { vao: WebGLVertexArrayObject; vbo: WebGLBuffer } {
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  if (!vao || !vbo) throw new Error('Création de VAO impossible');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  gl.enableVertexAttribArray(ATTRIB.pos);
  gl.vertexAttribPointer(ATTRIB.pos, 3, gl.FLOAT, false, 0, 0);
  if (indices) {
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
  }
  gl.bindVertexArray(null);
  return { vao, vbo };
}

export function hexToRgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255) as [number, number, number];
}
