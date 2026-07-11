import confetti from "canvas-confetti";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Student sign-in: teal/green, modest, from bottom-center.
export function burstSuccess(origin?: { x: number; y: number }) {
  if (prefersReducedMotion()) return;
  const colors = ["#0d9488", "#10b981", "#34d399", "#5eead4"];
  confetti({
    particleCount: 90,
    spread: 60,
    startVelocity: 38,
    origin: origin ?? { x: 0.5, y: 0.85 },
    colors,
    scalar: 0.9,
    ticks: 160,
  });
  setTimeout(() => {
    confetti({
      particleCount: 40,
      spread: 100,
      startVelocity: 22,
      origin: origin ?? { x: 0.5, y: 0.85 },
      colors,
      scalar: 0.7,
      ticks: 140,
    });
  }, 120);
}

// Lecturer / session / milestone: gold + emoji, bigger, from top.
export function burstCelebrate() {
  if (prefersReducedMotion()) return;
  const gold = ["#f59e0b", "#fbbf24", "#fcd34d", "#fde68a"];
  const emojis = ["🎉", "🏆", "⭐", "✨", "🎓"];

  confetti({
    particleCount: 120,
    spread: 100,
    startVelocity: 45,
    origin: { x: 0.5, y: 0 },
    colors: gold,
    scalar: 1.1,
    ticks: 200,
  });

  const end = Date.now() + 900;
  const frame = () => {
    if (Date.now() > end) return;
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      startVelocity: 32,
      origin: { x: 0, y: 0.7 },
      colors: gold,
      shapes: ["circle"],
      scalar: 0.9,
    });
    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      startVelocity: 32,
      origin: { x: 1, y: 0.7 },
      colors: gold,
      shapes: ["circle"],
      scalar: 0.9,
    });
    requestAnimationFrame(frame);
  };
  frame();

  // emoji rain via canvas text
  const emojiShapes = emojis.map((emoji) =>
    typeof confetti.shapeFromText === "function"
      ? confetti.shapeFromText({ text: emoji, scalar: 3 })
      : "circle",
  );
  emojis.forEach((emoji, i) => {
    setTimeout(() => {
      confetti({
        particleCount: 5,
        spread: 70,
        startVelocity: 30 + i * 4,
        origin: { x: 0.2 + (i % 5) * 0.15, y: 0 },
        colors: gold,
        shapes: [emojiShapes[i]],
        scalar: 1.4,
        ticks: 180,
      });
    }, i * 100);
  });
}
