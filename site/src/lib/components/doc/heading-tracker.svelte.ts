import type { TocEntry } from '$lib/types';

export function createHeadingTracker(getItems: () => TocEntry[]) {
	let active = $state('');

	$effect(() => {
		const headings = getItems()
			.map((item) => document.getElementById(item.id))
			.filter((element) => element !== null);
		let frame = 0;
		function update() {
			frame = 0;
			let current = headings[0]?.id ?? '';
			for (const heading of headings) {
				if (heading.getBoundingClientRect().top > 120) break;
				current = heading.id;
			}
			active = current;
		}
		function schedule() {
			if (!frame) frame = requestAnimationFrame(update);
		}
		update();
		if (!headings.length) return;
		window.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
		};
	});

	return {
		get active() {
			return active;
		}
	};
}
