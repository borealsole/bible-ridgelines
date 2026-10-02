// Ridgeline renderer. One layout routine draws through a tiny backend
// interface so the same plot can go to a <canvas> (screen, PNG) or an SVG string.

export const PALETTES = {
	viridis: [ '#440154', '#482878', '#3e4a89', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725' ],
	magma: [ '#1c1031', '#4f127b', '#812581', '#b5367a', '#e55964', '#fb8761', '#fec287', '#fcfdbf' ],
	plasma: [ '#0d0887', '#5302a3', '#8b0aa5', '#b83289', '#db5c68', '#f48849', '#febd2a', '#f0f921' ],
	cividis: [ '#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838' ],
	sunset: [ '#f3e79b', '#fac484', '#f8a07e', '#eb7f86', '#ce6693', '#a059a0', '#5c53a5' ],
	teal: [ '#b8e6dc', '#0b4f4a' ],
	blues: [ '#c6dbef', '#08306b' ],
	reds: [ '#fcbba1', '#67000d' ],
	greys: [ '#d4d4d4', '#262626' ],
	earth: [ '#e9d8a6', '#ee9b00', '#ca6702', '#9b2226' ],
};

export const LANGUAGE_COLOURS = { hebrew: '#2a6f97', aramaic: '#c2410c', greek: '#7a3e9d' };

function hexToRgb( hex ) {
	const h = hex.replace( '#', '' );
	const full = h.length === 3 ? h.split( '' ).map( ( c ) => c + c ).join( '' ) : h;
	const n = parseInt( full, 16 );
	return [ ( n >> 16 ) & 255, ( n >> 8 ) & 255, n & 255 ];
}
function rgbToHex( [ r, g, b ] ) {
	return '#' + [ r, g, b ].map( ( v ) => Math.round( v ).toString( 16 ).padStart( 2, '0' ) ).join( '' );
}
export function interpolate( stops, t ) {
	t = Math.max( 0, Math.min( 1, t ) );
	if ( stops.length === 1 ) return stops[ 0 ];
	const x = t * ( stops.length - 1 );
	const i = Math.min( stops.length - 2, Math.floor( x ) );
	const f = x - i;
	const a = hexToRgb( stops[ i ] );
	const b = hexToRgb( stops[ i + 1 ] );
	return rgbToHex( a.map( ( v, k ) => v + ( b[ k ] - v ) * f ) );
}

// ---------------------------------------------------------------------------
// Backends

const measureCtx = document.createElement( 'canvas' ).getContext( '2d' );
const fontString = ( o ) =>
	`${ o.italic ? 'italic ' : '' }${ o.weight || 400 } ${ o.size }px ${ o.family }`;

export function measure( str, o ) {
	measureCtx.font = fontString( o );
	return measureCtx.measureText( str ).width;
}

export class CanvasBackend {
	constructor( ctx ) {
		this.ctx = ctx;
	}
	rect( x, y, w, h, fill ) {
		this.ctx.fillStyle = fill;
		this.ctx.fillRect( x, y, w, h );
	}
	path( pts, o ) {
		const { ctx } = this;
		ctx.beginPath();
		ctx.moveTo( pts[ 0 ], pts[ 1 ] );
		for ( let i = 2; i < pts.length; i += 2 ) ctx.lineTo( pts[ i ], pts[ i + 1 ] );
		if ( o.close ) ctx.closePath();
		if ( o.fill ) {
			ctx.globalAlpha = o.fillOpacity ?? 1;
			ctx.fillStyle = o.fill;
			ctx.fill();
			ctx.globalAlpha = 1;
		}
		if ( o.stroke && o.strokeWidth > 0 ) {
			ctx.lineJoin = 'round';
			ctx.lineWidth = o.strokeWidth;
			ctx.strokeStyle = o.stroke;
			ctx.globalAlpha = o.strokeOpacity ?? 1;
			ctx.setLineDash( o.dash || [] );
			ctx.stroke();
			ctx.setLineDash( [] );
			ctx.globalAlpha = 1;
		}
	}
	line( x1, y1, x2, y2, o ) {
		this.path( [ x1, y1, x2, y2 ], o );
	}
	text( str, x, y, o ) {
		const { ctx } = this;
		ctx.font = fontString( o );
		ctx.fillStyle = o.color;
		ctx.textAlign = o.align || 'left';
		ctx.textBaseline = o.baseline || 'alphabetic';
		ctx.globalAlpha = o.opacity ?? 1;
		ctx.fillText( str, x, y );
		ctx.globalAlpha = 1;
	}
}

const esc = ( s ) =>
	String( s ).replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ c ] ) );
const r2 = ( n ) => Math.round( n * 100 ) / 100;

export class SvgBackend {
	constructor( width, height ) {
		this.width = width;
		this.height = height;
		this.parts = [];
	}
	rect( x, y, w, h, fill ) {
		this.parts.push( `<rect x="${ r2( x ) }" y="${ r2( y ) }" width="${ r2( w ) }" height="${ r2( h ) }" fill="${ fill }"/>` );
	}
	path( pts, o ) {
		let d = `M${ r2( pts[ 0 ] ) } ${ r2( pts[ 1 ] ) }`;
		for ( let i = 2; i < pts.length; i += 2 ) d += `L${ r2( pts[ i ] ) } ${ r2( pts[ i + 1 ] ) }`;
		if ( o.close ) d += 'Z';
		const attrs = [ `d="${ d }"` ];
		attrs.push( o.fill ? `fill="${ o.fill }" fill-opacity="${ o.fillOpacity ?? 1 }"` : 'fill="none"' );
		if ( o.stroke && o.strokeWidth > 0 ) {
			attrs.push( `stroke="${ o.stroke }" stroke-width="${ o.strokeWidth }" stroke-linejoin="round"` );
			if ( o.strokeOpacity !== undefined && o.strokeOpacity !== 1 ) attrs.push( `stroke-opacity="${ o.strokeOpacity }"` );
			if ( o.dash ) attrs.push( `stroke-dasharray="${ o.dash.join( ' ' ) }"` );
		}
		this.parts.push( `<path ${ attrs.join( ' ' ) }/>` );
	}
	line( x1, y1, x2, y2, o ) {
		this.path( [ x1, y1, x2, y2 ], o );
	}
	text( str, x, y, o ) {
		const anchor = { left: 'start', right: 'end', center: 'middle' }[ o.align || 'left' ];
		const baseline = { middle: 'central', top: 'hanging', bottom: 'text-after-edge', alphabetic: 'auto' }[ o.baseline || 'alphabetic' ];
		this.parts.push(
			`<text x="${ r2( x ) }" y="${ r2( y ) }" text-anchor="${ anchor }" dominant-baseline="${ baseline }" font-family="${ esc(
				o.family
			) }" font-size="${ o.size }" font-weight="${ o.weight || 400 }"${ o.italic ? ' font-style="italic"' : '' } fill="${ o.color }"${
				o.opacity !== undefined && o.opacity !== 1 ? ` fill-opacity="${ o.opacity }"` : ''
			}>${ esc( str ) }</text>`
		);
	}
	toString() {
		return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${ this.width }" height="${ this.height }" viewBox="0 0 ${ this.width } ${ this.height }">\n${ this.parts.join(
			'\n'
		) }\n</svg>\n`;
	}
}

// ---------------------------------------------------------------------------
// Labels & colours

export function ridgeLabels( g, mode, showStrongs ) {
	const e = g.label;
	// LRM keeps the "+n" suffix after right-to-left Hebrew text.
	const extra = g.members.size > 1 ? `\u200E +${ g.members.size - 1 }` : '';
	let primary;
	let secondary = '';
	switch ( mode ) {
		case 'gloss':
			primary = e.g;
			break;
		case 'translit':
			primary = e.t || e.l;
			break;
		case 'both':
			primary = e.l;
			secondary = e.g;
			break;
		case 'strongs':
			primary = e.k;
			break;
		default:
			primary = e.l;
	}
	if ( showStrongs && mode !== 'strongs' ) secondary = ( secondary ? secondary + ' · ' : '' ) + e.k;
	return { primary: primary + extra, secondary, rtl: ( mode === 'original' || mode === 'both' ) && e.lang !== 'greek' };
}

function colourFor( g, i, n, o, stats ) {
	const stops = PALETTES[ o.palette ] || PALETTES.viridis;
	switch ( o.colourBy ) {
		case 'single':
			return o.colour;
		case 'language':
			return LANGUAGE_COLOURS[ g.label.lang ];
		case 'position':
			return interpolate( stops, g.median );
		case 'frequency': {
			const t = stats.maxLog > stats.minLog ? ( Math.log( g.bible + 1 ) - stats.minLog ) / ( stats.maxLog - stats.minLog ) : 0.5;
			return interpolate( stops, t );
		}
		case 'count': {
			const t = stats.maxCount > stats.minCount ? ( Math.log( g.count ) - Math.log( stats.minCount ) ) / ( Math.log( stats.maxCount ) - Math.log( stats.minCount ) ) : 0.5;
			return interpolate( stops, t );
		}
		default:
			return interpolate( stops, n > 1 ? i / ( n - 1 ) : 0.5 );
	}
}

// ---------------------------------------------------------------------------
// Axis ticks

function axisMarks( tokens, segLabels, plotW ) {
	const { total } = tokens;
	const marks = { segments: [], ticks: [] };
	tokens.segStarts.forEach( ( start, si ) => {
		const end = si + 1 < tokens.segStarts.length ? tokens.segStarts[ si + 1 ] : total;
		marks.segments.push( { start: start / total, end: end / total, label: segLabels[ si ] } );
	} );
	// Chapter starts (or verses, for short passages)
	const chapterStarts = [];
	const verseStarts = [];
	let prev = null;
	for ( const v of tokens.verses ) {
		const key = v.b * 1000 + v.c;
		if ( key !== prev ) chapterStarts.push( v );
		prev = key;
		verseStarts.push( v );
	}
	// Book names come from the segment labels; ticks carry chapter or verse numbers.
	const room = plotW / 34;
	let list;
	let fmt;
	if ( chapterStarts.length > 1 ) {
		list = chapterStarts;
		fmt = ( v ) => String( v.c + 1 );
		if ( chapterStarts.length > room * 3 ) {
			// too many chapters to number: unlabelled ticks at segment starts
			list = chapterStarts.filter( ( v, i ) => i === 0 || v.seg !== chapterStarts[ i - 1 ].seg );
			fmt = () => '';
		}
	} else {
		list = verseStarts;
		fmt = ( v ) => String( v.v + 1 );
	}
	const step = Math.max( 1, Math.ceil( list.length / room ) );
	const nice = [ 1, 2, 5, 10, 20, 25, 50, 100, 200, 500 ].find( ( s ) => s >= step ) || step;
	list.forEach( ( v, i ) => {
		const major = list === verseStarts ? ( v.v + 1 ) % nice === 0 || v.v === 0 : i % nice === 0 || v.c === 0;
		marks.ticks.push( { x: v.pos / total, label: major ? fmt( v ) : '', major } );
	} );
	return marks;
}

// ---------------------------------------------------------------------------
// Layout + draw

export function layout( result, o, width ) {
	const font = { family: o.font, size: o.fontSize };
	const secFont = { family: o.font, size: Math.round( o.fontSize * 0.8 ), italic: true };
	const labels = result.ridges.map( ( g ) => ridgeLabels( g, o.labelMode, o.showStrongs ) );
	let primaryW = 0;
	let secondaryW = 0;
	for ( const l of labels ) {
		primaryW = Math.max( primaryW, measure( l.primary, font ) );
		if ( l.secondary ) secondaryW = Math.max( secondaryW, measure( l.secondary, secFont ) );
	}
	const pad = 16;
	const gap = 10;
	const labelW = o.showLabels ? primaryW + ( secondaryW ? secondaryW + gap : 0 ) + gap : 0;
	const titleH = o.title ? o.fontSize * 1.6 + 12 : 0;
	const left = pad + labelW;
	const right = width - pad - ( o.showLabels && o.labelSide === 'both' ? labelW : 0 );
	const ridgeH = o.spacing * o.overlap;
	const top = pad + titleH + ridgeH;
	const n = result.ridges.length;
	const lastBaseline = top + Math.max( 0, n - 1 ) * o.spacing;
	const axisH = o.showAxis ? o.fontSize * 2.6 + 16 : 4;
	const height = Math.ceil( lastBaseline + axisH + pad );
	return { width, height, left, right, top, ridgeH, labels, primaryW, secondaryW, font, secFont, titleH, pad, gap };
}

export function draw( backend, result, tokens, segLabels, o, L ) {
	const { width, height, left, right, top, ridgeH, labels } = L;
	const plotW = right - left;
	backend.rect( 0, 0, width, height, o.background );

	if ( o.title ) {
		backend.text( o.title, left, L.pad + o.fontSize * 1.1, {
			family: o.font,
			size: Math.round( o.fontSize * 1.3 ),
			weight: 600,
			color: o.textColour,
			baseline: 'alphabetic',
		} );
	}

	const n = result.ridges.length;
	const stats = { minLog: Infinity, maxLog: -Infinity, minCount: Infinity, maxCount: 0 };
	for ( const g of result.ridges ) {
		const lg = Math.log( g.bible + 1 );
		stats.minLog = Math.min( stats.minLog, lg );
		stats.maxLog = Math.max( stats.maxLog, lg );
		stats.minCount = Math.min( stats.minCount, g.count );
		stats.maxCount = Math.max( stats.maxCount, g.count );
	}

	// Segment separators and ticks behind the ridges
	const marks = o.showAxis || o.showSeparators ? axisMarks( tokens, segLabels, plotW ) : null;
	const axisY = top + Math.max( 0, n - 1 ) * o.spacing + 6;
	if ( marks && o.showSeparators && marks.segments.length > 1 ) {
		for ( const s of marks.segments.slice( 1 ) ) {
			const x = left + s.start * plotW;
			backend.line( x, top - ridgeH, x, axisY, { stroke: o.textColour, strokeWidth: 1, strokeOpacity: 0.35, dash: [ 3, 4 ] } );
		}
	}

	const rows = [];
	const bins = result.bins;
	result.ridges.forEach( ( g, i ) => {
		const base = top + i * o.spacing;
		const colour = colourFor( g, i, n, o, stats );
		const curve = [];
		const step = plotW / ( bins - 1 );
		for ( let k = 0; k < bins; k++ ) {
			curve.push( left + k * step, base - g.y[ k ] * ridgeH );
		}
		const strokeCol = o.lineMode === 'fill' ? colour : o.lineColour;
		if ( o.fillMode !== 'none' ) {
			backend.path( [ left, base, ...curve, right, base ], {
				close: true,
				fill: o.fillMode === 'background' ? o.background : colour,
				fillOpacity: o.fillMode === 'background' ? 1 : o.opacity,
			} );
		}
		// Outline only the ridge's top edge, not the sides and floor.
		backend.path( curve, { stroke: strokeCol, strokeWidth: o.lineWidth } );
		if ( o.baseline ) {
			backend.line( left, base, right, base, { stroke: strokeCol, strokeWidth: Math.max( 0.5, o.lineWidth / 2 ) } );
		}
		if ( o.showLabels ) {
			const l = labels[ i ];
			const labelY = base - Math.min( ridgeH, o.spacing ) * 0.25;
			const tc = o.labelColourBy === 'ridge' ? colour : o.textColour;
			backend.text( l.primary, left - L.gap, labelY, { ...L.font, color: tc, align: 'right', baseline: 'middle' } );
			if ( l.secondary ) {
				backend.text( l.secondary, left - L.gap - L.primaryW - L.gap, labelY, {
					...L.secFont,
					color: o.textColour,
					opacity: 0.75,
					align: 'right',
					baseline: 'middle',
				} );
			}
			if ( o.labelSide === 'both' ) {
				backend.text( l.primary, right + L.gap, labelY, { ...L.font, color: tc, align: 'left', baseline: 'middle' } );
			}
		}
		rows.push( { g, base, colour } );
	} );

	if ( marks && o.showAxis ) {
		const tickFont = { family: o.font, size: Math.round( o.fontSize * 0.75 ) };
		backend.line( left, axisY, right, axisY, { stroke: o.textColour, strokeWidth: 1, strokeOpacity: 0.5 } );
		let lastRight = -Infinity;
		for ( const t of marks.ticks ) {
			const x = left + t.x * plotW;
			backend.line( x, axisY, x, axisY + ( t.major ? 5 : 3 ), { stroke: o.textColour, strokeWidth: 1, strokeOpacity: t.major ? 0.6 : 0.3 } );
			if ( t.label ) {
				const w = measure( t.label, tickFont );
				if ( x - w / 2 > lastRight + 4 && x + w / 2 <= width - 2 ) {
					backend.text( t.label, x, axisY + 8, { ...tickFont, color: o.textColour, opacity: 0.7, align: 'center', baseline: 'top' } );
					lastRight = x + w / 2;
				}
			}
		}
		// Segment labels under the ticks
		const segFont = { family: o.font, size: Math.round( o.fontSize * 0.8 ), weight: 600 };
		lastRight = -Infinity;
		const segY = axisY + 8 + tickFont.size * 1.4;
		for ( const s of marks.segments ) {
			const cx = left + ( ( s.start + s.end ) / 2 ) * plotW;
			const w = measure( s.label, segFont );
			let x = Math.max( left + w / 2, Math.min( right - w / 2, cx ) );
			if ( x - w / 2 > lastRight + 8 ) {
				backend.text( s.label, x, segY, { ...segFont, color: o.textColour, opacity: 0.85, align: 'center', baseline: 'top' } );
				lastRight = x + w / 2;
			}
		}
	}
	return { rows, left, right, top, ridgeH, bins, plotW };
}
