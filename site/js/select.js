// Turn a user's word list into sets of lexicon entries.
//
// Entries are separated by commas, semicolons or new lines. Within one entry,
// "+" joins several terms into a single ridge (when ridges are combined per entry).
// A term can be:
//   H430, G26              a Strong's number
//   אלהים, ἀγάπη, agape     an original-language lemma or transliteration (accents optional)
//   love, steadfast love   an English gloss (a whole phrase in the gloss)
//   lov*, *love            wildcards (* = any letters) for any of the above
//   fam:G25                every word in the Strong's family of G25 (or of a lemma/gloss)
//   root:G26               every word whose root chain leads to the same root
//   strongs:, lemma:, gloss:, translit:   force how a term is read

import { groupMapper } from './model.js';

const MARKS = /[̀-֑ͯ-ׇ׳״͏​-‏ʼʽʾʿʹʻ'’‘]/g;

export function fold( s ) {
	return String( s || '' )
		.normalize( 'NFD' )
		.replace( MARKS, '' )
		.replace( /ς/g, 'σ' )
		.replace( /[ᵉ]/g, 'e' )
		.toLowerCase()
		.replace( /[-\s]+/g, ' ' )
		.trim();
}

// Strong's transliterations write long vowels as "iy", "ow", "uw" (ʼĕlôhîym); people type "elohim".
const loose = ( s ) => s.replace( /iy/g, 'i' ).replace( /[ou]w/g, ( m ) => m[ 0 ] ).replace( /(.)\1/g, '$1' );

const HEBREW = /[֐-׿]/;
const GREEK = /[Ͱ-Ͽἀ-῿]/;
const STRONGS = /^([hg])0*(\d+)$/i;

function toRegExp( pattern ) {
	const esc = pattern.replace( /[.+?^${}()|[\]\\]/g, '\\$&' ).replace( /\*/g, '.*' );
	return new RegExp( `^${ esc }$` );
}

function glossPhrases( gloss ) {
	const out = [ fold( gloss ) ];
	for ( const part of String( gloss ).split( /[,;/]|\(|\)/ ) ) {
		const p = fold( part );
		if ( ! p ) continue;
		out.push( p );
		// "be strong" also answers to "strong"
		if ( p.startsWith( 'be ' ) ) out.push( p.slice( 3 ) );
	}
	return out;
}

let indexCache = null;
function buildIndex( data ) {
	if ( indexCache?.data === data ) return indexCache;
	const entries = data.lexicon.map( ( e ) => ( {
		lemma: fold( e.l ),
		translit: fold( e.t ),
		translitLoose: loose( fold( e.t ) ),
		gloss: glossPhrases( e.g ),
	} ) );
	indexCache = { data, entries, root: groupMapper( data, 2 ), family: groupMapper( data, 3 ) };
	return indexCache;
}

function matchBase( data, kind, value ) {
	const { lexicon, byKey } = data;
	const { entries } = buildIndex( data );
	const ids = new Set();
	const raw = value.trim();
	if ( ! raw ) return ids;
	const wild = raw.includes( '*' );
	if ( ! kind ) {
		if ( STRONGS.test( raw ) || /^H[bcdiklms]$/i.test( raw ) ) kind = 'strongs';
		else if ( HEBREW.test( raw ) || GREEK.test( raw ) ) kind = 'lemma';
		else kind = 'english';
	}
	if ( kind === 'strongs' ) {
		const m = raw.match( STRONGS );
		const key = m ? m[ 1 ].toUpperCase() + m[ 2 ] : 'H' + raw.slice( 1 ).toLowerCase();
		if ( wild ) {
			const re = toRegExp( raw.toUpperCase() );
			lexicon.forEach( ( e, i ) => re.test( e.k ) && ids.add( i ) );
		} else if ( byKey.has( key ) ) ids.add( byKey.get( key ) );
		return ids;
	}
	const f = fold( raw );
	const re = wild ? toRegExp( f ) : null;
	const test = wild ? ( s ) => re.test( s ) : ( s ) => s === f;
	const fl = loose( f );
	const reLoose = wild ? toRegExp( fl ) : null;
	const testTranslit = ( x ) => test( x.translit ) || ( wild ? reLoose.test( x.translitLoose ) : x.translitLoose === fl );
	entries.forEach( ( x, i ) => {
		const hit =
			kind === 'lemma'
				? test( x.lemma )
				: kind === 'translit'
				? testTranslit( x )
				: kind === 'gloss'
				? x.gloss.some( test )
				: x.gloss.some( test ) || testTranslit( x );
		if ( hit ) ids.add( i );
	} );
	return ids;
}

const KIND_ALIASES = {
	strongs: 'strongs', s: 'strongs', strong: 'strongs',
	lemma: 'lemma', l: 'lemma', original: 'lemma', word: 'lemma',
	gloss: 'gloss', g: 'gloss', english: 'gloss',
	translit: 'translit', t: 'translit', transliteration: 'translit',
};

function matchTerm( data, term ) {
	const m = term.match( /^\s*([a-z]+)\s*:\s*(.+)$/i );
	let scope = null;
	let kind = null;
	let value = term;
	if ( m ) {
		const prefix = m[ 1 ].toLowerCase();
		if ( prefix === 'fam' || prefix === 'family' || prefix === 'f' ) scope = 'family';
		else if ( prefix === 'root' || prefix === 'r' ) scope = 'root';
		else if ( KIND_ALIASES[ prefix ] ) kind = KIND_ALIASES[ prefix ];
		else throw new Error( `Unknown prefix “${ m[ 1 ]}:”` );
		value = m[ 2 ];
		// allow "fam:gloss:love"
		const inner = value.match( /^\s*([a-z]+)\s*:\s*(.+)$/i );
		if ( scope && inner && KIND_ALIASES[ inner[ 1 ].toLowerCase() ] ) {
			kind = KIND_ALIASES[ inner[ 1 ].toLowerCase() ];
			value = inner[ 2 ];
		}
	}
	const base = matchBase( data, kind, value );
	if ( ! scope || ! base.size ) return base;
	const idx = buildIndex( data );
	const map = scope === 'family' ? idx.family : idx.root;
	const heads = new Set( [ ...base ].map( map ) );
	const out = new Set();
	data.lexicon.forEach( ( e, i ) => {
		if ( ! e.p && heads.has( map( i ) ) ) out.add( i );
	} );
	return out;
}

/**
 * Parse a word list. Returns { terms: [{ text, ids:Set }], ids:Set, termsOf: Map(id -> [termIndex]) }
 * Throws on an unreadable term.
 */
export function parseWordList( data, text ) {
	const terms = [];
	for ( const chunk of String( text || '' ).split( /[,;\n]+/ ) ) {
		const entry = chunk.trim();
		if ( ! entry ) continue;
		const ids = new Set();
		for ( const part of entry.split( '+' ) ) {
			if ( part.trim() ) for ( const id of matchTerm( data, part ) ) ids.add( id );
		}
		terms.push( { text: entry, ids } );
	}
	const all = new Set();
	const termsOf = new Map();
	terms.forEach( ( t, ti ) => {
		for ( const id of t.ids ) {
			all.add( id );
			if ( ! termsOf.has( id ) ) termsOf.set( id, [] );
			termsOf.get( id ).push( ti );
		}
	} );
	return { terms, ids: all, termsOf };
}
