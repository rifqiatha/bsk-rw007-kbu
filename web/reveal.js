// reveal.js — scroll reveal bawaan Theme Pack 164.
// Markah: data-reveal="theme" (atau nama keyframe) + data-reveal-index sebagai jeda.
// Elemen bertanda harus berada di bawah lipatan; nav dan chrome aplikasi tidak.
export function initReveals(scope = document) {
  if (!window.IntersectionObserver) return () => {};
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return () => {};
  const root = scope.documentElement || scope;
  const groups = new Map();
  scope.querySelectorAll("[data-reveal]").forEach((element) => {
    element.style.animation = "none";
    element.style.opacity = "0";
    const scroller = element.closest("[data-reveal-root]") || null;
    if (!groups.has(scroller)) groups.set(scroller, []);
    groups.get(scroller).push(element);
  });
  const observers = [];
  groups.forEach((elements, scroller) => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const element = entry.target;
        if (!entry.isIntersecting) {
          element.style.animation = "none";
          element.style.opacity = "0";
          return;
        }
        const styles = getComputedStyle(root);
        const name = element.dataset.reveal === "theme"
          ? "tp-blur-in"
          : element.dataset.reveal;
        const duration = element.dataset.revealDur || styles.getPropertyValue("--tp-dur-slow").trim() || "500ms";
        const easing = styles.getPropertyValue("--tp-ease").trim() || "ease";
        const stagger = parseFloat(styles.getPropertyValue("--tp-stagger")) || 60;
        const index = Number(element.dataset.revealIndex || 0);
        element.style.animation = "none";
        element.style.opacity = "0";
        void element.offsetWidth;
        element.style.opacity = "";
        element.style.animation = `${name} ${duration} ${easing} ${Math.round(index * stagger)}ms both`;
      });
    }, { root: scroller, threshold: 0.05 });
    elements.forEach((element) => observer.observe(element));
    observers.push(observer);
  });
  return () => observers.forEach((observer) => observer.disconnect());
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initReveals(), { once: true });
} else {
  initReveals();
}
