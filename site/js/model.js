// Data loading and the word-frequency analysis behind each ridge.

export async function loadData( base = 'data/' ) {
	const [ text, lexicon ] = await Promise.all( [
		fetch( base + 'text.json' ).then( ( r ) => {
			if ( ! r.ok ) throw new Error( `text.json: ${ r.status }` );
			return r.json();
		} ),
		fetch( base + 'lexicon.json' ).then( ( r ) => {
			if ( ! r.ok ) throw new Error( `lexicon.json: ${ r.status }` );
			return r.json();
		} ),
	] );
	const byKey = new Map();
	lexicon.forEach( ( e, i ) => {
		e.i = i;
		e.lang = e.k[ 0 ] === 'G' ? 'greek' : e.a ? 'aramaic' : 'hebrew';
		byKey.set( e.k, i );
	} );
	return { books: text.books, lexicon, byKey, meta: text.meta };
}

// Decode the base-36 token strings for a verse (cached per verse).
const verseCache = new Map();
function verseTokens( books, b, c, v ) {
	const key = ( b << 20 ) | ( c << 10 ) | v;
	let toks = verseCache.get( key );
	if ( ! toks ) {
		const s = books[ b ].chapters[ c ][ v ];
		toks = s ? s.split( ' ' ).map( ( t ) => parseInt( t, 36 ) ) : [];
		verseCache.set( key, toks );
	}
	return toks;
}

// Flatten passage segments into one token stream with verse markers.
export function collectTokens( data, segments ) {
	const ids = [];
	const verses = []; // { pos, b, c, v, seg }
	const segStarts = [];
	segments.forEach( ( seg, si ) => {
		segStarts.push( ids.length );
		for ( let c = seg.startCh; c <= seg.endCh; c++ ) {
			const chapter = data.books[ seg.book ].chapters[ c ];
			const vFrom = c === seg.startCh ? seg.startV : 0;
			const vTo = c === seg.endCh ? seg.endV : chapter.length - 1;
			for ( let v = vFrom; v <= vTo; v++ ) {
				verses.push( { pos: ids.length, b: seg.book, c, v, seg: si } );
				const toks = verseTokens( data.books, seg.book, c, v );
				for ( const t of toks ) ids.push( t );
			}
		}
	} );
	return { ids: Int32Array.from( ids ), verses, segStarts, total: ids.length };
}

// Map each lexicon entry to the entry it is grouped under.
//   0: none (each Strong's number on its own)
//   1: words with a single root merge into that root
//   2: follow the first root back as far as it goes
//   3: whole Strong's family
export function groupMapper( data, level ) {
	const { lexicon, byKey } = data;
	const cache = new Int32Array( lexicon.length ).fill( -1 );
	const resolve = ( i ) => {
		if ( cache[ i ] >= 0 ) return cache[ i ];
		const e = lexicon[ i ];
		let target = i;
		if ( level === 1 ) {
			if ( e.r && e.r.length === 1 && byKey.has( e.r[ 0 ] ) ) {
				target = byKey.get( e.r[ 0 ] );
			}
		} else if ( level === 2 ) {
			const seen = new Set( [ i ] );
			let cur = e;
			while ( cur.r && cur.r.length && byKey.has( cur.r[ 0 ] ) ) {
				const next = byKey.get( cur.r[ 0 ] );
				if ( seen.has( next ) ) break;
				seen.add( next );
				target = next;
				cur = lexicon[ next ];
			}
		} else if ( level >= 3 ) {
			if ( e.f && byKey.has( e.f ) ) target = byKey.get( e.f );
		}
		cache[ i ] = target;
		return target;
	};
	return resolve;
}

function median( sorted ) {
	const n = sorted.length;
	return n % 2 ? sorted[ ( n - 1 ) >> 1 ] : ( sorted[ n / 2 - 1 ] + sorted[ n / 2 ] ) / 2;
}

// Gaussian smoothing of a histogram, renormalised at the edges so ridges
// don't sag at the start and end of the passage.
function smooth( hist, sigma ) {
	const n = hist.length;
	if ( sigma < 0.35 ) return Float64Array.from( hist );
	const radius = Math.ceil( sigma * 3 );
	const kernel = new Float64Array( radius * 2 + 1 );
	for ( let k = -radius; k <= radius; k++ ) {
		kernel[ k + radius ] = Math.exp( -( k * k ) / ( 2 * sigma * sigma ) );
	}
	const out = new Float64Array( n );
	for ( let i = 0; i < n; i++ ) {
		let sum = 0;
		let wsum = 0;
		const lo = Math.max( 0, i - radius );
		const hi = Math.min( n - 1, i + radius );
		for ( let j = lo; j <= hi; j++ ) {
			const w = kernel[ j - i + radius ];
			sum += hist[ j ] * w;
			wsum += w;
		}
		out[ i ] = sum / wsum;
	}
	return out;
}

const isSkippable = ( e ) => e.p || e.k === 'G3588';

/**
 * Find every occurrence of a phrase (a list of { ids:Set | null } slots, null = any word).
 * Hebrew prefixes and the Greek article may sit before or between the words unless
 * the phrase itself names them. Matches never cross from one passage into the next.
 * Returns { starts, covered, slots }: start positions, every token position used,
 * and per slot a Map(lexicon id -> count) of what filled it.
 */
export function findPhrase( data, tokens, parts ) {
	const { lexicon } = data;
	const { ids, total, segStarts } = tokens;
	const skippable = ( id ) => isSkippable( lexicon[ id ] );
	const fits = ( part, id ) => ( part.ids === null ? ! skippable( id ) : part.ids.has( id ) );
	const starts = [];
	const covered = [];
	const slots = parts.map( () => new Map() );
	let seg = 0;
	for ( let p = 0; p < total; p++ ) {
		while ( seg + 1 < segStarts.length && segStarts[ seg + 1 ] <= p ) seg++;
		const end = seg + 1 < segStarts.length ? segStarts[ seg + 1 ] : total;
		if ( ! fits( parts[ 0 ], ids[ p ] ) ) continue;
		const used = [ p ];
		let q = p + 1;
		let ok = true;
		for ( let j = 1; j < parts.length && ok; j++ ) {
			while ( q < end && skippable( ids[ q ] ) && ! parts[ j ].ids?.has( ids[ q ] ) ) q++;
			if ( q < end && fits( parts[ j ], ids[ q ] ) ) used.push( q++ );
			else ok = false;
		}
		if ( ! ok ) continue;
		starts.push( p );
		covered.push( ...used );
		used.forEach( ( u, j ) => slots[ j ].set( ids[ u ], ( slots[ j ].get( ids[ u ] ) || 0 ) + 1 ) );
	}
	return { starts, covered, slots };
}

// A lexicon-like entry that labels a phrase ridge with the words that filled each slot.
function phraseEntry( data, phrase, slots ) {
	const picks = slots.map( ( m ) => {
		let best = null;
		let bestN = -1;
		for ( const [ id, n ] of m ) {
			if ( n > bestN ) {
				best = id;
				bestN = n;
			}
		}
		return best === null ? null : data.lexicon[ best ];
	} );
	if ( picks.some( ( e ) => ! e ) ) {
		return { k: phrase.text, l: phrase.text, t: phrase.text, g: phrase.text, lang: 'greek', phrase: true };
	}
	const join = ( f ) => picks.map( f ).join( ' ' );
	return {
		k: join( ( e ) => e.k ),
		l: join( ( e ) => e.l ),
		t: join( ( e ) => e.t || e.l ),
		g: join( ( e ) => e.g.split( /[,;]/ )[ 0 ].trim() ),
		lang: picks[ 0 ].lang,
		phrase: true,
	};
}

/**
 * Build the ridges for a token stream.
 * opts: { grouping, prefixes, minCount, maxCount, minBible, maxBible, skipTop,
 *         maxRidges, bandwidth (fraction of passage), order, reverse, normalise, bins,
 *         selection: { mode: 'only' | 'exclude', combine, ids:Set, termsOf:Map, terms, phrases } }
 * With mode 'only' the frequency filters are skipped: the listed words are the filter.
 */
export function analyse( data, tokens, opts ) {
	const { lexicon } = data;
	const resolve = groupMapper( data, opts.grouping );
	const groups = new Map(); // head index -> { positions, members: Map }
	const { ids, total } = tokens;
	const sel = opts.selection && opts.selection.terms.length ? opts.selection : null;
	const only = sel?.mode === 'only';
	const combine = only && sel.combine;
	const add = ( head, id, p ) => {
		let g = groups.get( head );
		if ( ! g ) {
			g = { head, positions: [], members: new Map() };
			groups.set( head, g );
		}
		g.positions.push( p );
		g.members.set( id, ( g.members.get( id ) || 0 ) + 1 );
	};
	// Phrases: find them first; in "hide" mode their tokens are skipped below.
	const phraseHits = ( sel?.phrases || [] ).map( ( ph ) => ( { phrase: ph, ...findPhrase( data, tokens, ph.parts ) } ) );
	const hiddenPositions = new Set();
	if ( sel && ! only ) for ( const h of phraseHits ) for ( const q of h.covered ) hiddenPositions.add( q );

	for ( let p = 0; p < total; p++ ) {
		const id = ids[ p ];
		const e = lexicon[ id ];
		if ( hiddenPositions.has( p ) ) continue;
		if ( sel ) {
			if ( only !== sel.ids.has( id ) ) continue;
		}
		// Prefixes listed explicitly in the word list are always kept.
		if ( e.p && ! opts.prefixes && ! only ) continue;
		if ( combine ) {
			// One ridge per word-list entry; heads are negative to keep them apart from lexicon ids.
			for ( const ti of sel.termsOf.get( id ) ) add( -1 - ti, id, p );
		} else {
			add( e.p ? id : resolve( id ), id, p );
		}
	}

	// Phrase occurrences join their entry's ridge when entries are combined.
	if ( combine ) {
		for ( const h of phraseHits ) {
			for ( let i = 0; i < h.starts.length; i++ ) {
				add( -1 - h.phrase.term, ids[ h.starts[ i ] ], h.starts[ i ] );
			}
		}
		for ( const g of groups.values() ) g.positions.sort( ( a, b ) => a - b );
	}

	// Bible-wide counts per group (sum over all members that map to the head).
	const bibleCount = new Map();
	if ( combine ) {
		for ( const g of groups.values() ) {
			let n = 0;
			for ( const id of sel.terms[ -1 - g.head ].ids ) n += lexicon[ id ].n || 0;
			bibleCount.set( g.head, n );
		}
	} else if ( opts.grouping === 0 ) {
		for ( const g of groups.values() ) bibleCount.set( g.head, lexicon[ g.head ].n );
	} else {
		for ( const g of groups.values() ) bibleCount.set( g.head, 0 );
		for ( let i = 0; i < lexicon.length; i++ ) {
			if ( ! lexicon[ i ].n ) continue;
			const h = lexicon[ i ].p ? i : resolve( i );
			if ( bibleCount.has( h ) ) bibleCount.set( h, bibleCount.get( h ) + lexicon[ i ].n );
		}
	}

	let list = [ ...groups.values() ].map( ( g ) => {
		// Label with the most frequent member actually in the passage.
		let best = g.head;
		let bestN = -1;
		for ( const [ id, n ] of g.members ) {
			if ( n > bestN || ( n === bestN && id === g.head ) ) {
				best = id;
				bestN = n;
			}
		}
		// Position of the group in the word list, for "as listed" ordering.
		let listIndex = Infinity;
		if ( combine ) listIndex = -1 - g.head;
		else if ( sel && only ) {
			for ( const id of g.members.keys() ) listIndex = Math.min( listIndex, sel.termsOf.get( id )?.[ 0 ] ?? Infinity );
		}
		// A combined entry that is just a phrase is labelled with the phrase.
		const entry = combine ? sel.terms[ -1 - g.head ] : null;
		const phraseOnly = entry && ! entry.ids.size && entry.phrases.length;
		let phraseLabel = null;
		if ( phraseOnly ) {
			const parts = entry.phrases.map( ( ph ) => phraseEntry( data, ph, phraseHits.find( ( h ) => h.phrase === ph ).slots ) );
			const join = ( f ) => parts.map( ( x ) => x[ f ] ).join( ' / ' );
			phraseLabel = { k: join( 'k' ), l: join( 'l' ), t: join( 't' ), g: join( 'g' ), lang: parts[ 0 ].lang, phrase: true };
		}
		return {
			...g,
			label: phraseLabel || lexicon[ best ],
			headEntry: phraseLabel || ( g.head >= 0 ? lexicon[ g.head ] : lexicon[ best ] ),
			isPhrase: !! phraseOnly,
			term: entry ? entry.text : null,
			listIndex,
			count: g.positions.length,
			bible: bibleCount.get( g.head ) || 0,
		};
	} );

	// Each phrase is its own ridge unless entries are combined.
	if ( only && ! combine ) {
		for ( const h of phraseHits ) {
			if ( ! h.starts.length ) continue;
			const members = new Map();
			for ( const m of h.slots ) for ( const [ id, n ] of m ) members.set( id, ( members.get( id ) || 0 ) + n );
			const label = phraseEntry( data, h.phrase, h.slots );
			list.push( {
				head: null,
				positions: h.starts,
				members,
				label,
				headEntry: label,
				isPhrase: true,
				term: h.phrase.text,
				listIndex: h.phrase.term,
				count: h.starts.length,
				bible: 0,
			} );
		}
	}

	const matchedBeforeFilter = list.length;
	list.sort( ( a, b ) => b.count - a.count );
	if ( opts.skipTop > 0 && ! only ) list = list.slice( opts.skipTop );
	if ( ! only ) list = list.filter(
		( g ) =>
			g.count >= ( opts.minCount || 1 ) &&
			( ! opts.maxCount || g.count <= opts.maxCount ) &&
			( ! opts.minBible || g.bible >= opts.minBible ) &&
			( ! opts.maxBible || g.bible <= opts.maxBible )
	);
	const afterFilter = list.length;
	if ( opts.maxRidges && list.length > opts.maxRidges ) list = list.slice( 0, opts.maxRidges );

	// Density curves
	const bins = Math.max( 20, Math.min( opts.bins || 600, total ) );
	const sigma = Math.max( 0, opts.bandwidth ) * bins;
	const scale = bins / Math.max( 1, total );
	for ( const g of list ) {
		const hist = new Float64Array( bins );
		for ( const p of g.positions ) hist[ Math.min( bins - 1, Math.floor( ( p + 0.5 ) * scale ) ) ] += 1;
		const curve = smooth( hist, sigma );
		// convert to occurrences per 1,000 words
		const perWord = total / bins;
		let max = 0;
		let argmax = 0;
		for ( let i = 0; i < bins; i++ ) {
			curve[ i ] = ( curve[ i ] / perWord ) * 1000;
			if ( curve[ i ] > max ) {
				max = curve[ i ];
				argmax = i;
			}
		}
		g.curve = curve;
		g.max = max;
		g.peak = ( argmax + 0.5 ) / bins;
		g.median = ( median( g.positions ) + 0.5 ) / total;
		g.mean = g.positions.reduce( ( a, b ) => a + b, 0 ) / g.positions.length / total;
		g.first = g.positions[ 0 ] / total;
	}

	// Normalisation → values in 0..1 relative to the tallest allowed ridge.
	if ( opts.normalise === 'peak' ) {
		for ( const g of list ) g.y = g.curve.map( ( v ) => ( g.max ? v / g.max : 0 ) );
	} else if ( opts.normalise === 'area' ) {
		let gmax = 0;
		for ( const g of list ) gmax = Math.max( gmax, g.max / g.count );
		for ( const g of list ) g.y = g.curve.map( ( v ) => ( gmax ? v / g.count / gmax : 0 ) );
	} else {
		let gmax = 0;
		for ( const g of list ) gmax = Math.max( gmax, g.max );
		for ( const g of list ) g.y = g.curve.map( ( v ) => ( gmax ? v / gmax : 0 ) );
	}

	const key = {
		median: ( g ) => g.median,
		mean: ( g ) => g.mean,
		peak: ( g ) => g.peak,
		first: ( g ) => g.first,
		count: ( g ) => -g.count,
		list: ( g ) => g.listIndex,
	}[ opts.order || 'median' ];
	list.sort( ( a, b ) => key( a ) - key( b ) || b.count - a.count );
	if ( opts.reverse ) list.reverse();

	return {
		ridges: list,
		bins,
		total,
		groupsFound: matchedBeforeFilter,
		afterFilter,
		phraseCounts: new Map( phraseHits.map( ( h ) => [ h.phrase, h.starts.length ] ) ),
	};
}

// Find the verse containing a token position.
export function verseAt( tokens, pos ) {
	const vs = tokens.verses;
	let lo = 0;
	let hi = vs.length - 1;
	while ( lo < hi ) {
		const mid = ( lo + hi + 1 ) >> 1;
		if ( vs[ mid ].pos <= pos ) lo = mid;
		else hi = mid - 1;
	}
	return vs[ lo ];
}
