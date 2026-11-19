/**
 * The type roles of `SectionHeader` (DESIGN.md "Type", "Head a section") as class strings, so a heading that cannot be
 * a `SectionHeader` (an overlay's title slot, a third-party component's `title` class) takes the same role by name
 * instead of writing the face and size by hand: `TaskSheet` uses `SECTION_ROLE.sub`.
 */
const FACE = 'font-display tracking-display';

export const SECTION_ROLE = {
  hero: `${FACE} text-display sm:text-5xl`,
  display: `${FACE} text-display`,
  headline: `${FACE} text-headline`,
  sub: `${FACE} text-lg`,
  label: 'flex items-center gap-2 text-xs font-medium',
} as const;
