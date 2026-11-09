import { useDeviceDetect } from '../../lib/useDeviceDetect';

/* ─────────────────────────────────────────────────────────────────────────
   BACKGROUND ELEMENTS — Atmospheric glowing orbs + floating rings
   Performance fixes:
   - Removed filter: blur() from GlowOrbs (every animated blur triggers
     a GPU re-composite; use opacity gradient instead)
   - Reduced total element count
   - On mobile/low-end: render minimal decorative elements only
   - Added will-change: transform on animated elements
   ───────────────────────────────────────────────────────────────────────── */

/* ── Soft glowing orb (no blur — uses radial gradient opacity instead) ── */
function GlowOrb({ x, y, size, color, delay, duration, floatY = 24 }) {
  const animName = floatY <= 14 ? 'floatOrb-sm' : floatY <= 22 ? 'floatOrb-md' : 'floatOrb-lg';
  return (
    <div
      style={{
        position: 'absolute',
        left: x, top: y,
        width: size, height: size,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, ${color} 0%, transparent 70%)`,
        // No blur filter — gradient already achieves the soft glow effect
        pointerEvents: 'none',
        willChange: 'transform',
        animation: `${animName} ${duration}s ease-in-out ${delay}s infinite`,
      }}
    />
  );
}

/* ── Thin rotating ring ── */
function Ring({ x, y, size, color, delay, duration, opacity = 0.18 }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x, top: y,
        width: size, height: size,
        borderRadius: '50%',
        border: `1.5px solid ${color}`,
        opacity,
        pointerEvents: 'none',
        willChange: 'transform',
        animation: `spinRing ${duration}s linear ${delay}s infinite`,
      }}
    />
  );
}

/* ── Floating diamond ── */
function Diamond({ x, y, size, color, delay }) {
  return (
    <div
      style={{
        position: 'absolute',
        left: x, top: y,
        width: size, height: size,
        background: `linear-gradient(135deg, ${color} 0%, transparent 70%)`,
        transform: 'rotate(45deg)',
        opacity: 0.22,
        pointerEvents: 'none',
        borderRadius: 2,
        willChange: 'transform',
        animation: `floatDiamond 9s ease-in-out ${delay}s infinite`,
      }}
    />
  );
}

/* ── Mobile: minimal 2 orbs only ── */
function BackgroundElementsMobile() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1,
      pointerEvents: 'none',
      touchAction: 'none',
      overflow: 'hidden',
      contain: 'layout style',
    }}>
      <GlowOrb x="4%" y="6%" size={80} color="rgba(29,78,216,0.15)" delay={0} duration={7} floatY={20} />
      <GlowOrb x="80%" y="70%" size={60} color="rgba(197,160,89,0.18)" delay={1} duration={8} floatY={16} />
    </div>
  );
}

/* ── Desktop: full element set ── */
function BackgroundElementsDesktop() {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1,
      pointerEvents: 'none',
      touchAction: 'none',
      overflow: 'hidden',
      contain: 'layout style',
    }}>
      {/* ─── LEFT SIDE cluster ─── */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: '18%', height: '100%' }}>
        <GlowOrb x="8%" y="8%" size={110} color="rgba(29,78,216,0.18)" delay={0} duration={6} floatY={28} />
        <Ring x="3%" y="5%" size={145} color="rgba(29,78,216,0.25)" delay={0.5} duration={16} opacity={0.15} />
        <Ring x="6%" y="8%" size={80} color="rgba(197,160,89,0.4)" delay={1} duration={10} opacity={0.18} />
        <GlowOrb x="12%" y="22%" size={38} color="rgba(197,160,89,0.35)" delay={1.5} duration={4.5} floatY={16} />
        <Diamond x="5%" y="38%" size={22} color="rgba(197,160,89,0.6)" delay={1.5} />

        <GlowOrb x="6%" y="52%" size={90} color="rgba(29,78,216,0.14)" delay={1.2} duration={7.5} floatY={20} />
        <Ring x="2%" y="49%" size={125} color="rgba(29,78,216,0.2)" delay={0.5} duration={19} opacity={0.12} />

        <GlowOrb x="11%" y="64%" size={30} color="rgba(197,160,89,0.3)" delay={0.4} duration={5} floatY={12} />
        <GlowOrb x="8%" y="80%" size={70} color="rgba(197,160,89,0.2)" delay={2} duration={7} floatY={18} />
        <Ring x="4%" y="78%" size={95} color="rgba(197,160,89,0.35)" delay={1.5} duration={13} opacity={0.14} />
        <Diamond x="10%" y="90%" size={16} color="rgba(29,78,216,0.5)" delay={0.6} />
      </div>

      {/* ─── RIGHT SIDE cluster ─── */}
      <div style={{ position: 'absolute', right: 0, top: 0, width: '18%', height: '100%' }}>
        <GlowOrb x="30%" y="15%" size={100} color="rgba(197,160,89,0.2)" delay={0.5} duration={7} floatY={24} />
        <Ring x="25%" y="12%" size={140} color="rgba(197,160,89,0.3)" delay={0} duration={15} opacity={0.13} />
        <Ring x="32%" y="16%" size={72} color="rgba(29,78,216,0.3)" delay={1.2} duration={9} opacity={0.16} />
        <GlowOrb x="22%" y="28%" size={32} color="rgba(29,78,216,0.22)" delay={0.2} duration={5} floatY={14} />
        <Diamond x="30%" y="42%" size={20} color="rgba(197,160,89,0.55)" delay={1} />

        <GlowOrb x="28%" y="55%" size={85} color="rgba(29,78,216,0.15)" delay={1.5} duration={8} floatY={22} />
        <Ring x="22%" y="52%" size={118} color="rgba(29,78,216,0.22)" delay={0.7} duration={17} opacity={0.12} />

        <GlowOrb x="36%" y="68%" size={28} color="rgba(197,160,89,0.28)" delay={0.9} duration={4.5} floatY={10} />
        <GlowOrb x="26%" y="82%" size={75} color="rgba(29,78,216,0.14)" delay={2.2} duration={6} floatY={20} />
        <Ring x="20%" y="79%" size={105} color="rgba(197,160,89,0.28)" delay={1.7} duration={14} opacity={0.13} />
        <Diamond x="34%" y="91%" size={14} color="rgba(197,160,89,0.5)" delay={0.3} />
      </div>
    </div>
  );
}

export function BackgroundElements() {
  const { isLowEnd } = useDeviceDetect();
  return isLowEnd ? <BackgroundElementsMobile /> : <BackgroundElementsDesktop />;
}
