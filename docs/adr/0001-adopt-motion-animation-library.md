# ADR-0001: Adopt Motion (framer-motion v13) as the project animation library

- **Status**: Accepted
- **Date**: 2026-08-07
- **Deciders**: Frontend architect review

## Context

The project needs animations for:
1. Login page card entrance, error alerts, loading states
2. Future: dashboard stat card stagger, sidebar collapse, page transitions, mod card hover, toast notifications, table row animations

### Alternatives Considered

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| Motion (framer-motion v13) | React-idiomatic, AnimatePresence for exit, stagger children, spring physics, tree-shakeable ~28KB gzip | New dependency, learning curve | **Selected** |
| Pure CSS | Zero deps, works everywhere | Cannot handle exit animations, no stagger sequencing, messy class management for complex animations | Rejected |
| react-spring | Physics-based, natural motion | Imperative API, steeper learning curve, less React-idiomatic | Rejected |
| GSAP | Industry standard, extreme performance | Imperative DOM manipulation, commercial license required, heavy ~60KB | Rejected |

## Decision

Use `motion` (framer-motion v13, `motion/react` entry point) for all animations across the project.

## Consequences

### Positive
- Declarative React component API: `motion.div`, `AnimatePresence`, `MotionConfig`
- Built-in `prefers-reduced-motion` support via `MotionConfig reducedMotion="user"`
- Shared variant objects for consistent animation language across pages
- Smooth page transitions when react-router navigation is animated

### Negative
- Bundle size +~28KB gzip (acceptable for admin panel)
- Team must learn Motion API conventions
- Must use `motion/react` import path (not top-level `motion`)

### Migration Notes
- Import from `motion/react`, NOT `motion` (v13 moved React API to subpath)
- Wrap app in `<MotionConfig reducedMotion="user">` in main.tsx
- Future animations should use Motion API, not CSS @keyframes
