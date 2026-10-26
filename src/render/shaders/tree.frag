in vec3 v_world; flat in int v_mat; in float v_seed; out vec4 o;
void main(){
  vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
  float l = 0.3 + 0.7 * max(dot(n, SUN), 0.0) + (v_seed - 0.5) * 0.3;
  o = vec4(ramp(v_mat, band(l, bayer(gl_FragCoord.xy))), 1.0);
}
