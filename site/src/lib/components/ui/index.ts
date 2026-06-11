// Primitives used by the doc shell (ported from cca — shared design language).
export { default as ThemeToggle } from './ThemeToggle.svelte';

// Overlays (bits-ui)
export { default as DialogRoot } from './Dialog.svelte';
export { default as DialogOverlay } from './DialogOverlay.svelte';
export { default as DialogContent } from './DialogContent.svelte';
export { default as DialogTitle } from './DialogTitle.svelte';
export { default as DialogClose } from './DialogClose.svelte';
export { default as Tooltip } from './Tooltip.svelte';

// Form controls
export { default as Button, buttonVariants, buttonSizes, buttonClass } from './Button.svelte';
export type { ButtonVariant, ButtonSize } from './Button.svelte';
