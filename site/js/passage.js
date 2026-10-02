// Parse passage references such as
//   "Ruth"  "Gen 1-3"  "John 1:1-18, 3:16; Rom 8"  "1 Cor 13"  "Ps 23; 121"  "NT"
// into a list of segments { book, startCh, startV, endCh, endV } (all 0-based, inclusive).

const GROUPS = {
	bible: [ 0, 65 ],
	all: [ 0, 65 ],
	'wholebible': [ 0, 65 ],
	ot: [ 0, 38 ],
	'oldtestament': [ 0, 38 ],
	nt: [ 39, 65 ],
	'newtestament': [ 39, 65 ],
	torah: [ 0, 4 ],
	pentateuch: [ 0, 4 ],
	law: [ 0, 4 ],
	'historicalbooks': [ 5, 16 ],
	history: [ 5, 16 ],
	wisdom: [ 17, 21 ],
	poetry: [ 17, 21 ],
	'majorprophets': [ 22, 26 ],
	'minorprophets': [ 27, 38 ],
	'thetwelve': [ 27, 38 ],
	prophets: [ 22, 38 ],
	gospels: [ 39, 42 ],
	synoptics: [ 39, 41 ],
	'synopticgospels': [ 39, 41 ],
	pauline: [ 44, 56 ],
	paul: [ 44, 56 ],
	'paulineepistles': [ 44, 56 ],
	'generalepistles': [ 57, 64 ],
	epistles: [ 44, 64 ],
};

const norm = ( s ) =>
	s
		.toLowerCase()
		.replace( /^(iii|ii|i)\s+(?=[a-z])/, ( m, r ) => String( r.length ) )
		.replace( /[\s.]/g, '' );

export function createParser( books ) {
	const aliasMap = new Map();
	books.forEach( ( book, i ) => {
		for ( const alias of book.aliases ) {
			const key = norm( alias );
			if ( ! aliasMap.has( key ) ) aliasMap.set( key, i );
		}
	} );
	const fullNames = books.map( ( b ) => norm( b.name ) );

	function findBook( name ) {
		const key = norm( name );
		if ( ! key ) return -1;
		if ( aliasMap.has( key ) ) return aliasMap.get( key );
		const matches = fullNames
			.map( ( n, i ) => ( n.startsWith( key ) ? i : -1 ) )
			.filter( ( i ) => i >= 0 );
		if ( matches.length === 1 ) return matches[ 0 ];
		if ( matches.length > 1 ) {
			throw new Error(
				`“${ name }” is ambiguous (${ matches
					.slice( 0, 4 )
					.map( ( i ) => books[ i ].name )
					.join( ', ' ) }…)`
			);
		}
		throw new Error( `Unknown book “${ name }”` );
	}

	function chapterCount( b ) {
		return books[ b ].chapters.length;
	}
	function verseCount( b, c ) {
		return books[ b ].chapters[ c ].length;
	}

	function checkChapter( b, c ) {
		if ( c < 0 || c >= chapterCount( b ) ) {
			throw new Error(
				`${ books[ b ].name } has ${ chapterCount( b ) } chapter${
					chapterCount( b ) === 1 ? '' : 's'
				} (asked for ${ c + 1 })`
			);
		}
	}
	function checkVerse( b, c, v ) {
		checkChapter( b, c );
		if ( v < 0 || v >= verseCount( b, c ) ) {
			throw new Error(
				`${ books[ b ].name } ${ c + 1 } has ${ verseCount(
					b,
					c
				) } verses (asked for ${ v + 1 })`
			);
		}
	}

	function wholeBooks( from, to ) {
		const out = [];
		for ( let b = from; b <= to; b++ ) {
			const lastCh = chapterCount( b ) - 1;
			out.push( {
				book: b,
				startCh: 0,
				startV: 0,
				endCh: lastCh,
				endV: verseCount( b, lastCh ) - 1,
			} );
		}
		return out;
	}

	// Parse "1:1-18, 3:16, 20" for one book.
	function parseRefs( b, spec ) {
		const out = [];
		const singleChapter = chapterCount( b ) === 1;
		let curCh = null;
		let verseMode = false;
		for ( const raw of spec.split( ',' ) ) {
			const item = raw.trim().replace( /\./g, ':' );
			if ( ! item ) continue;
			const [ left, right ] = item.split( /\s*[-–—]\s*/ );
			if ( ! /^\d+(:\d+)?$/.test( left ) || ( right !== undefined && ! /^\d+(:\d+)?$/.test( right ) ) ) {
				throw new Error( `Can’t read “${ item }”` );
			}
			const parse = ( s ) => s.split( ':' ).map( ( n ) => parseInt( n, 10 ) - 1 );
			const l = parse( left );
			const r = right !== undefined ? parse( right ) : null;
			let seg;
			if ( l.length === 2 ) {
				// c:v, c:v-v or c:v-c:v
				curCh = l[ 0 ];
				verseMode = true;
				checkVerse( b, l[ 0 ], l[ 1 ] );
				let endCh = l[ 0 ];
				let endV = l[ 1 ];
				if ( r && r.length === 2 ) {
					endCh = r[ 0 ];
					endV = r[ 1 ];
					curCh = endCh;
				} else if ( r ) {
					endV = r[ 0 ];
				}
				endCh = Math.min( endCh, chapterCount( b ) - 1 );
				checkChapter( b, endCh );
				endV = Math.min( endV, verseCount( b, endCh ) - 1 );
				seg = { book: b, startCh: l[ 0 ], startV: l[ 1 ], endCh, endV };
			} else if ( verseMode || singleChapter ) {
				// verses in the current chapter
				const c = curCh ?? 0;
				checkVerse( b, c, l[ 0 ] );
				let endCh = c;
				let endV = l[ 0 ];
				if ( r && r.length === 2 ) {
					endCh = Math.min( r[ 0 ], chapterCount( b ) - 1 );
					endV = r[ 1 ];
					curCh = endCh;
				} else if ( r ) {
					endV = r[ 0 ];
				}
				endV = Math.min( endV, verseCount( b, endCh ) - 1 );
				seg = { book: b, startCh: c, startV: l[ 0 ], endCh, endV };
			} else {
				// whole chapters, c or c-c (or c-c:v)
				checkChapter( b, l[ 0 ] );
				let endCh = l[ 0 ];
				let endV = null;
				if ( r && r.length === 2 ) {
					endCh = r[ 0 ];
					endV = r[ 1 ];
					verseMode = true;
				} else if ( r ) {
					endCh = r[ 0 ];
				}
				endCh = Math.min( endCh, chapterCount( b ) - 1 );
				if ( endV === null ) endV = verseCount( b, endCh ) - 1;
				endV = Math.min( endV, verseCount( b, endCh ) - 1 );
				curCh = endCh;
				seg = { book: b, startCh: l[ 0 ], startV: 0, endCh, endV };
			}
			if (
				seg.endCh < seg.startCh ||
				( seg.endCh === seg.startCh && seg.endV < seg.startV )
			) {
				throw new Error( `“${ item }” runs backwards` );
			}
			out.push( seg );
		}
		return out;
	}

	function parse( input ) {
		const segments = [];
		let lastBook = null;
		const parts = input
			.split( /[;\n]+/ )
			.map( ( s ) => s.trim() )
			.filter( Boolean );
		for ( const part of parts ) {
			const groupKey = norm( part );
			if ( GROUPS[ groupKey ] ) {
				segments.push( ...wholeBooks( ...GROUPS[ groupKey ] ) );
				lastBook = null;
				continue;
			}
			// Book ranges: "Genesis - Deuteronomy", "Matt–John"
			const range = part.match( /^([1-3]?\s*[a-z][a-z .]*?)\s*[-–—]\s*([1-3]?\s*[a-z][a-z .]*)$/i );
			if ( range && ! /\d\s*$/.test( range[ 1 ] ) ) {
				const from = findBook( range[ 1 ] );
				const to = findBook( range[ 2 ] );
				if ( to < from ) throw new Error( `“${ part }” runs backwards` );
				segments.push( ...wholeBooks( from, to ) );
				lastBook = to;
				continue;
			}
			let bookName;
			let spec;
			if ( /[a-z]/i.test( part ) ) {
				const m = part.match( /^(.*?[a-z][a-z .]*?)\s*(\d[\d:.\-–—,\s]*)?$/i );
				if ( ! m ) throw new Error( `Can’t read “${ part }”` );
				bookName = m[ 1 ];
				spec = m[ 2 ];
			} else {
				if ( lastBook === null ) throw new Error( `Which book is “${ part }” in?` );
				spec = part;
			}
			const b = bookName !== undefined ? findBook( bookName ) : lastBook;
			lastBook = b;
			if ( ! spec || ! spec.trim() ) {
				segments.push( ...wholeBooks( b, b ) );
			} else {
				segments.push( ...parseRefs( b, spec ) );
			}
		}
		if ( ! segments.length ) throw new Error( 'Enter a passage, e.g. “Ruth” or “John 1:1-18; Rom 8”' );
		return segments;
	}

	function label( seg ) {
		const book = books[ seg.book ];
		const name = book.name === 'Psalms' && seg.startCh === seg.endCh ? 'Psalm' : book.name;
		const lastCh = book.chapters.length - 1;
		const single = book.chapters.length === 1;
		const fullStart = seg.startV === 0;
		const fullEnd = seg.endV === book.chapters[ seg.endCh ].length - 1;
		if ( seg.startCh === 0 && fullStart && seg.endCh === lastCh && fullEnd ) {
			return book.name;
		}
		if ( single ) {
			return seg.startV === seg.endV
				? `${ name } ${ seg.startV + 1 }`
				: `${ name } ${ seg.startV + 1 }–${ seg.endV + 1 }`;
		}
		if ( fullStart && fullEnd ) {
			return seg.startCh === seg.endCh
				? `${ name } ${ seg.startCh + 1 }`
				: `${ name } ${ seg.startCh + 1 }–${ seg.endCh + 1 }`;
		}
		if ( seg.startCh === seg.endCh ) {
			return seg.startV === seg.endV
				? `${ name } ${ seg.startCh + 1 }:${ seg.startV + 1 }`
				: `${ name } ${ seg.startCh + 1 }:${ seg.startV + 1 }–${ seg.endV + 1 }`;
		}
		return `${ name } ${ seg.startCh + 1 }:${ seg.startV + 1 }–${ seg.endCh + 1 }:${
			seg.endV + 1
		}`;
	}

	return { parse, label };
}
