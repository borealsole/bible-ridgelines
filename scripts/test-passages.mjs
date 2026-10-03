// Smoke tests for the passage parser against the built dataset.
// Usage: node scripts/test-passages.mjs [site/data/text.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createParser } from '../site/js/passage.js';
import { parseWordList } from '../site/js/select.js';
import { analyse, collectTokens } from '../site/js/model.js';

const file = process.argv[ 2 ] || new URL( '../site/data/text.json', import.meta.url );
const { books } = JSON.parse( fs.readFileSync( file, 'utf8' ) );
assert.equal( books.length, 66, 'expected 66 books' );
const p = createParser( books );
const labels = ( q ) => p.parse( q ).map( p.label ).join( ' | ' );

const cases = {
	Ruth: 'Ruth',
	'Gen 1-3': 'Genesis 1–3',
	'John 1:1-18, 3:16, 20': 'John 1:1–18 | John 3:16 | John 3:20',
	'Rom 8; 12': 'Romans 8 | Romans 12',
	'I John 4:7-21': '1 John 4:7–21',
	'Ps 23': 'Psalm 23',
	'Jude 3-4': 'Jude 3–4',
	'Gen 1:1-2:3': 'Genesis 1:1–2:3',
	'Exod 20.1-17': 'Exodus 20:1–17',
	'Matt-John': 'Matthew | Mark | Luke | John',
	gospels: 'Matthew | Mark | Luke | John',
};
for ( const [ q, want ] of Object.entries( cases ) ) assert.equal( labels( q ), want, q );
for ( const bad of [ 'Hezekiah 1', 'Gen 51', 'John 3:40', 'j 1', '' ] ) {
	assert.throws( () => p.parse( bad ), undefined, bad );
}
assert.equal( p.parse( 'NT' ).length, 27 );
assert.equal( p.parse( 'OT' ).length, 39 );

let tokens = 0;
for ( const b of books ) for ( const c of b.chapters ) for ( const v of c ) tokens += v ? v.split( ' ' ).length : 0;
assert.ok( tokens > 500000, `expected >500k tokens, got ${ tokens }` );
// Word-list matching
const lexiconFile = path.join( path.dirname( file instanceof URL ? fileURLToPath( file ) : file ), 'lexicon.json' );
const lexicon = JSON.parse( fs.readFileSync( lexiconFile, 'utf8' ) );
const byKey = new Map( lexicon.map( ( e, i ) => [ e.k, i ] ) );
const data = { books, lexicon, byKey };
const keys = ( q ) => parseWordList( data, q ).terms.map( ( t ) => [ ...t.ids ].map( ( i ) => lexicon[ i ].k ).sort() );
assert.deepEqual( keys( 'G26' ), [ [ 'G26' ] ] );
assert.deepEqual( keys( 'h0430' ), [ [ 'H430' ] ] );
assert.ok( keys( 'ἀγάπη' )[ 0 ].includes( 'G26' ), 'lemma with accents' );
assert.ok( keys( 'αγαπη' )[ 0 ].includes( 'G26' ), 'lemma without accents' );
assert.ok( keys( 'אלהים' )[ 0 ].includes( 'H430' ), 'unpointed Hebrew' );
assert.ok( keys( 'elohim' )[ 0 ].includes( 'H430' ), 'loose transliteration' );
assert.ok( keys( 'love' )[ 0 ].includes( 'G25' ) && keys( 'love' )[ 0 ].includes( 'H157' ), 'gloss' );
assert.ok( keys( 'root:G26' )[ 0 ].includes( 'G27' ), 'root chain' );
assert.equal( keys( 'G25 + G26, faith' ).length, 2, 'entries and + joins' );
assert.deepEqual( keys( 'zzzz' ), [ [] ] );
assert.throws( () => parseWordList( data, 'foo:bar' ) );

// Phrases
lexicon.forEach( ( e ) => ( e.lang = e.k[ 0 ] === 'G' ? 'greek' : 'hebrew' ) );
const phraseCount = ( passage, words ) => {
	const tokens = collectTokens( data, p.parse( passage ) );
	const selection = { ...parseWordList( data, words ), mode: 'only', combine: false };
	const r = analyse( data, tokens, { grouping: 0, bandwidth: 0.02, normalise: 'peak', order: 'list', maxRidges: 50, bins: 200, selection } );
	return [ ...r.phraseCounts.values() ];
};
assert.deepEqual( phraseCount( 'Genesis 1', '"בראשית ברא", "H7200 H430"' ), [ 1, 7 ], 'Hebrew phrases (prefix skipped)' );
assert.deepEqual( phraseCount( 'Isaiah', '"holy israel"' ), [ 25 ], 'Holy One of Israel in Isaiah' );
assert.deepEqual( phraseCount( 'John 1', '"ἐν ἀρχή"' ), [ 2 ], 'Greek phrase with article between' );
assert.equal( parseWordList( data, '"a, b" , c' ).terms.length, 2, 'commas inside quotes stay in the phrase' );
assert.equal( parseWordList( data, '"λόγος"' ).terms[ 0 ].phrases.length, 0, 'one quoted word is just a word' );

console.log( `ok — ${ Object.keys( cases ).length } passages parsed, ${ tokens } tokens, word lists and phrases matched` );
