// Shared framer-motion presets so every page moves the same way.

export const spring = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 };
export const gentle = { type: 'spring', stiffness: 220, damping: 28 };

export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export const fadeUp = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: gentle },
};

export const listItem = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: spring },
  exit: { opacity: 0, x: -12, transition: { duration: 0.16 } },
};
