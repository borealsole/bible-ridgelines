// Smoke tests for the passage parser against the built dataset.
// Usage: node scripts/test-passages.mjs [site/data/text.json]
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createParser } from '../site/js/passage.js';

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
console.log( `ok — ${ Object.keys( cases ).length } passages parsed, ${ tokens } tokens` );
