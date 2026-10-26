in vec3 v_world; flat in int v_mat; in float v_seed; out vec4 o;
uniform float u_dither;
void main(){
  float b = bayer(gl_FragCoord.xy);
  if (b < u_dither) discard;                  // transparence tramée (nuages)
  vec3 n = normalize(cross(dFdx(v_world), dFdy(v_world)));
  float l = 0.3 + 0.7 * max(dot(n, SUN), 0.0) + (v_seed - 0.5) * 0.3;
  if (v_mat == 10) l += 0.45;                 // matériau eau (gouttes, tuniques) : clair même de flanc
  o = vec4(ramp(v_mat, band(l, b)), 1.0);
}
