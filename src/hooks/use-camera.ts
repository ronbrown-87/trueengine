import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

export function useCamera(facingMode: "user" | "environment" = "user") {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
  }, []);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Camera not supported", { description: "Your browser can't access a camera." });
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      setActive(true);
      return true;
    } catch (err) {
      const name = (err as DOMException)?.name;
      toast.error("Camera unavailable", {
        description:
          name === "NotAllowedError"
            ? "Please allow camera access in your browser and try again."
            : "No camera found or it is being used by another app.",
      });
      return false;
    }
  }, [facingMode]);

  // attach stream once the video element renders
  useEffect(() => {
    const v = videoRef.current;
    if (active && v && streamRef.current) {
      v.srcObject = streamRef.current;
      void v.play().catch(() => {});
    }
  }, [active]);

  useEffect(() => stop, [stop]);

  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    return c.toDataURL("image/jpeg", 0.9);
  }, []);

  return { videoRef, active, start, stop, capture };
}
