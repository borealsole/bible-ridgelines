import { loadData, collectTokens, analyse, verseAt } from './model.js';
import { createParser } from './passage.js';
import { parseWordList } from './select.js';
import { PALETTES, CanvasBackend, SvgBackend, layout, draw } from './render.js';

const FONTS = {
	gentium: { name: 'Gentium Book Plus + Frank Ruhl', stack: "'Gentium Book Plus', 'Frank Ruhl Libre', serif", families: [ 'Gentium Book Plus', 'Frank Ruhl Libre' ] },
	'noto-serif': { name: 'Noto Serif', stack: "'Noto Serif', 'Noto Serif Hebrew', serif", families: [ 'Noto Serif', 'Noto Serif Hebrew' ] },
	'noto-sans': { name: 'Noto Sans', stack: "'Noto Sans', 'Noto Sans Hebrew', sans-serif", families: [ 'Noto Sans', 'Noto Sans Hebrew' ] },
	cardo: { name: 'Cardo', stack: "'Cardo', serif", families: [ 'Cardo' ] },
	garamond: { name: 'EB Garamond + David Libre', stack: "'EB Garamond', 'David Libre', serif", families: [ 'EB Garamond', 'David Libre' ] },
	alegreya: { name: 'Alegreya + Noto Serif Hebrew', stack: "'Alegreya', 'Noto Serif Hebrew', serif", families: [ 'Alegreya', 'Noto Serif Hebrew' ] },
	system: { name: 'System sans-serif', stack: 'system-ui, -apple-system, "Segoe UI", sans-serif', families: [] },
};

const PASSAGE_PRESETS = [
	[ 'Ruth', 'Ruth' ],
	[ 'Jonah', 'Jonah' ],
	[ 'Gen 1–11', 'Genesis 1-11' ],
	[ 'Exodus', 'Exodus' ],
	[ 'Psalm 119', 'Psalm 119' ],
	[ 'Isaiah 40–55', 'Isaiah 40-55' ],
	[ 'Song of Songs', 'Song of Songs' ],
	[ 'John', 'John' ],
	[ 'Romans', 'Romans' ],
	[ 'Hebrews', 'Hebrews' ],
	[ 'Revelation', 'Revelation' ],
	[ 'Gospels', 'Gospels' ],
	[ 'Creation', 'Gen 1:1-2:3; Ps 104; John 1:1-18; Col 1:15-20' ],
];

const DEFAULTS = {
	passage: 'Ruth',
	words: '',
	wordMode: 'only',
	combineTerms: false,
	grouping: 0,
	prefixes: false,
	minCount: 3,
	maxCount: 0,
	minBible: 0,
	maxBible: 0,
	skipTop: 0,
	maxRidges: 50,
	order: 'median',
	reverse: false,
	normalise: 'peak',
	bandwidth: 2,
	spacing: 18,
	overlap: 2.5,
	width: 0,
	colourBy: 'order',
	palette: 'viridis',
	colour: '#2a6f97',
	fillMode: 'colour',
	lineMode: 'custom',
	lineColour: '#ffffff',
	background: '#ffffff',
	textColour: '#1d232a',
	opacity: 0.85,
	lineWidth: 1,
	baseline: false,
	labelMode: 'original',
	font: 'gentium',
	fontSize: 14,
	title: '',
	showTitle: true,
	showLabels: true,
	showStrongs: false,
	labelColour: false,
	labelBoth: false,
	showAxis: true,
	showSeparators: true,
};

const STYLE_PRESETS = {
	classic: { colourBy: 'order', palette: 'viridis', fillMode: 'colour', lineMode: 'custom', lineColour: '#ffffff', background: '#ffffff', textColour: '#1d232a', opacity: 0.85, lineWidth: 1 },
	pulsar: { colourBy: 'single', fillMode: 'background', lineMode: 'custom', lineColour: '#ffffff', background: '#000000', textColour: '#f2f2f2', opacity: 1, lineWidth: 1.25, overlap: 4 },
	ink: { colourBy: 'single', fillMode: 'background', lineMode: 'custom', lineColour: '#1d232a', background: '#fbf8f1', textColour: '#1d232a', opacity: 1, lineWidth: 1 },
	sunset: { colourBy: 'position', palette: 'sunset', fillMode: 'colour', lineMode: 'custom', lineColour: '#fffaf3', background: '#fffaf3', textColour: '#3b2a3a', opacity: 0.9, lineWidth: 1 },
	night: { colourBy: 'order', palette: 'magma', fillMode: 'colour', lineMode: 'custom', lineColour: '#0f1419', background: '#0f1419', textColour: '#e7e9ec', opacity: 0.9, lineWidth: 1 },
};

const GROUPING_NAMES = [ 'none', 'direct root', 'root chain', 'whole family' ];
const NUMERIC = new Set( Object.keys( DEFAULTS ).filter( ( k ) => typeof DEFAULTS[ k ] === 'number' ) );
const BOOLEAN = new Set( Object.keys( DEFAULTS ).filter( ( k ) => typeof DEFAULTS[ k ] === 'boolean' ) );

const $ = ( id ) => document.getElementById( id );
const form = $( 'form' );
const canvas = $( 'plot' );
const wrap = $( 'plotWrap' );
const tooltip = $( 'tooltip' );
const crosshair = $( 'crosshair' );
const statusEl = $( 'status' );

let state = { ...DEFAULTS };
let data = null;
let parser = null;
let current = null; // { segments, labels, tokens, result, layout, hit }
const tokenCache = new Map();

// ---------------------------------------------------------------------------
// State <-> URL hash

function readHash() {
	const params = new URLSearchParams( location.hash.slice( 1 ) );
	const s = { ...DEFAULTS };
	for ( const [ k, v ] of params ) {
		if ( ! ( k in DEFAULTS ) ) continue;
		if ( NUMERIC.has( k ) ) {
			const n = parseFloat( v );
			if ( Number.isFinite( n ) ) s[ k ] = n;
		} else if ( BOOLEAN.has( k ) ) s[ k ] = v === '1';
		else s[ k ] = v;
	}
	return s;
}

function writeHash() {
	const params = new URLSearchParams();
	for ( const k of Object.keys( DEFAULTS ) ) {
		if ( state[ k ] === DEFAULTS[ k ] ) continue;
		params.set( k, BOOLEAN.has( k ) ? ( state[ k ] ? '1' : '0' ) : String( state[ k ] ) );
	}
	const h = params.toString();
	history.replaceState( null, '', h ? '#' + h : location.pathname + location.search );
}

// ---------------------------------------------------------------------------
// Form

function populateSelects() {
	$( 'palette' ).innerHTML = Object.keys( PALETTES )
		.map( ( p ) => `<option value="${ p }">${ p[ 0 ].toUpperCase() + p.slice( 1 ) }</option>` )
		.join( '' );
	$( 'font' ).innerHTML = Object.entries( FONTS )
		.map( ( [ id, f ] ) => `<option value="${ id }">${ f.name }</option>` )
		.join( '' );
	$( 'presets' ).innerHTML = PASSAGE_PRESETS.map(
		( [ label, value ] ) => `<button type="button" data-passage="${ value }">${ label }</button>`
	).join( '' );
}

function syncForm() {
	for ( const el of form.elements ) {
		if ( ! el.name || ! ( el.name in state ) ) continue;
		const v = state[ el.name ];
		if ( el.type === 'checkbox' ) el.checked = !! v;
		else if ( el.type === 'number' ) el.value = v === 0 && el.placeholder ? '' : v;
		else el.value = v;
	}
	updateOutputs();
	updateVisibility();
}

function updateOutputs() {
	$( 'groupingOut' ).textContent = GROUPING_NAMES[ state.grouping ];
	const words = current?.tokens ? Math.round( ( state.bandwidth / 100 ) * current.tokens.total ) : null;
	$( 'bandwidthOut' ).textContent =
		state.bandwidth === 0 ? 'off' : `${ state.bandwidth }%${ words !== null ? ` (≈${ words.toLocaleString() } words)` : '' }`;
	$( 'spacingOut' ).textContent = `${ state.spacing }px`;
	$( 'overlapOut' ).textContent = `${ state.overlap.toFixed( 1 ) }×`;
	$( 'widthOut' ).textContent = state.width ? `${ state.width }px` : 'fit window';
	$( 'opacityOut' ).textContent = `${ Math.round( state.opacity * 100 ) }%`;
	$( 'lineWidthOut' ).textContent = state.lineWidth ? `${ state.lineWidth }px` : 'none';
	$( 'fontSizeOut' ).textContent = `${ state.fontSize }px`;
}

function updateVisibility() {
	for ( const el of form.querySelectorAll( '[data-show]' ) ) {
		const [ key, values ] = el.dataset.show.split( /!?=/ );
		const negate = el.dataset.show.includes( '!=' );
		const match = values.split( ',' ).includes( String( state[ key ] ) );
		el.toggleAttribute( 'data-hidden', negate ? match : ! match );
	}
}

function readInput( el ) {
	if ( el.type === 'checkbox' ) return el.checked;
	if ( NUMERIC.has( el.name ) ) {
		const n = parseFloat( el.value );
		return Number.isFinite( n ) ? n : 0;
	}
	return el.value;
}

form.addEventListener( 'input', ( e ) => {
	const el = e.target;
	if ( ! el.name || ! ( el.name in state ) ) return;
	state[ el.name ] = readInput( el );
	onStateChange( el.name === 'passage' || el.name === 'words' ? 300 : 0 );
} );

$( 'preset' ).addEventListener( 'change', ( e ) => {
	const p = STYLE_PRESETS[ e.target.value ];
	if ( p ) {
		Object.assign( state, p );
		syncForm();
		onStateChange();
	}
	e.target.value = '';
} );

$( 'presets' ).addEventListener( 'click', ( e ) => {
	const v = e.target.closest( 'button' )?.dataset.passage;
	if ( ! v ) return;
	state.passage = v;
	$( 'passage' ).value = v;
	onStateChange();
} );

$( 'reset' ).addEventListener( 'click', () => {
	state = { ...DEFAULTS, passage: state.passage };
	syncForm();
	onStateChange();
} );

$( 'copyLink' ).addEventListener( 'click', async () => {
	try {
		await navigator.clipboard.writeText( location.href );
		$( 'copyLink' ).textContent = 'Copied';
	} catch {
		$( 'copyLink' ).textContent = 'Copy failed';
	}
	setTimeout( () => ( $( 'copyLink' ).textContent = 'Copy link' ), 1500 );
} );

let timer = null;
function onStateChange( delay = 0 ) {
	updateOutputs();
	updateVisibility();
	writeHash();
	clearTimeout( timer );
	timer = setTimeout( () => requestAnimationFrame( update ), delay );
}

// ---------------------------------------------------------------------------
// Pipeline

function setStatus( msg, error = false ) {
	statusEl.textContent = msg;
	statusEl.classList.toggle( 'error', error );
}

function renderOptions( labels ) {
	return {
		...state,
		font: ( FONTS[ state.font ] || FONTS.gentium ).stack,
		labelColourBy: state.labelColour ? 'ridge' : 'text',
		labelSide: state.labelBoth ? 'both' : 'left',
		title: state.showTitle ? state.title || ( labels.length <= 4 ? labels.join( '; ' ) : state.passage.trim() ) : '',
	};
}

// Word list -> selection, with a short report of what each entry matched.
let wordCache = { text: null, parsed: null, error: null };
function wordSelection( tokens ) {
	const status = $( 'wordStatus' );
	if ( wordCache.text !== state.words ) {
		wordCache = { text: state.words, parsed: null, error: null };
		try {
			wordCache.parsed = parseWordList( data, state.words );
		} catch ( err ) {
			wordCache.error = err.message;
		}
	}
	if ( wordCache.error ) {
		status.textContent = wordCache.error;
		status.classList.add( 'error' );
		return null;
	}
	const parsed = wordCache.parsed;
	status.classList.remove( 'error' );
	if ( ! parsed.terms.length ) {
		status.textContent = '';
		return null;
	}
	return { ...parsed, mode: state.wordMode, combine: state.combineTerms };
}

// What each entry matched: words found, and how often each phrase occurs in the passage.
function renderWordStatus( selection, tokens, result ) {
	if ( ! selection ) return;
	if ( ! tokens.idSet ) tokens.idSet = new Set( tokens.ids );
	const miss = ( s ) => `<span class="miss">${ s }</span>`;
	const lines = selection.terms.map( ( t ) => {
		const bits = [];
		if ( t.ids.size ) {
			const present = [ ...t.ids ].filter( ( id ) => tokens.idSet.has( id ) );
			const ordered = [ ...present, ...[ ...t.ids ].filter( ( id ) => ! tokens.idSet.has( id ) ) ];
			const keys = ordered.slice( 0, 4 ).map( ( id ) => data.lexicon[ id ].k ).join( ', ' );
			const more = t.ids.size > 4 ? '…' : '';
			const where = present.length ? `${ present.length } in passage` : miss( 'none in passage' );
			bits.push( `${ t.ids.size } word${ t.ids.size === 1 ? '' : 's' } (${ keys }${ more }), ${ where }` );
		}
		for ( const ph of t.phrases ) {
			const unknown = ph.parts.filter( ( part ) => part.ids && ! part.ids.size ).map( ( part ) => escapeHtml( part.text ) );
			if ( unknown.length ) {
				bits.push( miss( `phrase: no match for ${ unknown.join( ', ' ) }` ) );
				continue;
			}
			const n = result.phraseCounts.get( ph ) || 0;
			bits.push( `phrase, ${ n ? `${ n } time${ n === 1 ? '' : 's' } in passage` : miss( 'not in passage' ) }` );
		}
		if ( ! bits.length ) return miss( `${ escapeHtml( t.text ) }: no match` );
		return `<strong>${ escapeHtml( t.text ) }</strong>: ${ bits.join( '; ' ) }`;
	} );
	$( 'wordStatus' ).innerHTML = lines.join( '<br>' );
}

let lastAnalysisKey = '';
function update() {
	if ( ! data ) return;
	let segments;
	try {
		segments = parser.parse( state.passage );
	} catch ( err ) {
		setStatus( err.message, true );
		return;
	}
	const labels = segments.map( parser.label );
	const tokKey = JSON.stringify( segments );
	let tokens = tokenCache.get( tokKey );
	if ( ! tokens ) {
		tokens = collectTokens( data, segments );
		tokenCache.clear();
		tokenCache.set( tokKey, tokens );
	}
	const opts = {
		grouping: state.grouping,
		prefixes: state.prefixes,
		minCount: state.minCount,
		maxCount: state.maxCount,
		minBible: state.minBible,
		maxBible: state.maxBible,
		skipTop: state.skipTop,
		maxRidges: Math.max( 1, Math.min( 500, state.maxRidges || 50 ) ),
		bandwidth: state.bandwidth / 100,
		order: state.order,
		reverse: state.reverse,
		normalise: state.normalise,
		bins: 800,
		words: state.words,
		wordMode: state.wordMode,
		combineTerms: state.combineTerms,
	};
	const analysisKey = tokKey + JSON.stringify( opts );
	opts.selection = wordSelection( tokens );
	let result = current?.result;
	if ( analysisKey !== lastAnalysisKey || ! result ) {
		result = analyse( data, tokens, opts );
		lastAnalysisKey = analysisKey;
	}
	current = { segments, labels, tokens, result };
	renderWordStatus( opts.selection, tokens, result );
	updateOutputs();

	if ( tokens.words === undefined ) tokens.words = tokens.ids.reduce( ( n, id ) => n + ( data.lexicon[ id ].p ? 0 : 1 ), 0 );
	const words = tokens.words.toLocaleString();
	setStatus( `${ labels.length > 3 ? labels.length + ' passages' : labels.join( '; ' ) } · ${ words } words` );
	const listed = opts.selection?.mode === 'only';
	$( 'summary' ).innerHTML = listed
		? `<strong>${ result.ridges.length }</strong> ridge${ result.ridges.length === 1 ? '' : 's' } from your word list${
				result.afterFilter > result.ridges.length ? ` (${ result.afterFilter } found; raise “Max. ridges” to see all)` : ''
		  }`
		: result.ridges.length
		? `<strong>${ result.ridges.length }</strong> of ${ result.afterFilter.toLocaleString() } matching words shown (${ result.groupsFound.toLocaleString() } distinct in passage)`
		: `No words match the current filters (${ result.groupsFound.toLocaleString() } distinct in passage).`;

	drawToScreen();
}

function plotWidth() {
	return state.width || Math.max( 360, wrap.clientWidth - 2 );
}

function drawToScreen() {
	if ( ! current ) return;
	const o = renderOptions( current.labels );
	const L = layout( current.result, o, plotWidth() );
	const dpr = window.devicePixelRatio || 1;
	canvas.width = Math.round( L.width * dpr );
	canvas.height = Math.round( L.height * dpr );
	canvas.style.width = L.width + 'px';
	canvas.style.height = L.height + 'px';
	const ctx = canvas.getContext( '2d' );
	ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
	current.layout = L;
	current.hit = draw( new CanvasBackend( ctx ), current.result, current.tokens, current.labels, o, L );
	canvas.setAttribute(
		'aria-label',
		`Ridgeline plot of ${ current.result.ridges.length } words in ${ current.labels.join( '; ' ) }`
	);
	crosshair.style.color = o.textColour;
	hideTooltip();
}

// ---------------------------------------------------------------------------
// Hover

const ref = ( v ) => `${ data.books[ v.b ].name } ${ v.c + 1 }:${ v.v + 1 }`;
const escapeHtml = ( s ) => String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ] ) );

function hitTest( x, y ) {
	const h = current?.hit;
	if ( ! h || x < h.left || x > h.right ) return null;
	const k = Math.round( ( ( x - h.left ) / h.plotW ) * ( h.bins - 1 ) );
	for ( let i = h.rows.length - 1; i >= 0; i-- ) {
		const r = h.rows[ i ];
		if ( y <= r.base + 2 && y >= r.base - r.g.y[ k ] * h.ridgeH - 2 ) return { row: r, k };
	}
	let best = null;
	for ( const r of h.rows ) {
		const d = Math.abs( y - ( r.base - state.spacing / 2 ) );
		if ( d <= state.spacing / 2 && ( ! best || d < best.d ) ) best = { row: r, k, d };
	}
	return best;
}

function hideTooltip() {
	tooltip.hidden = true;
	crosshair.hidden = true;
}

canvas.addEventListener( 'mouseleave', hideTooltip );
canvas.addEventListener( 'mousemove', ( e ) => {
	if ( ! current?.hit ) return;
	const x = e.offsetX;
	const y = e.offsetY;
	const hit = hitTest( x, y );
	const h = current.hit;
	if ( x >= h.left && x <= h.right ) {
		crosshair.hidden = false;
		crosshair.style.left = x + 'px';
		crosshair.style.height = current.layout.height + 'px';
	} else crosshair.hidden = true;
	if ( ! hit ) {
		tooltip.hidden = true;
		return;
	}
	const g = hit.row.g;
	const e0 = g.label;
	const total = current.tokens.total;
	const pos = Math.min( total - 1, Math.floor( ( ( x - h.left ) / h.plotW ) * total ) );
	const here = verseAt( current.tokens, Math.max( 0, pos ) );
	const centre = verseAt( current.tokens, Math.floor( g.median * total ) );
	const members = [ ...g.members.entries() ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] );
	const memberHtml = g.isPhrase
		? `<dt>Phrase</dt><dd>${ escapeHtml( g.term ) }</dd>`
		: members.length > 1
			? `<dt>Grouped</dt><dd>${ members
					.slice( 0, 8 )
					.map( ( [ id, n ] ) => `${ escapeHtml( data.lexicon[ id ].l ) } ${ escapeHtml( data.lexicon[ id ].g ) } (${ n })` )
					.join( ', ' ) }${ members.length > 8 ? '…' : '' }</dd>`
			: '';
	tooltip.innerHTML = `
		<div><span class="swatch" style="background:${ hit.row.colour }"></span><span class="lemma" lang="${ e0.lang === 'greek' ? 'grc' : 'hbo' }">${ escapeHtml( e0.l ) }</span></div>
		<div>${ escapeHtml( e0.t ) }${ e0.t ? ' · ' : '' }<strong>${ escapeHtml( e0.g ) }</strong> · ${ escapeHtml( e0.k ) }</div>
		${ e0.d ? `<div class="def">${ escapeHtml( e0.d ) }${ e0.d.length >= 100 ? '…' : '' }</div>` : '' }
		<dl>
			<dt>In passage</dt><dd>${ g.count.toLocaleString() } (${ ( ( g.count / total ) * 1000 ).toFixed( 1 ) } per 1,000 words)</dd>
			${ g.isPhrase ? '' : `<dt>Whole Bible</dt><dd>${ g.bible.toLocaleString() }</dd>` }
			<dt>Centre</dt><dd>${ ref( centre ) }</dd>
			<dt>Here</dt><dd>${ ref( here ) } · ${ g.curve[ hit.k ].toFixed( 1 ) } per 1,000</dd>
			${ memberHtml }
		</dl>`;
	tooltip.hidden = false;
	const tw = tooltip.offsetWidth;
	const th = tooltip.offsetHeight;
	let tx = x + 14;
	if ( tx + tw > wrap.scrollLeft + wrap.clientWidth - 4 ) tx = x - tw - 14;
	let ty = y + 14;
	if ( ty + th > current.layout.height ) ty = Math.max( 0, y - th - 14 );
	tooltip.style.left = tx + 'px';
	tooltip.style.top = ty + 'px';
} );

// ---------------------------------------------------------------------------
// Export

function slug() {
	return (
		( current?.labels.join( '_' ) || 'ridgeline' )
			.replace( /[^a-z0-9]+/gi, '-' )
			.replace( /^-|-$/g, '' )
			.slice( 0, 80 ) || 'ridgeline'
	);
}

function download( blob, name ) {
	const a = document.createElement( 'a' );
	a.href = URL.createObjectURL( blob );
	a.download = name;
	document.body.appendChild( a );
	a.click();
	a.remove();
	setTimeout( () => URL.revokeObjectURL( a.href ), 2000 );
}

$( 'exportPng' ).addEventListener( 'click', () => {
	if ( ! current ) return;
	const scale = parseFloat( $( 'exportScale' ).value ) || 2;
	const o = renderOptions( current.labels );
	const L = layout( current.result, o, plotWidth() );
	const c = document.createElement( 'canvas' );
	c.width = Math.round( L.width * scale );
	c.height = Math.round( L.height * scale );
	const ctx = c.getContext( '2d' );
	ctx.setTransform( scale, 0, 0, scale, 0, 0 );
	draw( new CanvasBackend( ctx ), current.result, current.tokens, current.labels, o, L );
	c.toBlob( ( blob ) => blob && download( blob, slug() + '.png' ), 'image/png' );
} );

$( 'exportSvg' ).addEventListener( 'click', () => {
	if ( ! current ) return;
	const o = renderOptions( current.labels );
	const L = layout( current.result, o, plotWidth() );
	const svg = new SvgBackend( L.width, L.height );
	draw( svg, current.result, current.tokens, current.labels, o, L );
	download( new Blob( [ svg.toString() ], { type: 'image/svg+xml' } ), slug() + '.svg' );
} );

$( 'exportCsv' ).addEventListener( 'click', () => {
	if ( ! current ) return;
	const { result, tokens } = current;
	const q = ( s ) => `"${ String( s ).replace( /"/g, '""' ) }"`;
	const rows = [ [ 'rank', 'strongs', 'lemma', 'transliteration', 'gloss', 'count', 'per_1000', 'bible_count', 'median_ref', 'peak_ref', 'grouped_strongs' ] ];
	result.ridges.forEach( ( g, i ) => {
		const e = g.label;
		rows.push( [
			i + 1,
			e.k,
			e.l,
			e.t,
			e.g,
			g.count,
			( ( g.count / tokens.total ) * 1000 ).toFixed( 2 ),
			g.bible,
			ref( verseAt( tokens, Math.floor( g.median * tokens.total ) ) ),
			ref( verseAt( tokens, Math.floor( g.peak * tokens.total ) ) ),
			[ ...g.members.keys() ].map( ( id ) => data.lexicon[ id ].k ).join( ' ' ),
		] );
	} );
	const csv = '﻿' + rows.map( ( r ) => r.map( q ).join( ',' ) ).join( '\n' );
	download( new Blob( [ csv ], { type: 'text/csv;charset=utf-8' } ), slug() + '.csv' );
} );

// ---------------------------------------------------------------------------
// Fonts: canvas only uses a web font once it has loaded, so redraw when they arrive.

const loadedFonts = new Set();
function ensureFont( id ) {
	const f = FONTS[ id ];
	if ( ! f || loadedFonts.has( id ) || ! document.fonts ) return;
	loadedFonts.add( id );
	Promise.all(
		f.families.flatMap( ( fam ) => [
			document.fonts.load( `400 16px '${ fam }'`, 'אבג αβγ abc' ),
			document.fonts.load( `600 16px '${ fam }'`, 'abc' ),
			document.fonts.load( `italic 400 16px '${ fam }'`, 'abc' ),
		] )
	)
		.catch( () => {} )
		.then( () => drawToScreen() );
}
form.addEventListener( 'change', ( e ) => {
	if ( e.target.name === 'font' ) ensureFont( e.target.value );
} );

let resizeTimer = null;
new ResizeObserver( () => {
	if ( state.width ) return;
	clearTimeout( resizeTimer );
	resizeTimer = setTimeout( drawToScreen, 120 );
} ).observe( wrap );

window.addEventListener( 'hashchange', () => {
	const next = readHash();
	if ( JSON.stringify( next ) === JSON.stringify( state ) ) return;
	state = next;
	syncForm();
	update();
} );

// ---------------------------------------------------------------------------
// Boot

populateSelects();
state = readHash();
syncForm();
ensureFont( state.font );

loadData( 'data/' )
	.then( ( d ) => {
		data = d;
		parser = createParser( data.books );
		$( 'loading' ).hidden = true;
		update();
	} )
	.catch( ( err ) => {
		$( 'loading' ).textContent = `Couldn’t load the Bible data (${ err.message }).`;
	} );
