"use client";

import { useEffect, useRef, useState } from "react";
import { CameraIcon, XIcon } from "./icons";
import { cn } from "@/lib/cn";

// The Shape Detection API is not in lib.dom yet.
type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> };
type BarcodeDetectorCtor = {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

function nativeCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector ?? null;
}

const FORMATS = ["code_128", "qr_code"];

/**
 * The browser's own BarcodeDetector where it reads both tag symbols (Chrome
 * on Android and macOS), else the ZXing-based polyfill — loaded only when the
 * camera opens, so the till page does not pay for it up front. Chrome on
 * Windows, Firefox and desktop Safari all take the polyfill path.
 */
let ctorPromise: Promise<BarcodeDetectorCtor> | null = null;
function loadDetector(): Promise<BarcodeDetectorCtor> {
  ctorPromise ??= (async () => {
    const native = nativeCtor();
    if (native) {
      try {
        const formats = native.getSupportedFormats ? await native.getSupportedFormats() : FORMATS;
        if (FORMATS.every((f) => formats.includes(f))) return native;
      } catch {
        // Fall through to the polyfill.
      }
    }
    const mod = await import("barcode-detector/pure");
    return mod.BarcodeDetector as unknown as BarcodeDetectorCtor;
  })();
  return ctorPromise;
}

/**
 * Camera scanning of tag barcodes and QR codes. Shown wherever the browser
 * can open a camera; USB/Bluetooth scanners keep working as keyboard input
 * everywhere.
 */
export function CameraScanButton({
  onDetected,
  className,
  tone = "light",
}: {
  onDetected: (code: string) => void;
  className?: string;
  tone?: "light" | "dark";
}) {
  const [supported, setSupported] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // A camera is all it takes now: the detector itself always loads.
    setSupported(Boolean(navigator.mediaDevices?.getUserMedia));
  }, []);

  if (!supported) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Scan with camera"
        title="Scan with camera"
        className={cn(
          "g-btn shrink-0 px-3 text-sm",
          tone === "dark" ? "bg-paper/10 text-paper hover:bg-paper/20" : "g-btn-secondary",
          className
        )}
      >
        <CameraIcon size={16} />
        <span className="hidden sm:inline">Camera</span>
      </button>
      {open ? (
        <CameraDialog
          onClose={() => setOpen(false)}
          onDetected={(c) => {
            setOpen(false);
            onDetected(c);
          }}
        />
      ) : null}
    </>
  );
}

function CameraDialog({ onClose, onDetected }: { onClose: () => void; onDetected: (code: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let detector: BarcodeDetectorLike | null = null;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let busy = false;
    loadDetector()
      .then((Ctor) => {
        detector = new Ctor({ formats: FORMATS });
      })
      .catch(() => setError("Could not load the scanner. Type the code or use a USB scanner instead."));

    async function tick() {
      if (stopped) return;
      const v = videoRef.current;
      if (v && v.readyState >= 2 && !busy && detector) {
        busy = true;
        try {
          const found = await detector.detect(v);
          const code = found.find((b) => b.rawValue.trim())?.rawValue;
          if (code && !stopped) {
            stopped = true;
            onDetected(code);
            return;
          }
        } catch {
          // A frame that fails to decode is normal; keep scanning.
        } finally {
          busy = false;
        }
      }
      raf = requestAnimationFrame(tick);
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then((s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = s;
        return v.play().then(() => {
          raf = requestAnimationFrame(tick);
        });
      })
      .catch((e: unknown) => {
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access for this site and try again."
            : "Could not start the camera."
        );
      });

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      document.removeEventListener("keydown", onKey);
    };
    // onDetected/onClose are stable for the dialog's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Scan barcode with camera"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-ink shadow-2"
        onClick={(e) => e.stopPropagation()}
      >
        <video ref={videoRef} playsInline muted className="aspect-[4/3] w-full bg-ink object-cover" />
        <div className="pointer-events-none absolute inset-x-10 top-1/2 h-40 -translate-y-1/2 rounded-lg border-2 border-gold/80" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close camera"
          className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-ink/70 text-paper hover:bg-ink"
        >
          <XIcon size={16} />
        </button>
        <p className="px-4 py-3 text-center text-sm text-paper/80">
          {error ?? "Hold the tag's barcode or QR code inside the frame."}
        </p>
      </div>
    </div>
  );
}
