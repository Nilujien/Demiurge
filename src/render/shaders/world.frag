in vec3 v_world; out vec4 o;
uniform sampler2D u_state, u_hydro; uniform int u_N, u_mode, u_overlay, u_cropTufts;
uniform float u_W, u_tq, u_ppu, u_hmin, u_hmax, u_snow;
uniform vec4 u_brush; uniform vec3 u_ringCol;
float hAt(ivec2 c){ return mix(u_hmin, u_hmax, texelFetch(u_state, clamp(c, ivec2(0), ivec2(u_N - 1)), 0).a); }
float hBil(vec2 g){
  g = clamp(g, vec2(0.0), vec2(float(u_N - 1)));
  ivec2 c = ivec2(floor(g)); vec2 f = g - vec2(c);
  return mix(mix(hAt(c), hAt(c + ivec2(1,0)), f.x), mix(hAt(c + ivec2(0,1)), hAt(c + ivec2(1,1)), f.x), f.y);
}
const ivec2 D8[8] = ivec2[8](ivec2(1,0), ivec2(1,1), ivec2(0,1), ivec2(-1,1), ivec2(-1,0), ivec2(-1,-1), ivec2(0,-1), ivec2(1,-1));
// distance normalisée au cours d'eau le plus proche (<1 = dans l'eau) ; segments centre → centre aval
float stream(vec2 p, out float along, out float inten){
  ivec2 c0 = ivec2(floor(p + 0.5));
  float best = 9.0; along = 0.0; inten = 0.0;
  for (int dz = -1; dz <= 1; dz++) for (int dx = -1; dx <= 1; dx++) {
    ivec2 c = c0 + ivec2(dx, dz);
    if (c.x < 0 || c.y < 0 || c.x >= u_N || c.y >= u_N) continue;
    vec4 h = texelFetch(u_hydro, c, 0);
    if (h.g < 0.01) continue;
    int d = (int(h.b * 255.0 + 0.5) & 15) - 1;
    vec2 a = vec2(c);
    float w, dist, t = 0.0;
    if (d < 0) { w = 0.35 + 0.45 * h.g; dist = length(p - a); }          // cuvette : mare
    else {
      w = 0.22 + 0.4 * h.g;
      vec2 ab = vec2(D8[d]);
      t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
      dist = length(p - a - ab * t);
    }
    float r = dist / w;
    if (r < best) { best = r; along = t + float(c.x * 7 + c.y * 13) * 0.37; inten = h.g; }
  }
  return best;
}
vec3 overlay(vec3 col, float v, vec3 lo, vec3 hi, float b){
  float q = floor(clamp(v, 0.0, 1.0) * 5.0 + b) / 5.0;
  return mix(col, mix(lo, hi, q), 0.72);
}
vec3 ring(vec3 col, vec3 p, float b){
  if (u_brush.w < 0.5) return col;
  float d = length(p.xz - u_brush.xy);
  float th = max(0.22, 1.1 / u_ppu);
  if (abs(d - u_brush.z) < th) return u_ringCol;
  if (d < u_brush.z && b > 0.9) return mix(col, u_ringCol, 0.55);
  return col;
}
void main(){
  vec3 p = v_world;
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  float l = 0.28 + 0.72 * max(dot(n, SUN), 0.0);
  float b = bayer(gl_FragCoord.xy);
  ivec2 c = clamp(ivec2(floor(p.xz + 0.5)), ivec2(0), ivec2(u_N - 1));
  vec4 s = texelFetch(u_state, c, 0);
  int soil = int(s.r * 255.0 + 0.5); float fert = s.g, grass = s.b;
  vec4 hy = texelFetch(u_hydro, c, 0);
  float moist = hy.r;
  float wear = float(int(hy.b * 255.0 + 0.5) >> 4) / 15.0;
  vec3 col;
  if (u_mode == 0) {                       // dessus du terrain
    int m = soil;
    bool cliff = abs(n.y) < 0.5;
    if (cliff) m = 3;
    else {
      if (grass > 0.02 && soil != 3 && b < grass * 1.25 - 0.1) m = (soil == 0 || fert < 0.25 || moist < 0.22) ? 5 : 4;
      if (p.y > u_snow + 1.2 * sin(p.x * 0.31) * sin(p.z * 0.27) && soil != 0) m = 6;
    }
    int bd = band(l, b);
    if (m == 4 || m == 5) {                // vagues de vent dans l'herbe
      float w = sin(p.x * 0.55 + p.z * 0.35 - u_tq * 2.2) + 0.5 * sin(p.x * 1.7 - p.z * 1.3 + u_tq * 3.1);
      if (w > 1.05) bd = min(bd + 1, 3);
    }
    if (m == 0 && p.y < u_W + 0.5) bd = max(bd - 1, 0);   // sable mouillé
    if (m <= 2 && moist > 0.55) bd = max(bd - 1, 0);       // sol détrempé
    col = ramp(m, bd);
    if (!cliff && m != 6 && b < wear * 2.0 - 0.7) {    // sentier de terre battue, bords tramés
      col = ramp(0, wear > 0.6 ? 1 : 2);
      if (hash12(floor(p.xz * 4.0)) > 0.93) col = ramp(3, 2);   // cailloux
    }
    bool field = hy.a > 0.002 && !cliff;
    if (field) {                           // champ : sillons, bordure, rangées de céréales
      float crop = (hy.a * 255.0 - 1.0) / 254.0;
      // Billons à z = centre + k/3, là où le renderer plante les touffes de céréales.
      bool ridge = abs(fract((p.z + 0.5) * 3.0) - 0.5) < 0.24;
      col = ramp(1, ridge ? max(bd, 1) : max(bd - 1, 0));   // terre retournée, quel que soit le sol
      if (crop > 0.0) {
        if (u_cropTufts == 0) {            // vu de loin : les rangées colorées remplacent les touffes
          if (ridge && b < crop * 1.3 + 0.15) {
            int cb = bd;
            float w = sin(p.x * 0.7 + p.z * 0.4 - u_tq * 2.4);
            if (w > 0.75) cb = min(cb + 1, 3);
            col = crop >= 0.999 ? ramp(0, max(cb, 2)) : ramp(crop >= 0.6 ? 5 : 4, cb);
          }
        } else if (!ridge && crop > 0.3) col = ramp(1, 0);   // ombre entre les rangées
      }
      // Bordure : bande d'herbe sèche le long des côtés qui ne touchent pas un autre champ.
      vec2 f = p.xz - vec2(c);
      ivec2 side = ivec2(sign(f));
      bool edgeX = abs(f.x) > 0.42 && texelFetch(u_hydro, clamp(c + ivec2(side.x, 0), ivec2(0), ivec2(u_N - 1)), 0).a < 0.002;
      bool edgeZ = abs(f.y) > 0.42 && texelFetch(u_hydro, clamp(c + ivec2(0, side.y), ivec2(0), ivec2(u_N - 1)), 0).a < 0.002;
      if (edgeX || edgeZ) col = ramp(5, max(bd - 1, 1));
    }
    if (!field && !cliff && soil != 3 && m != 6 && fert > grass + 0.25) {   // pousses : la fertilité visible
      if (hash12(floor(p.xz * 3.0)) < (fert - grass - 0.2) * 0.6) col = ramp(11, 1);
    }
    float along, inten;
    float sr = stream(p.xz, along, inten);
    if (sr < 1.0 && p.y > u_W - 0.05) {                      // ruisseaux, rivières, cascades
      if (cliff) col = (fract(along * 2.0 - u_tq * 3.0) < 0.5) ? ramp(11, 0) : ramp(10, 3);
      else {
        int wb = inten > 0.6 ? 1 : 2;
        if (fract(along * 1.6 - u_tq * 1.4) < 0.16) wb = min(wb + 1, 3);
        col = ramp(10, wb);
      }
    }
    if (u_overlay == 1) col = overlay(col, moist, vec3(0.80, 0.62, 0.32), vec3(0.17, 0.39, 0.70), b);
    else if (u_overlay == 2) col = overlay(col, fert, vec3(0.42, 0.30, 0.24), vec3(0.62, 0.92, 0.38), b);
    col = ring(col, p, b);
  } else if (u_mode == 1) {                // tranches du diorama
    float top = hAt(c), d = top - p.y;
    int m;
    if (d < 0.6) { m = soil; if (grass > 0.4 && soil != 3) m = 4; }
    else {
      float k = floor((p.y - u_hmin) / 2.6 + 0.35 * sin(p.x * 0.45 + p.z * 0.45));
      int ki = int(mod(k, 3.0)); m = ki == 0 ? 3 : (ki == 1 ? 1 : 2);
    }
    int bd = band(l, b); if (d > 7.0) bd = max(bd - 1, 0);
    col = ramp(m, bd);
  } else if (u_mode == 2) {                // surface de l'eau
    float dep = u_W - hBil(p.xz) + (b - 0.5) * 0.5;
    int bd = dep > 4.5 ? 0 : (dep > 1.5 ? 1 : 2);
    float sp = sin(p.x * 1.1 + u_tq * 1.7) * sin(p.z * 0.9 - u_tq * 1.3 + p.x * 0.3);
    if (sp > 0.8) bd = min(bd + 1, 3);
    col = ramp(10, bd);
    float fo = 0.3 + 0.14 * sin(u_tq * 2.0 + p.x * 0.7 + p.z * 0.5);
    if (dep < fo) col = ramp(11, 0);
    col = ring(col, p, b);
  } else {                                 // tranche d'eau
    float d = u_W - p.y + (b - 0.5) * 0.8;
    col = ramp(10, d < 1.0 ? 2 : (d < 4.0 ? 1 : 0)) * 0.85;
  }
  o = vec4(col, 1.0);
}
