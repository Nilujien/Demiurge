in vec3 a_pos; in float a_mat; in vec4 a_inst; in float a_seed;
uniform mat4 u_vp; uniform float u_tq;
out vec3 v_world; flat out int v_mat; out float v_seed;
void main(){
  vec3 p = a_pos;
  float ang = a_seed * 6.2831, c = cos(ang), s = sin(ang);
  p.xz = mat2(c, -s, s, c) * p.xz;
  if (a_mat > 7.5 && a_mat < 9.5) {          // feuillage seulement : le vent
    float k = max(p.y - 0.4, 0.0);
    p.x += sin(u_tq * 2.6 + a_seed * 40.0) * 0.07 * k;
    p.z += cos(u_tq * 2.1 + a_seed * 23.0) * 0.05 * k;
  }
  vec3 w = a_inst.xyz + p * a_inst.w;
  v_world = w; v_mat = int(a_mat + 0.5); v_seed = a_seed;
  gl_Position = u_vp * vec4(w, 1.0);
}
