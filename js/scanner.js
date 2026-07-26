// Wraps the html5-qrcode library for EAN-13 (book ISBN) barcode scanning.
const Scanner = (() => {
  let instance = null;
  let running = false;
  let lastCode = null;
  let lastAt = 0;

  async function start(elementId, onCode, onError) {
    if (running) return;
    instance = new Html5Qrcode(elementId, {
      formatsToSupport: [Html5QrcodeSupportFormat.EAN_13, Html5QrcodeSupportFormat.EAN_8, Html5QrcodeSupportFormat.UPC_A],
      verbose: false,
    });
    const config = {
      fps: 12,
      qrbox: (vw, vh) => {
        const size = Math.floor(Math.min(vw, vh) * 0.72);
        return { width: size, height: Math.floor(size * 0.55) };
      },
      aspectRatio: 1.4,
    };
    try {
      await instance.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
          const now = Date.now();
          // debounce duplicate reads of the same barcode within 2.5s
          if (decodedText === lastCode && now - lastAt < 2500) return;
          lastCode = decodedText;
          lastAt = now;
          onCode(decodedText);
        },
        () => { /* per-frame decode noise, ignore */ }
      );
      running = true;
    } catch (err) {
      if (onError) onError(err);
    }
  }

  async function stop() {
    if (!instance || !running) return;
    try {
      await instance.stop();
      await instance.clear();
    } catch (_) { /* already stopped */ }
    running = false;
    instance = null;
    lastCode = null;
  }

  return { start, stop, isRunning: () => running };
})();

// html5-qrcode exposes formats under Html5QrcodeSupportedFormats; alias defensively
// in case of library version differences.
const Html5QrcodeSupportFormat = (typeof Html5QrcodeSupportedFormats !== "undefined")
  ? Html5QrcodeSupportedFormats
  : { EAN_13: 8, EAN_8: 9, UPC_A: 10 };
