import { motion, useScroll, useTransform, useSpring } from 'framer-motion';
import { useDeviceDetect } from '../../lib/useDeviceDetect';

/* ─────────────────────────────────────────────────────────────────────────
   PARALLAX AURORA BLOBS
   Performance fixes:
   - On mobile/low-end: Render smaller blobs, reduced blurs.
   - On mobile/low-end: Bypass useSpring, use scrollYProgress directly.
   - will-change: transform on wrappers
   MOBILE SCROLL FIX:
   - Container has pointerEvents: none AND touch-action: none so it NEVER
     intercepts swipe/scroll gestures from the user. The blobs are purely
     decorative and must not block 1-finger scrolling on any device.
   ───────────────────────────────────────────────────────────────────────── */

export function ParallaxFloatingElements() {
  const { isMobile } = useDeviceDetect();
  return <ParallaxCore isMobile={isMobile} />;
}

function ParallaxCore({ isMobile }) {
  const { scrollYProgress } = useScroll();
  
  // Lighter spring — scroll-driven parallax doesn't need to feel "springy"
  const springSource = useSpring(scrollYProgress, { stiffness: 60, damping: 25, restDelta: 0.001 });
  
  // Bypass spring physics loop on mobile to save CPU
  const smoothProgress = isMobile ? scrollYProgress : springSource;

  const y1 = useTransform(smoothProgress, [0, 1], [0, -220]);
  const y2 = useTransform(smoothProgress, [0, 1], [0, -440]);
  const y3 = useTransform(smoothProgress, [0, 1], [0, -110]);

  // Mobile optimization: smaller blobs, significantly reduced blur (blur cost is quadratic)
  const size1 = isMobile ? '200px' : '340px';
  const size2 = isMobile ? '160px' : '280px';
  const size3 = isMobile ? '180px' : '300px';

  const blur1 = isMobile ? '30px' : '50px';
  const blur2 = isMobile ? '25px' : '45px';
  const blur3 = isMobile ? '35px' : '55px';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1,
      // MOBILE SCROLL FIX: pointerEvents + touch-action none ensures these purely-decorative
      // blobs NEVER consume touch events. Without touch-action: none, some Android
      // browsers treat the fixed overlay as a scroll target, forcing 2-finger scroll.
      pointerEvents: 'none',
      touchAction: 'none',
      overflow: 'hidden'
    }}>
      {/* Top-left aurora blob */}
      <motion.div style={{
        position: 'absolute', top: '10%', left: '-8%', y: y3,
        willChange: 'transform',
      }}>
        <div style={{
          width: size1, height: size1,
          borderRadius: '50%',
          background: 'var(--aurora-1)',
          filter: `blur(${blur1})`,
          opacity: 0.32,
        }} />
      </motion.div>

      {/* Middle-right aurora blob */}
      <motion.div style={{
        position: 'absolute', top: '45%', right: '-8%', y: y1,
        willChange: 'transform',
      }}>
        <div style={{
          width: size2, height: size2,
          borderRadius: '50%',
          background: 'var(--aurora-2)',
          filter: `blur(${blur2})`,
          opacity: 0.28,
        }} />
      </motion.div>

      {/* Bottom-left aurora blob */}
      <motion.div style={{
        position: 'absolute', top: '80%', left: '-4%', y: y2,
        willChange: 'transform',
      }}>
        <div style={{
          width: size3, height: size3,
          borderRadius: '50%',
          background: 'var(--aurora-3)',
          filter: `blur(${blur3})`,
          opacity: 0.22,
        }} />
      </motion.div>
    </div>
  );
}
