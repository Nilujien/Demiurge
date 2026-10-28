/**
 * Entrées unifiées souris / tactile / stylet (Pointer Events) et clavier.
 * Ne connaît ni la simulation ni le rendu : elle expose un état et des intentions.
 */

export type GestureMode = 'idle' | 'paint' | 'pan' | 'pinch' | 'settling';

export interface InputHandlers {
  /** Déplacement de vue en pixels CSS. */
  pan(dx: number, dy: number): void;
  zoom(steps: number): void;
  /** Début d'un geste de peinture (permet de relever l'altitude visée). */
  strokeStart(): void;
  key(key: string): void;
  undo(): void;
  redo(): void;
}

export class Input {
  /** Position du pointeur en pixels CSS, relative à la fenêtre. */
  x = 0;
  y = 0;
  /** Le pointeur survole le monde (souris) ou le touche (tactile). */
  hovering = false;
  mode: GestureMode = 'idle';

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = { dist: 0, mx: 0, my: 0 };
  private spaceDown = false;
  private wheelAccum = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly h: InputHandlers,
  ) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerenter', (e) => this.track(e));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.hovering = false;
    });
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.up(e));
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => {
      if (e.key === ' ') this.spaceDown = false;
    });
  }

  /** Le pinceau doit-il s'afficher ? */
  get brushVisible(): boolean {
    return this.hovering && (this.mode === 'idle' || this.mode === 'paint');
  }

  private track(e: PointerEvent): void {
    this.x = e.clientX;
    this.y = e.clientY;
    this.hovering = true;
  }

  private down(e: PointerEvent): void {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.track(e);
    if (this.pointers.size === 2 && e.pointerType === 'touch') {
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      this.mode = 'pinch';
      this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      return;
    }
    if (this.pointers.size > 1) return;
    if (e.button === 1 || e.button === 2 || this.spaceDown) {
      this.mode = 'pan';
      e.preventDefault();
    } else if (e.button === 0) {
      this.mode = 'paint';
      this.h.strokeStart();
    }
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (this.mode === 'pinch' && p) {
      p.x = e.clientX;
      p.y = e.clientY;
      const [a, b] = [...this.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.h.pan(mx - this.pinch.mx, my - this.pinch.my);
      this.pinch.mx = mx;
      this.pinch.my = my;
      if (dist / this.pinch.dist > 1.3) {
        this.h.zoom(1);
        this.pinch.dist = dist;
      } else if (dist / this.pinch.dist < 0.77) {
        this.h.zoom(-1);
        this.pinch.dist = dist;
      }
      return;
    }
    if (this.mode === 'pan') this.h.pan(e.clientX - this.x, e.clientY - this.y);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    this.track(e);
  }

  private up(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.mode = 'idle';
      if (e.pointerType === 'touch') this.hovering = false;
    } else if (this.mode === 'pinch') {
      this.mode = 'settling'; // un doigt reste posé après un pincement : ne pas peindre
    }
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.wheelAccum += e.deltaY;
    if (Math.abs(this.wheelAccum) > 50) {
      this.h.zoom(this.wheelAccum < 0 ? 1 : -1);
      this.wheelAccum = 0;
    }
  }

  private keyDown(e: KeyboardEvent): void {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement) return;
    if (e.ctrlKey || e.metaKey) {
      // Les autres raccourcis avec Ctrl restent au navigateur.
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') {
        e.preventDefault();
        if (k === 'y' || e.shiftKey) this.h.redo();
        else this.h.undo();
      }
      return;
    }
    if (e.key === ' ') {
      this.spaceDown = true;
      e.preventDefault();
      return;
    }
    this.h.key(e.key.toLowerCase());
  }
}
