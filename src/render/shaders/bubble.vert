in vec3 a_pos; in vec4 a_inst; in float a_seed;
uniform mat4 u_vp; uniform vec2 u_low, u_cell;
out vec2 v_px; flat out int v_icon;
// Bulle à taille fixe en pixels basse résolution, ancrée (pointe) au-dessus de la tête et accrochée à la grille.
void main(){
  vec2 ndc = (u_vp * vec4(a_inst.xyz, 1.0)).xy;
  vec2 anchor = floor((ndc * 0.5 + 0.5) * u_low + 0.5) + vec2(-floor(u_cell.x * 0.5), a_seed);
  vec2 pix = anchor + a_pos.xy * u_cell;
  v_px = a_pos.xy * u_cell; v_icon = int(a_inst.w + 0.5);
  gl_Position = vec4(pix / u_low * 2.0 - 1.0, -1.0, 1.0);   // au premier plan
}
