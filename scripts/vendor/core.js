// Gemeinsamer Kern: CodeMirror 6 + Yjs. Wird von scripts/build.mjs nach vendor/ gebündelt.
export * from '@codemirror/state';
export * from '@codemirror/view';
export * from '@codemirror/language';
export * from '@codemirror/commands';
export * from '@codemirror/autocomplete';
export * from '@codemirror/search';
export * from '@codemirror/lint';
export { tags, highlightCode, classHighlighter, styleTags, tagHighlighter } from '@lezer/highlight';

export * as Y from 'yjs';
export * as awarenessProtocol from 'y-protocols/awareness';
export * as syncProtocol from 'y-protocols/sync';
export * as encoding from 'lib0/encoding';
export * as decoding from 'lib0/decoding';
export { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
