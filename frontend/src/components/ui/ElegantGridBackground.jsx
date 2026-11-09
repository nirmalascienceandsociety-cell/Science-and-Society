import { motion, useScroll, useTransform, useSpring } from 'framer-motion';
import { useDeviceDetect } from '../../lib/useDeviceDetect';

function ElegantGridBackgroundCore() {
  const { isMobile } = useDeviceDetect();
  const { scrollYProgress } = useScroll();
  
  const springProgress = useSpring(scrollYProgress, { stiffness: 40, damping: 20 });
  const smoothProgress = isMobile ? scrollYProgress : springProgress;

  // Extremely subtle parallax movements for depth
  const bgY = useTransform(smoothProgress, [0, 1], ["0%", "-10%"]);
  // fgY removed because animating a 40px blur causes severe repainting lag

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 0,
      // MOBILE SCROLL FIX: touchAction none prevents this purely-decorative
      // fixed overlay from consuming touch events on Android browsers.
      pointerEvents: 'none',
      touchAction: 'none',
      overflow: 'hidden',
      background: 'var(--background)'
    }}>
      {/* Base Grid Layer (Deepest) */}
      <motion.div style={{ 
        position: 'absolute', inset: '-20%', y: bgY,
        backgroundImage: `
          linear-gradient(to right, var(--gold-subtle) 1px, transparent 1px),
          linear-gradient(to bottom, var(--gold-subtle) 1px, transparent 1px)
        `,
        backgroundSize: '100px 100px',
        maskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 70%)',
        WebkitMaskImage: 'radial-gradient(ellipse at center, rgba(0,0,0,1) 10%, rgba(0,0,0,0) 70%)',
        opacity: 0.15
      }} />

      {/* Foreground Accent Layer (Static to prevent heavy blur repaint lag) */}
      <div style={{
        position: 'absolute', inset: '-20%',
        backgroundImage: `
          radial-gradient(circle at 20% 30%, var(--gold-subtle) 0%, transparent 20%),
          radial-gradient(circle at 80% 60%, var(--accent) 0%, transparent 25%)
        `,
        filter: 'blur(40px)',
        opacity: 0.2,
      }} />

      {/* Structural Corner Accents */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(to right, transparent, var(--gold-muted), transparent)' }} />
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px', background: 'linear-gradient(to right, transparent, var(--gold-muted), transparent)' }} />
    </div>
  );
}

export function ElegantGridBackground() {
  const { isHeavyAnimationSafe } = useDeviceDetect();

  if (!isHeavyAnimationSafe) {
    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: -1,
        background: 'var(--background)', overflow: 'hidden',
        pointerEvents: 'none',
        touchAction: 'none',
      }}>
        {/* Static Background Base */}
        <div style={{
          position: 'absolute', inset: '-10%',
          backgroundImage: `
            linear-gradient(to right, var(--gold-subtle) 1px, transparent 1px),
            linear-gradient(to bottom, var(--gold-subtle) 1px, transparent 1px)
          `,
          backgroundSize: '4rem 4rem',
          opacity: 0.15
        }} />

        {/* Static Foreground Accent Layer */}
        <div style={{
          position: 'absolute', inset: '-20%',
          backgroundImage: `
            radial-gradient(circle at 20% 30%, var(--gold-subtle) 0%, transparent 20%),
            radial-gradient(circle at 80% 60%, var(--accent) 0%, transparent 25%)
          `,
          filter: 'blur(40px)',
          opacity: 0.2,
        }} />
      </div>
    );
  }

  return <ElegantGridBackgroundCore />;
}
