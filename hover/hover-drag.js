/**
 * hover-drag.js  (content script 3/5)
 * --------------------------------------------------------------------------
 * Pointer-driven drag and resize, independent of any markup.
 *
 * Both helpers use pointer capture, so they keep working when the cursor
 * runs over the iframe or leaves the window. `onStart`/`onEnd` let the caller
 * disable the iframe's pointer events while dragging (an iframe would
 * otherwise swallow the move events).
 * -------------------------------------------------------------------------- */
(function () {
  const ns = self.__dcHover;

  /** Movement (px) below which a press counts as a click, not a drag. */
  const CLICK_SLOP = 4;

  /**
   * Makes `handle` drag a rect.
   * @param {HTMLElement} handle  element the user grabs
   * @param {{getRect:()=>{x:number,y:number}, onMove:(x:number,y:number)=>void,
   *          onStart?:()=>void, onEnd?:(moved:boolean)=>void}} cb
   */
  function makeDraggable(handle, cb) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button")) return;
      const start = cb.getRect();
      const originX = e.clientX, originY = e.clientY;
      let moved = false;
      handle.setPointerCapture(e.pointerId);
      cb.onStart?.();

      const move = (ev) => {
        const dx = ev.clientX - originX, dy = ev.clientY - originY;
        if (!moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
        moved = true;
        cb.onMove(start.x + dx, start.y + dy);
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        cb.onEnd?.(moved);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
      e.preventDefault();
    });
  }

  /**
   * Makes `handle` resize a rect from its bottom-right corner.
   * @param {{getRect:()=>{w:number,h:number}, onResize:(w:number,h:number)=>void,
   *          onStart?:()=>void, onEnd?:()=>void}} cb
   */
  function makeResizable(handle, cb) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      const start = cb.getRect();
      const originX = e.clientX, originY = e.clientY;
      handle.setPointerCapture(e.pointerId);
      cb.onStart?.();

      const move = (ev) => cb.onResize(start.w + ev.clientX - originX, start.h + ev.clientY - originY);
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        cb.onEnd?.();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
      e.preventDefault();
    });
  }

  ns.drag = { makeDraggable, makeResizable };
})();
