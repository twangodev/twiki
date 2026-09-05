export interface FileCommit {
	id: string;
	author: string;
	date: string;
	subject: string;
}

export interface FileChange extends FileCommit {
	path: string;
	previousPath?: string;
	diff?: string;
	unavailable?: string;
}

export interface FileHistory {
	revision: string;
	commits: FileChange[];
	blame?: string;
	notice?: string;
}

export interface FileBlame {
	commits: Record<string, FileCommit>;
	ranges: [start: number, end: number, commit: string][];
}

export function blameAt(blame: FileBlame, line: number) {
	let low = 0,
		high = blame.ranges.length - 1;
	while (low <= high) {
		const middle = (low + high) >>> 1;
		const range = blame.ranges[middle];
		if (line < range[0]) high = middle - 1;
		else if (line > range[1]) low = middle + 1;
		else return { commit: blame.commits[range[2]], start: range[0] };
	}
}
