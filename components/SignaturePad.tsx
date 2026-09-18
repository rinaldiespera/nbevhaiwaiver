"use client";

import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import SignaturePadNative, { type Options } from "signature_pad";

export interface SignaturePadHandle {
  isEmpty: () => boolean;
  toDataURL: () => string;
  clear: () => void;
}

interface Props {
  disabled?: boolean;
  penColor?: string;
  onEnd?: () => void;
  onBegin?: () => void;
  className?: string;
}

export const SignaturePad = forwardRef<SignaturePadHandle, Props>(
  function SignaturePad(
    { disabled = false, penColor = "#0f172a", onEnd, onBegin, className },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const padRef = useRef<SignaturePadNative | null>(null);
    const savedDataRef = useRef<string | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const disabledRef = useRef<boolean>(disabled);
    disabledRef.current = disabled;

    useImperativeHandle(ref, () => ({
      isEmpty: () => (padRef.current ? padRef.current.isEmpty() : true),
      toDataURL: () =>
        padRef.current
          ? padRef.current.toDataURL("image/png")
          : "data:image/png;base64,",
      clear: () => {
        savedDataRef.current = null;
        padRef.current?.clear();
      },
    }));

    useEffect(() => {
      if (!canvasRef.current) return;
      const opts: Options = {
        penColor,
        backgroundColor: "rgba(255,255,255,1)",
        velocityFilterWeight: 0.6,
        minWidth: 0.7,
        maxWidth: 2.8,
      };
      const pad = new SignaturePadNative(canvasRef.current, opts);
      padRef.current = pad;
      if (disabledRef.current) pad.off();

      const beginHandler = () => onBegin?.();
      const endHandler = () => {
        savedDataRef.current = null;
        onEnd?.();
      };
      pad.addEventListener("beginStroke", beginHandler as never);
      pad.addEventListener("endStroke", endHandler as never);

      const resize = () => {
        if (!canvasRef.current) return;
        const prev = pad.toDataURL("image/png");
        const nonEmpty = !pad.isEmpty();
        const canvas = canvasRef.current;
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const w = canvas.offsetWidth;
        const h = canvas.offsetHeight || 160;
        canvas.width = Math.floor(w * ratio);
        canvas.height = Math.floor(h * ratio);
        const ctx = canvas.getContext("2d");
        ctx?.scale(ratio, ratio);
        pad.clear();
        if (nonEmpty) {
          const img = new Image();
          img.onload = () => ctx?.drawImage(img, 0, 0, w, h);
          img.src = prev;
        }
      };

      resize();
      const ro =
        typeof ResizeObserver !== "undefined" && wrapperRef.current
          ? new ResizeObserver(() => resize())
          : null;
      if (ro && wrapperRef.current) ro.observe(wrapperRef.current);
      window.addEventListener("orientationchange", resize);
      window.addEventListener("resize", resize);

      return () => {
        pad.removeEventListener("beginStroke", beginHandler as never);
        pad.removeEventListener("endStroke", endHandler as never);
        pad.off();
        ro?.disconnect();
        window.removeEventListener("orientationchange", resize);
        window.removeEventListener("resize", resize);
      };
    }, [penColor, onBegin, onEnd]);

    useEffect(() => {
      if (!padRef.current) return;
      if (disabled) {
        padRef.current.off();
      } else {
        padRef.current.on();
      }
    }, [disabled]);

    return (
      <div
        ref={wrapperRef}
        className={
          className ??
          "w-full aspect-[2/1] max-h-[200px] bg-white rounded-lg border border-slate-300 overflow-hidden touch-none select-none"
        }
        style={disabled ? { opacity: 0.55, cursor: "not-allowed" } : undefined}
      >
        <canvas ref={canvasRef} className="block w-full h-full" />
      </div>
    );
  }
);
