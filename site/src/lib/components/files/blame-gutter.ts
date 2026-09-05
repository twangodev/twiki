import { gutter, GutterMarker } from '@codemirror/view';
import { blameAt, type FileBlame, type FileCommit } from '$lib/file-history';

class BlameMarker extends GutterMarker {
	constructor(
		readonly commit: FileCommit,
		readonly first: boolean,
		readonly select: (id: string) => void
	) {
		super();
	}
	eq(other: BlameMarker) {
		return this.commit.id === other.commit.id && this.first === other.first;
	}
	toDOM() {
		const button = document.createElement('button');
		button.className = 'file-blame-line';
		button.tabIndex = this.first ? 0 : -1;
		button.textContent = this.first ? `${this.commit.id.slice(0, 7)} ${this.commit.author}` : '│';
		button.title = `${this.commit.author} · ${this.commit.date.slice(0, 10)}\n${this.commit.subject}`;
		button.setAttribute(
			'aria-label',
			`Commit ${this.commit.id.slice(0, 7)}: ${this.commit.subject}`
		);
		button.onclick = () => this.select(this.commit.id);
		return button;
	}
}

export function blameGutter(blame: FileBlame, select: (id: string) => void) {
	return gutter({
		class: 'file-blame',
		lineMarker(view, line) {
			const number = view.state.doc.lineAt(line.from).number;
			const found = blameAt(blame, number);
			return found?.commit
				? new BlameMarker(
						found.commit,
						found.start === number || line.from === view.viewport.from,
						select
					)
				: null;
		}
	});
}
