in vec2 v_px; flat in int v_icon; out vec4 o;
uniform sampler2D u_atlas; uniform vec2 u_cell;
void main(){
  ivec2 p = ivec2(floor(v_px));
  p.y = int(u_cell.y) - 1 - p.y;            // ligne 0 de l'atlas = haut de la bulle
  vec4 t = texelFetch(u_atlas, ivec2(v_icon * int(u_cell.x) + p.x, p.y), 0);
  if (t.a < 0.5) discard;
  o = vec4(t.rgb, 1.0);
}
