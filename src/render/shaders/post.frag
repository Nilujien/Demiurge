uniform sampler2D u_col, u_dep; uniform int u_ps; uniform ivec2 u_low;
uniform vec3 u_skyT, u_skyB; uniform float u_thr, u_tq;
out vec4 o;
float D(ivec2 t){ return texelFetch(u_dep, clamp(t, ivec2(0), u_low - 1), 0).r; }
void main(){
  ivec2 t = min(ivec2(gl_FragCoord.xy) / u_ps, u_low - 1);
  float d = D(t);
  float b = bayer(vec2(t));
  if (d >= 0.99999) {
    float y = float(t.y) / float(u_low.y);
    float q = floor(y * 7.0 + b) / 7.0;
    vec3 c = mix(u_skyB, u_skyT, q);
    float st = hash12(vec2(t));
    if (y > 0.45 && st > 0.9975) c = mix(c, vec3(0.93, 0.9, 0.82), 0.6 + 0.4 * step(0.5, fract(u_tq * 0.5 + st * 31.0)));
    o = vec4(c, 1.0); return;
  }
  vec3 c = texelFetch(u_col, t, 0).rgb;
  float dn = max(max(D(t + ivec2(1,0)), D(t - ivec2(1,0))), max(D(t + ivec2(0,1)), D(t - ivec2(0,1))));
  if (dn - d > u_thr) c = mix(c * 0.38, vec3(0.05, 0.04, 0.10), 0.35);
  o = vec4(c, 1.0);
}
