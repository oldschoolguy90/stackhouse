// Wraps the html5-qrcode library, restricted to Bookland EAN-13 (book ISBN) codes.
const Scanner = (() => {
  let instance = null;
  let running = false;
  let lastCode = null;
  let lastAt = 0;

  // A book barcode is a Bookland EAN-13: 13 digits, prefix 978 or 979,
  // with a valid EAN-13 checksum. This equals the ISBN-13.
  function isValidBookland(code) {
    if (!/^\d{13}$/.test(code)) return false;
    if (!(code.startsWith("978") || code.startsWith("979"))) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(code[i], 10) * (i % 2 === 0 ? 1 : 3);
    }
    const check = (10 - (sum % 10)) % 10;
    return check === parseInt(code[12], 10);
  }

  async function start(elementId, onCode, onError) {
    if (running) return;
    instance = new Html5Qrcode(elementId, {
      // EAN-13 only: keeps the reader from locking onto price add-ons or UPCs
      formatsToSupport: [Html5QrcodeSupportFormat.EAN_13],
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
          if (decodedText === lastCode && now - lastAt < 2500) return;
          lastCode = decodedText;
          lastAt = now;
          onCode(decodedText, isValidBookland(decodedText));
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

  return { start, stop, isRunning: () => running, isValidBookland };
})();

// html5-qrcode exposes formats under Html5QrcodeSupportedFormats; alias defensively
// in case of library version differences.
const Html5QrcodeSupportFormat = (typeof Html5QrcodeSupportedFormats !== "undefined")
  ? Html5QrcodeSupportedFormats
  : { EAN_13: 8, EAN_8: 9, UPC_A: 10 };
