import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import {
	defaultHighlightStyle,
	LanguageDescription,
	syntaxHighlighting
} from '@codemirror/language';
import { languages } from '@codemirror/language-data';

const theme = EditorView.theme({
	'&': {
		height: '100%',
		fontSize: '12px',
		color: 'var(--color-text)',
		backgroundColor: 'var(--color-bg)'
	},
	'&.cm-focused': { outline: 'none' },
	'.cm-scroller': {
		fontFamily: 'var(--font-mono, monospace)',
		lineHeight: '1.65',
		overflow: 'auto'
	},
	'.cm-content': { padding: '8px 0' },
	'.cm-line': { padding: '0 8px' },
	'.cm-gutters': {
		backgroundColor: 'var(--color-bg)',
		color: 'var(--color-muted)',
		borderRight: '1px solid var(--color-border)'
	},
	'.cm-lineNumbers .cm-gutterElement': { minWidth: '3rem', padding: '0 8px' },
	'.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
		backgroundColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)'
	},
	'.cm-panels': { backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' },
	'.cm-textfield, .cm-button': {
		background: 'var(--color-bg)',
		color: 'var(--color-text)',
		border: '1px solid var(--color-border)'
	},
	'.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--color-accent) 25%, transparent)' }
});

export function createCodeView(parent: HTMLElement, text: string, filename: string) {
	const language = new Compartment();
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: text,
			extensions: [
				EditorState.readOnly.of(true),
				EditorView.editable.of(false),
				EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': 'Source code' }),
				lineNumbers(),
				drawSelection(),
				search({ top: true }),
				keymap.of([...searchKeymap, ...defaultKeymap]),
				syntaxHighlighting(defaultHighlightStyle),
				language.of([]),
				theme
			]
		})
	});
	view.scrollDOM.classList.add('file-content');
	let disposed = false;
	void LanguageDescription.matchFilename(languages, filename)
		?.load()
		.then((extension) => {
			if (!disposed) view.dispatch({ effects: language.reconfigure(extension) });
		})
		.catch(() => {});
	return {
		view,
		destroy: () => {
			disposed = true;
			view.destroy();
		}
	};
}
