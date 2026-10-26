precision highp float; precision highp int;
uniform vec3 u_ramp[48];
const vec3 SUN = vec3(-0.458, 0.814, 0.356);
float bayer(vec2 fc){
  ivec2 q = ivec2(mod(floor(fc), 4.0)); int i = q.x + q.y * 4;
  const float m[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  return (m[i] + 0.5) / 16.0;
}
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
int band(float l, float b){ return clamp(int(floor(l * 4.0 + (b - 0.5) * 0.85)), 0, 3); }
vec3 ramp(int m, int k){ return u_ramp[m * 4 + k]; }
