//! Stamps real page numbers into a PrintToPdf output.
//!
//! Chromium (WebView2 included) only resolves CSS `counter(page)` and
//! `counter(pages)` inside `@page` margin boxes. The export's footer is an
//! in-page bar instead (a repeating table row or a fixed element, with images,
//! backgrounds and edge-to-edge bands), so its number is stamped after printing.
//! TOC numbers always are, since Chromium doesn't support `target-counter()`.
//!
//! The export HTML renders an (almost) invisible marker text inside the footer's
//! page-number slot and in each TOC row. After printing we locate the markers on
//! every page, which tells us both *whether* the footer was drawn on that page
//! (title/TOC pages hide it) and *exactly where* the number belongs, then draw
//! the label right-aligned to it, in the markers' own embedded font when that
//! font has every glyph the labels need (all the footer numbers, or all the TOC
//! numbers, so they match each other). The marker glyphs are then cut out of
//! the page content, so the codes don't turn up when the PDF's text is copied,
//! searched or read by a screen reader.
//!
//! Every heading carries a marker too, so the stamper also knows each heading's
//! page and writes the PDF's bookmarks from them. With "number from body", a
//! marker at the top of the body tells it where page 1 is.

use std::collections::hash_map::Entry;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::ops::Range;
use std::path::{Path, PathBuf};

use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Dictionary, Document, Encoding, Object, ObjectId, Stream, StringFormat};

use crate::pdf_export::{PdfHeading, PdfPrintOptions};

pub const FOOTER_MARK: &str = "SFPN";

const FONT_NAME: &str = "ScrivonPN";
/// ExtGState resource carrying the label's alpha when the colour is translucent.
const ALPHA_GS_NAME: &str = "ScrivonPNa";
const FALLBACK_FONT_SIZE: f32 = 9.0;
const FALLBACK_PAD_PT: f32 = 6.0;
const FALLBACK_BASELINE_OFFSET_PT: f32 = 8.0;
const MAX_XOBJECT_DEPTH: usize = 4;
/// The export CSS draws markers at 1% opacity; anything more opaque is document text.
const MARKER_MAX_ALPHA: f32 = 0.05;
/// The export draws its glyph samples (`.pdf-stamp-glyphs`) at 1px, which is 0.75pt.
/// Text this small and nearly transparent is a sample, never document text.
const SAMPLE_MAX_FONT_SIZE: f32 = 1.0;
/// Why the footer numbers were left out when no page drew its footer.
const FOOTER_NOT_FOUND: &str = "Scrivon couldn't find the footer on any page, so it left the \
     page numbers out. Content wider than the page can push the footer off.";

/// Prefix for a user template; the remainder may contain `{{page}}` / `{{total}}`.
const CUSTOM_FORMAT_PREFIX: &str = "custom:";

pub fn format_page_label(format: &str, page: u32, total: u32) -> Option<String> {
    match format {
        "number" => Some(page.to_string()),
        "page-n" => Some(format!("Page {page}")),
        "n-of-total" => Some(format!("{page} / {total}")),
        _ => format
            .strip_prefix(CUSTOM_FORMAT_PREFIX)
            .filter(|template| !template.trim().is_empty())
            .map(|template| fill_template(template, page, total)),
    }
}

fn fill_template(template: &str, page: u32, total: u32) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        match after.find("}}") {
            Some(end) => {
                match after[..end].trim() {
                    "page" => out.push_str(&page.to_string()),
                    "total" => out.push_str(&total.to_string()),
                    _ => out.push_str(&rest[start..start + 2 + end + 2]),
                }
                rest = &after[end + 2..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

fn mm_to_pt(mm: f64) -> f32 {
    (mm * 72.0 / 25.4) as f32
}

type Rgb = (f32, f32, f32);

/// Matches the `#404040` chrome text colour in the export CSS.
const DEFAULT_LABEL_RGB: Rgb = (0.25, 0.25, 0.25);

/// `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa` → PDF `rg` components plus alpha (1.0 when absent).
pub fn parse_hex_color(value: &str) -> Option<(Rgb, f32)> {
    let hex = value.trim().strip_prefix('#')?;
    let digits: Vec<u32> = hex.chars().map(|c| c.to_digit(16)).collect::<Option<_>>()?;
    let (r, g, b, a) = match digits.len() {
        3 => (digits[0] * 17, digits[1] * 17, digits[2] * 17, 255),
        4 => (
            digits[0] * 17,
            digits[1] * 17,
            digits[2] * 17,
            digits[3] * 17,
        ),
        6 | 8 => (
            digits[0] * 16 + digits[1],
            digits[2] * 16 + digits[3],
            digits[4] * 16 + digits[5],
            if digits.len() == 8 {
                digits[6] * 16 + digits[7]
            } else {
                255
            },
        ),
        _ => return None,
    };
    Some((
        (r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0),
        a as f32 / 255.0,
    ))
}

/// Helvetica advance widths (per 1000 em) from the standard AFM metrics.
fn helvetica_width(ch: char) -> f32 {
    match ch {
        ' ' | '!' | ',' | '.' | '/' | ':' | ';' | 'I' | '[' | '\\' | ']' | 'f' | 't' => 278.0,
        '"' => 355.0,
        '#'
        | '$'
        | '?'
        | '_'
        | 'L'
        | 'a'
        | 'b'
        | 'd'
        | 'e'
        | 'g'
        | 'h'
        | 'n'
        | 'o'
        | 'p'
        | 'q'
        | 'u'
        | '0'..='9' => 556.0,
        '%' => 889.0,
        '&' | 'A' | 'B' | 'E' | 'K' | 'P' | 'S' | 'V' | 'X' | 'Y' => 667.0,
        '\'' => 191.0,
        '(' | ')' | '-' | '`' | 'r' => 333.0,
        '*' => 389.0,
        '+' | '<' | '=' | '>' | '~' | '^' => 584.0,
        '@' => 1015.0,
        'C' | 'D' | 'H' | 'N' | 'R' | 'U' | 'w' => 722.0,
        'F' | 'T' | 'Z' => 611.0,
        'G' | 'O' | 'Q' => 778.0,
        'J' | 'c' | 'k' | 's' | 'v' | 'x' | 'y' | 'z' => 500.0,
        'M' | 'm' => 833.0,
        'W' => 944.0,
        'i' | 'j' | 'l' | '\u{2018}' | '\u{2019}' => 222.0,
        '{' | '}' => 334.0,
        '|' => 260.0,
        '\u{2013}' => 556.0,
        '\u{2014}' | '\u{2026}' => 1000.0,
        '\u{2022}' => 350.0,
        '\u{201C}' | '\u{201D}' => 333.0,
        '\u{00A9}' | '\u{00AE}' => 737.0,
        _ => 556.0,
    }
}

fn label_width(label: &str, font_size: f32) -> f32 {
    label.chars().map(helvetica_width).sum::<f32>() / 1000.0 * font_size
}

/// Encodes a label for the Helvetica/WinAnsiEncoding font the stamper adds.
/// Latin-1 maps straight through; the common typographic extras get their
/// WinAnsi slots; anything else becomes `?` rather than a garbage glyph.
fn win_ansi_bytes(label: &str) -> Vec<u8> {
    label
        .chars()
        .map(|ch| match ch {
            '\u{20AC}' => 0x80,
            '\u{2026}' => 0x85,
            '\u{2018}' => 0x91,
            '\u{2019}' => 0x92,
            '\u{201C}' => 0x93,
            '\u{201D}' => 0x94,
            '\u{2022}' => 0x95,
            '\u{2013}' => 0x96,
            '\u{2014}' => 0x97,
            '\u{2122}' => 0x99,
            c if (c as u32) < 0x80 || (0xA0..=0xFF).contains(&(c as u32)) => c as u32 as u8,
            _ => b'?',
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Matrices (PDF row-vector convention: p' = p × M)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq)]
struct Matrix {
    a: f32,
    b: f32,
    c: f32,
    d: f32,
    e: f32,
    f: f32,
}

impl Matrix {
    const IDENTITY: Matrix = Matrix {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    fn translate(tx: f32, ty: f32) -> Matrix {
        Matrix {
            e: tx,
            f: ty,
            ..Matrix::IDENTITY
        }
    }

    fn from_operands(operands: &[Object]) -> Option<Matrix> {
        if operands.len() < 6 {
            return None;
        }
        Some(Matrix {
            a: operand_f32(&operands[0]),
            b: operand_f32(&operands[1]),
            c: operand_f32(&operands[2]),
            d: operand_f32(&operands[3]),
            e: operand_f32(&operands[4]),
            f: operand_f32(&operands[5]),
        })
    }

    /// `self` applied first, then `other`.
    fn then(self, other: Matrix) -> Matrix {
        Matrix {
            a: self.a * other.a + self.b * other.c,
            b: self.a * other.b + self.b * other.d,
            c: self.c * other.a + self.d * other.c,
            d: self.c * other.b + self.d * other.d,
            e: self.e * other.a + self.f * other.c + other.e,
            f: self.e * other.b + self.f * other.d + other.f,
        }
    }

    fn apply(self, x: f32, y: f32) -> (f32, f32) {
        (
            self.a * x + self.c * y + self.e,
            self.b * x + self.d * y + self.f,
        )
    }

    /// Length of the transformed unit vector along the text baseline's normal.
    fn vertical_scale(self) -> f32 {
        (self.c * self.c + self.d * self.d).sqrt()
    }
}

fn operand_f32(obj: &Object) -> f32 {
    match obj {
        Object::Integer(n) => *n as f32,
        Object::Real(n) => *n,
        _ => 0.0,
    }
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

struct WidthSet {
    exact: HashMap<u32, f32>,
    /// Inclusive ranges. Kept as ranges so a font that maps thousands of
    /// character ids to one width does not allocate an entry per id.
    ranges: Vec<(u32, u32, f32)>,
}

impl WidthSet {
    fn new() -> Self {
        Self {
            exact: HashMap::new(),
            ranges: Vec::new(),
        }
    }

    fn get(&self, code: u32) -> Option<f32> {
        if let Some(width) = self.exact.get(&code) {
            return Some(*width);
        }
        self.ranges
            .iter()
            .find(|&&(start, end, _)| code >= start && code <= end)
            .map(|&(_, _, width)| width)
    }
}

struct FontInfo<'a> {
    encoding: Option<Encoding<'a>>,
    two_byte: bool,
    widths: WidthSet,
    default_width: f32,
}

impl FontInfo<'_> {
    fn code_len(&self) -> usize {
        if self.two_byte {
            2
        } else {
            1
        }
    }

    fn width(&self, code: u32) -> f32 {
        self.widths.get(code).unwrap_or(self.default_width)
    }
}

fn deref<'a>(doc: &'a Document, obj: &'a Object) -> &'a Object {
    doc.dereference(obj).map(|(_, o)| o).unwrap_or(obj)
}

fn parse_cid_widths(doc: &Document, w: &[Object], into: &mut WidthSet) {
    let mut index = 0;
    while index < w.len() {
        let first = operand_f32(deref(doc, &w[index])) as u32;
        match w.get(index + 1).map(|o| deref(doc, o)) {
            Some(Object::Array(items)) => {
                for (offset, item) in items.iter().enumerate() {
                    into.exact
                        .insert(first + offset as u32, operand_f32(deref(doc, item)));
                }
                index += 2;
            }
            Some(last_obj) => {
                let last = operand_f32(last_obj) as u32;
                let width = w
                    .get(index + 2)
                    .map(|o| operand_f32(deref(doc, o)))
                    .unwrap_or(0.0);
                if last >= first && last - first < 65_536 {
                    if last - first <= 8 {
                        for code in first..=last {
                            into.exact.insert(code, width);
                        }
                    } else {
                        into.ranges.push((first, last, width));
                    }
                }
                index += 3;
            }
            None => break,
        }
    }
}

fn font_info<'a>(doc: &'a Document, font: &'a Dictionary) -> FontInfo<'a> {
    let two_byte = font.get(b"Subtype").and_then(Object::as_name).ok() == Some(b"Type0");
    let mut widths = WidthSet::new();
    let mut default_width = 500.0;

    if two_byte {
        let descendant = font
            .get_deref(b"DescendantFonts", doc)
            .ok()
            .and_then(|o| o.as_array().ok())
            .and_then(|items| items.first())
            .map(|o| deref(doc, o))
            .and_then(|o| o.as_dict().ok());
        if let Some(descendant) = descendant {
            default_width = descendant
                .get_deref(b"DW", doc)
                .ok()
                .map(operand_f32)
                .unwrap_or(1000.0);
            if let Ok(Object::Array(w)) = descendant.get_deref(b"W", doc) {
                parse_cid_widths(doc, w, &mut widths);
            }
        }
    } else {
        let first_char = font
            .get_deref(b"FirstChar", doc)
            .ok()
            .map(operand_f32)
            .unwrap_or(0.0) as u32;
        if let Ok(Object::Array(items)) = font.get_deref(b"Widths", doc) {
            for (offset, item) in items.iter().enumerate() {
                widths
                    .exact
                    .insert(first_char + offset as u32, operand_f32(deref(doc, item)));
            }
        }
        if let Ok(descriptor) = font
            .get_deref(b"FontDescriptor", doc)
            .and_then(Object::as_dict)
        {
            if let Ok(missing) = descriptor.get_deref(b"MissingWidth", doc) {
                default_width = operand_f32(missing);
            }
        }
    }

    FontInfo {
        encoding: font.get_font_encoding(doc).ok(),
        two_byte,
        widths,
        default_width,
    }
}

/// Parsed fonts keyed by object id. Chromium shares one font across every page,
/// and parsing its ToUnicode map walks every mapped character, so it must happen
/// once per export rather than once per page.
struct FontCache<'a> {
    by_id: HashMap<ObjectId, FontInfo<'a>>,
}

#[derive(Clone, Copy)]
enum FontSlot {
    Inline(usize),
    Cached(ObjectId),
}

struct PageFonts<'a> {
    inline: Vec<FontInfo<'a>>,
    by_name: BTreeMap<Vec<u8>, FontSlot>,
}

impl<'a> PageFonts<'a> {
    fn resolve<'b>(&'b self, slot: FontSlot, cache: &'b FontCache<'a>) -> Option<&'b FontInfo<'a>> {
        match slot {
            FontSlot::Inline(index) => self.inline.get(index),
            FontSlot::Cached(id) => cache.by_id.get(&id),
        }
    }
}

fn ensure_cached_font<'a>(doc: &'a Document, cache: &mut FontCache<'a>, id: ObjectId) {
    if cache.by_id.contains_key(&id) {
        return;
    }
    if let Ok(font) = doc.get_dictionary(id) {
        cache.by_id.insert(id, font_info(doc, font));
    }
}

fn preload_resources<'a>(
    doc: &'a Document,
    cache: &mut FontCache<'a>,
    resources: &Dictionary,
    depth: usize,
) {
    if let Ok(font_dict) = resources.get_deref(b"Font", doc).and_then(Object::as_dict) {
        for value in font_dict.iter().map(|(_, value)| value) {
            if let Ok(id) = value.as_reference() {
                ensure_cached_font(doc, cache, id);
            }
        }
    }
    if depth >= MAX_XOBJECT_DEPTH {
        return;
    }
    let Ok(xobjects) = resources
        .get_deref(b"XObject", doc)
        .and_then(Object::as_dict)
    else {
        return;
    };
    for value in xobjects.iter().map(|(_, value)| value) {
        let Ok(stream) = deref(doc, value).as_stream() else {
            continue;
        };
        if stream.dict.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Form") {
            continue;
        }
        if let Ok(inner) = stream
            .dict
            .get_deref(b"Resources", doc)
            .and_then(Object::as_dict)
        {
            preload_resources(doc, cache, inner, depth + 1);
        }
    }
}

fn page_fonts<'a>(
    doc: &'a Document,
    cache: &'a FontCache<'a>,
    resources: Option<&'a Dictionary>,
) -> PageFonts<'a> {
    let mut page = PageFonts {
        inline: Vec::new(),
        by_name: BTreeMap::new(),
    };
    let Some(resources) = resources else {
        return page;
    };
    let Ok(font_dict) = resources.get_deref(b"Font", doc).and_then(Object::as_dict) else {
        return page;
    };
    for (name, value) in font_dict.iter() {
        if let Ok(id) = value.as_reference() {
            if cache.by_id.contains_key(&id) {
                page.by_name.insert(name.clone(), FontSlot::Cached(id));
            }
        } else if let Ok(font) = deref(doc, value).as_dict() {
            let index = page.inline.len();
            page.inline.push(font_info(doc, font));
            page.by_name.insert(name.clone(), FontSlot::Inline(index));
        }
    }
    page
}

fn page_resources(doc: &Document, page_id: ObjectId) -> Option<&Dictionary> {
    let (direct, ids) = doc.get_page_resources(page_id).ok()?;
    if let Some(direct) = direct {
        return Some(direct);
    }
    ids.into_iter().find_map(|id| doc.get_dictionary(id).ok())
}

// ---------------------------------------------------------------------------
// Marker search
// ---------------------------------------------------------------------------

/// Where a marker (footer page-number slot or TOC page token) was drawn, so a
/// label can be stamped right-aligned in its place.
#[derive(Clone, Copy, Debug)]
pub struct TextSlot {
    /// Right edge of the marker, in page space.
    pub right: f32,
    /// Text baseline of the marker, in page space.
    pub baseline: f32,
    /// Font size the marker was rendered at.
    pub font_size: f32,
    /// The embedded font the marker was drawn in, so the label can match it.
    pub font: Option<ObjectId>,
}

/// Which content stream an operation lives in, so marker text can be cut out of it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Source {
    Page(ObjectId),
    Form(ObjectId),
}

/// The part of one text operation that drew (some of) a marker: byte offsets
/// into that operation's decoded text.
#[derive(Clone, Debug)]
struct Cover {
    source: Source,
    op: usize,
    range: Range<usize>,
}

/// A marker found in the page text.
struct Hit {
    slot: TextSlot,
    /// Every part of it was drawn almost transparent, the way the export CSS
    /// draws markers. Document text that happens to spell a marker is opaque.
    translucent: bool,
    covers: Vec<Cover>,
}

struct Run {
    text: String,
    start: (f32, f32),
    end: (f32, f32),
    font_size: f32,
    /// Index of the operation that drew it, in its content stream.
    op: usize,
    font: FontSlot,
    /// Fill alpha it was drawn with.
    alpha: f32,
}

struct TextState {
    font: Option<FontSlot>,
    size: f32,
    leading: f32,
    tm: Matrix,
    tlm: Matrix,
}

/// The parts of the graphics state the scan follows (`q` saves them, `Q` restores them).
#[derive(Clone, Copy)]
struct Graphics {
    ctm: Matrix,
    fill_alpha: f32,
}

impl Graphics {
    const DEFAULT: Graphics = Graphics {
        ctm: Matrix::IDENTITY,
        fill_alpha: 1.0,
    };
}

fn marker_hit(
    runs: &[Run],
    source: Option<Source>,
    mark_start: usize,
    mark_end: usize,
) -> Option<Hit> {
    let mut offset = 0;
    let mut first = None;
    let mut last = None;
    let mut translucent = true;
    let mut covers = Vec::new();
    for run in runs {
        let run_end = offset + run.text.len();
        let range = mark_start.saturating_sub(offset)..mark_end.min(run_end).saturating_sub(offset);
        if run_end > mark_start && !range.is_empty() {
            first.get_or_insert(run);
            translucent &= run.alpha < MARKER_MAX_ALPHA;
            if let Some(source) = source {
                covers.push(Cover {
                    source,
                    op: run.op,
                    range,
                });
            }
        }
        if run_end >= mark_end {
            last = Some(run);
            break;
        }
        offset = run_end;
    }
    let (first, last) = (first?, last?);
    Some(Hit {
        slot: TextSlot {
            right: last.end.0,
            baseline: first.start.1,
            font_size: first.font_size,
            font: match first.font {
                FontSlot::Cached(id) => Some(id),
                // A font written inline in the resources has no object to point the label at.
                FontSlot::Inline(_) => None,
            },
        },
        translucent,
        covers,
    })
}

/// The export's glyph samples in one text block: text drawn so small and so
/// nearly transparent that it is never document text. They only put glyphs
/// into the PDF's fonts for the stamped labels, so they are cut out with the
/// markers. Each one covers its whole text operation.
fn find_glyph_samples(runs: &[Run], source: Option<Source>) -> Vec<Hit> {
    let Some(source) = source else {
        return Vec::new();
    };
    runs.iter()
        .filter(|run| {
            !run.text.is_empty()
                && run.alpha < MARKER_MAX_ALPHA
                && run.font_size < SAMPLE_MAX_FONT_SIZE
        })
        .map(|run| Hit {
            slot: TextSlot {
                right: run.end.0,
                baseline: run.start.1,
                font_size: run.font_size,
                font: None,
            },
            translucent: true,
            covers: vec![Cover {
                source,
                op: run.op,
                range: 0..run.text.len(),
            }],
        })
        .collect()
}

fn find_footer_marks(runs: &[Run], source: Option<Source>) -> Vec<Hit> {
    let joined: String = runs.iter().map(|run| run.text.as_str()).collect();
    joined
        .match_indices(FOOTER_MARK)
        .filter_map(|(start, _)| marker_hit(runs, source, start, start + FOOTER_MARK.len()))
        .collect()
}

const TOC_SLOT_PREFIX: &str = "SFT";
const TOC_HEAD_PREFIX: &str = "SFH";
const TOC_ID_DIGITS: usize = 4;
/// Drawn at the top of the body's first page, so the pages can be numbered
/// from there. A heading mark with the one number no heading has.
const BODY_MARK: &str = "SFH0000";

/// `SFT0001` / `SFH0001` tokens inside one text block, paired by their four digits.
fn find_toc_tokens(runs: &[Run], source: Option<Source>) -> Vec<(String, Hit)> {
    let joined: String = runs.iter().map(|run| run.text.as_str()).collect();
    let mut hits = Vec::new();
    for prefix in [TOC_SLOT_PREFIX, TOC_HEAD_PREFIX] {
        let mut from = 0;
        while let Some(rel) = joined[from..].find(prefix) {
            let start = from + rel;
            let after = start + prefix.len();
            let rest = joined.get(after..).unwrap_or("");
            let digits: String = rest
                .chars()
                .take(TOC_ID_DIGITS)
                .take_while(|c| c.is_ascii_digit())
                .collect();
            let followed_by_digit = rest
                .chars()
                .nth(TOC_ID_DIGITS)
                .is_some_and(|c| c.is_ascii_digit());
            if digits.len() == TOC_ID_DIGITS && !followed_by_digit {
                if let Some(hit) = marker_hit(runs, source, start, after + TOC_ID_DIGITS) {
                    hits.push((format!("{prefix}{digits}"), hit));
                }
            }
            from = start + prefix.len();
        }
    }
    hits
}

/// One glyph of a text operation.
struct Glyph {
    code: Vec<u8>,
    /// Length in bytes of the text it decodes to.
    text_len: usize,
    /// Advance width, in thousandths of a text space unit.
    width: f32,
}

enum GlyphItem {
    Text(StringFormat, Vec<Glyph>),
    /// A `TJ` position adjustment, kept as it is.
    Adjust(Object),
}

/// A `Tj`/`TJ` split into glyphs, so a marker's glyphs can be cut out of it.
struct OpGlyphs(Vec<GlyphItem>);

impl OpGlyphs {
    /// `None` when decoding glyph by glyph doesn't give back `text` (the run's
    /// decoded text), since marker offsets would then point at the wrong glyphs.
    fn new(op: &Operation, font: &FontInfo<'_>, text: &str) -> Option<Self> {
        let encoding = font.encoding.as_ref()?;
        let mut decoded = String::new();
        let mut split = |bytes: &[u8], format: StringFormat| {
            let glyphs = bytes
                .chunks(font.code_len())
                .map(|code| {
                    let glyph_text = encoding.bytes_to_string(code).unwrap_or_default();
                    decoded.push_str(&glyph_text);
                    let value = code.iter().fold(0u32, |acc, b| acc * 256 + u32::from(*b));
                    Glyph {
                        code: code.to_vec(),
                        text_len: glyph_text.len(),
                        width: font.width(value),
                    }
                })
                .collect();
            GlyphItem::Text(format, glyphs)
        };
        let mut items = Vec::new();
        match (op.operator.as_str(), op.operands.first()) {
            ("Tj", Some(Object::String(bytes, format))) => items.push(split(bytes, *format)),
            ("TJ", Some(Object::Array(parts))) => {
                for part in parts {
                    match part {
                        Object::String(bytes, format) => items.push(split(bytes, *format)),
                        Object::Integer(_) | Object::Real(_) => {
                            items.push(GlyphItem::Adjust(part.clone()))
                        }
                        _ => {}
                    }
                }
            }
            _ => return None,
        }
        (decoded == text).then_some(Self(items))
    }

    /// The operation as a `TJ` without the glyphs inside `remove`. Each removed
    /// stretch becomes a position adjustment of the same width, so the text
    /// after it stays where it was.
    fn without(&self, remove: &[Range<usize>]) -> Operation {
        let removed = |at: usize, len: usize| {
            len > 0 && remove.iter().any(|r| r.start <= at && at + len <= r.end)
        };
        let mut parts = Vec::new();
        let mut gap = 0.0_f32;
        let mut at = 0;
        for item in &self.0 {
            match item {
                GlyphItem::Adjust(adjust) => {
                    push_gap(&mut parts, &mut gap);
                    parts.push(adjust.clone());
                }
                GlyphItem::Text(format, glyphs) => {
                    let mut kept = Vec::new();
                    for glyph in glyphs {
                        if removed(at, glyph.text_len) {
                            if !kept.is_empty() {
                                parts.push(Object::String(std::mem::take(&mut kept), *format));
                            }
                            gap += glyph.width;
                        } else {
                            push_gap(&mut parts, &mut gap);
                            kept.extend_from_slice(&glyph.code);
                        }
                        at += glyph.text_len;
                    }
                    if !kept.is_empty() {
                        parts.push(Object::String(kept, *format));
                    }
                }
            }
        }
        push_gap(&mut parts, &mut gap);
        Operation::new("TJ", vec![Object::Array(parts)])
    }
}

/// A `TJ` number moves the pen back by that many thousandths of a text space
/// unit, so skipping `gap` takes `-gap`.
fn push_gap(parts: &mut Vec<Object>, gap: &mut f32) {
    if *gap != 0.0 {
        parts.push(Object::Real(-*gap));
        *gap = 0.0;
    }
}

#[derive(Default)]
struct Walked {
    footers: Vec<Hit>,
    marks: Vec<(String, Hit)>,
    /// Glyph samples: only cut out, never numbered.
    samples: Vec<Hit>,
    /// The operations the markers were drawn by, split into glyphs. Only these
    /// are kept: holding every page's decoded content would take far more memory.
    glyphs: HashMap<(Source, usize), OpGlyphs>,
}

impl Walked {
    fn hits(&self) -> impl Iterator<Item = &Hit> {
        self.footers
            .iter()
            .chain(self.marks.iter().map(|(_, hit)| hit))
    }

    /// Everything to cut out of the page text: the markers and the glyph samples.
    fn cuts(&self) -> impl Iterator<Item = &Hit> {
        self.hits().chain(&self.samples)
    }
}

/// Fill alpha (`ca`) of the named ExtGState, if it sets one.
fn fill_alpha(doc: &Document, resources: Option<&Dictionary>, name: &[u8]) -> Option<f32> {
    let states = resources?
        .get_deref(b"ExtGState", doc)
        .and_then(Object::as_dict)
        .ok()?;
    let state = deref(doc, states.get(name).ok()?).as_dict().ok()?;
    state.get_deref(b"ca", doc).ok().map(operand_f32)
}

fn show_text(
    state: &mut TextState,
    fonts: &PageFonts<'_>,
    cache: &FontCache<'_>,
    gfx: Graphics,
    op: usize,
    operands: &[Object],
    runs: &mut Vec<Run>,
) {
    let Some(slot) = state.font else {
        return;
    };
    let Some(font) = fonts.resolve(slot, cache) else {
        return;
    };
    let trm = state.tm.then(gfx.ctm);
    let start = trm.apply(0.0, 0.0);
    let font_size = state.size * trm.vertical_scale();

    let mut text = String::new();
    let mut advance = 0.0_f32;
    let push_bytes = |bytes: &[u8], text: &mut String, advance: &mut f32| {
        for code in bytes.chunks(font.code_len()) {
            let value = code.iter().fold(0u32, |acc, b| acc * 256 + u32::from(*b));
            *advance += font.width(value) / 1000.0 * state.size;
        }
        // One decode per drawn string. Decoding glyph-by-glyph allocates a
        // string per character, which dominated export time on long documents.
        if let Some(encoding) = font.encoding.as_ref() {
            if let Ok(decoded) = encoding.bytes_to_string(bytes) {
                text.push_str(&decoded);
            }
        }
    };

    for operand in operands {
        match operand {
            Object::String(bytes, _) => push_bytes(bytes, &mut text, &mut advance),
            Object::Array(items) => {
                for item in items {
                    match item {
                        Object::String(bytes, _) => push_bytes(bytes, &mut text, &mut advance),
                        Object::Integer(_) | Object::Real(_) => {
                            advance -= operand_f32(item) / 1000.0 * state.size;
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    let end = trm.apply(advance, 0.0);
    state.tm = Matrix::translate(advance, 0.0).then(state.tm);
    runs.push(Run {
        text,
        start,
        end,
        font_size,
        op,
        font: slot,
        alpha: gfx.fill_alpha,
    });
}

fn walk_content(
    doc: &Document,
    cache: &FontCache<'_>,
    bytes: &[u8],
    base: Graphics,
    resources: Option<&Dictionary>,
    depth: usize,
    source: Option<Source>,
) -> Walked {
    let Some(content) = Content::decode(bytes).ok() else {
        return Walked::default();
    };
    let fonts = page_fonts(doc, cache, resources);

    let mut gfx = base;
    let mut stack = Vec::new();
    let mut state = TextState {
        font: None,
        size: 0.0,
        leading: 0.0,
        tm: Matrix::IDENTITY,
        tlm: Matrix::IDENTITY,
    };
    let mut runs: Vec<Run> = Vec::new();
    let mut found = Walked::default();

    for (index, op) in content.operations.iter().enumerate() {
        match op.operator.as_str() {
            "q" => stack.push(gfx),
            "Q" => {
                if let Some(saved) = stack.pop() {
                    gfx = saved;
                }
            }
            "cm" => {
                if let Some(m) = Matrix::from_operands(&op.operands) {
                    gfx.ctm = m.then(gfx.ctm);
                }
            }
            "gs" => {
                let alpha = op
                    .operands
                    .first()
                    .and_then(|o| o.as_name().ok())
                    .and_then(|name| fill_alpha(doc, resources, name));
                if let Some(alpha) = alpha {
                    gfx.fill_alpha = alpha;
                }
            }
            "BT" => {
                state.tm = Matrix::IDENTITY;
                state.tlm = Matrix::IDENTITY;
                runs.clear();
            }
            "ET" => {
                let footers = find_footer_marks(&runs, source);
                let marks = find_toc_tokens(&runs, source);
                let samples = find_glyph_samples(&runs, source);
                let covers = footers
                    .iter()
                    .chain(marks.iter().map(|(_, hit)| hit))
                    .chain(&samples)
                    .flat_map(|hit| &hit.covers);
                for cover in covers {
                    let Entry::Vacant(entry) = found.glyphs.entry((cover.source, cover.op)) else {
                        continue;
                    };
                    let split = runs.iter().find(|run| run.op == cover.op).and_then(|run| {
                        let font = fonts.resolve(run.font, cache)?;
                        OpGlyphs::new(&content.operations[cover.op], font, &run.text)
                    });
                    if let Some(split) = split {
                        entry.insert(split);
                    }
                }
                found.footers.extend(footers);
                found.marks.extend(marks);
                found.samples.extend(samples);
                runs.clear();
            }
            "Tf" => {
                state.font = op
                    .operands
                    .first()
                    .and_then(|o| o.as_name().ok())
                    .and_then(|name| fonts.by_name.get(name).copied());
                state.size = op.operands.get(1).map(operand_f32).unwrap_or(1.0);
            }
            "TL" => state.leading = op.operands.first().map(operand_f32).unwrap_or(0.0),
            "Td" | "TD" => {
                if op.operands.len() >= 2 {
                    if op.operator == "TD" {
                        state.leading = -operand_f32(&op.operands[1]);
                    }
                    state.tlm = Matrix::translate(
                        operand_f32(&op.operands[0]),
                        operand_f32(&op.operands[1]),
                    )
                    .then(state.tlm);
                    state.tm = state.tlm;
                }
            }
            "Tm" => {
                if let Some(m) = Matrix::from_operands(&op.operands) {
                    state.tlm = m;
                    state.tm = m;
                }
            }
            "T*" => {
                state.tlm = Matrix::translate(0.0, -state.leading).then(state.tlm);
                state.tm = state.tlm;
            }
            "Tj" | "TJ" => show_text(
                &mut state,
                &fonts,
                cache,
                gfx,
                index,
                &op.operands,
                &mut runs,
            ),
            "'" | "\"" => {
                state.tlm = Matrix::translate(0.0, -state.leading).then(state.tlm);
                state.tm = state.tlm;
                let text_operand = op.operands.last().into_iter().cloned().collect::<Vec<_>>();
                show_text(
                    &mut state,
                    &fonts,
                    cache,
                    gfx,
                    index,
                    &text_operand,
                    &mut runs,
                );
            }
            "Do" if depth < MAX_XOBJECT_DEPTH => {
                let inner = walk_xobject(doc, cache, op, gfx, resources, depth);
                found.footers.extend(inner.footers);
                found.marks.extend(inner.marks);
                found.samples.extend(inner.samples);
                found.glyphs.extend(inner.glyphs);
            }
            _ => {}
        }
    }

    found
}

fn walk_xobject(
    doc: &Document,
    cache: &FontCache<'_>,
    op: &Operation,
    gfx: Graphics,
    resources: Option<&Dictionary>,
    depth: usize,
) -> Walked {
    let Some(name) = op.operands.first().and_then(|o| o.as_name().ok()) else {
        return Walked::default();
    };
    let Some(xobjects) = resources
        .and_then(|r| r.get_deref(b"XObject", doc).ok())
        .and_then(|o| o.as_dict().ok())
    else {
        return Walked::default();
    };
    let Ok(entry) = xobjects.get(name) else {
        return Walked::default();
    };
    let source = entry.as_reference().ok().map(Source::Form);
    let Ok(stream) = deref(doc, entry).as_stream() else {
        return Walked::default();
    };
    if stream.dict.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Form") {
        return Walked::default();
    }
    let matrix = stream
        .dict
        .get_deref(b"Matrix", doc)
        .ok()
        .and_then(|o| o.as_array().ok())
        .and_then(|items| Matrix::from_operands(items))
        .unwrap_or(Matrix::IDENTITY);
    let inner_resources = stream
        .dict
        .get_deref(b"Resources", doc)
        .ok()
        .and_then(|o| o.as_dict().ok());
    let bytes = stream
        .decompressed_content()
        .unwrap_or_else(|_| stream.content.clone());
    walk_content(
        doc,
        cache,
        &bytes,
        Graphics {
            ctm: matrix.then(gfx.ctm),
            ..gfx
        },
        inner_resources.or(resources),
        depth + 1,
        source,
    )
}

fn cache_for_pages<'a>(doc: &'a Document, pages: &[ObjectId]) -> FontCache<'a> {
    let mut cache = FontCache {
        by_id: HashMap::new(),
    };
    for page_id in pages {
        if let Some(resources) = page_resources(doc, *page_id) {
            preload_resources(doc, &mut cache, resources, 0);
        }
    }
    cache
}

fn scan_page(doc: &Document, cache: &FontCache<'_>, page_id: ObjectId) -> Walked {
    let bytes = doc.get_page_content(page_id);
    walk_content(
        doc,
        cache,
        &bytes,
        Graphics::DEFAULT,
        page_resources(doc, page_id),
        0,
        Some(Source::Page(page_id)),
    )
}

/// Drops marker look-alikes that are really document text. The export draws
/// real markers almost transparent, so once any translucent marker is found,
/// opaque matches (body text that happens to read `SFPN`) are left alone. If
/// none is translucent the alpha couldn't be read, and every match is kept to
/// place the numbers by. Returns whether any translucent marker was found:
/// only then is it safe to cut the markers out of the text.
fn keep_real_markers(scans: &mut [Walked]) -> bool {
    let alpha_known = scans
        .iter()
        .any(|scan| scan.hits().any(|hit| hit.translucent));
    if alpha_known {
        for scan in scans {
            scan.footers.retain(|hit| hit.translucent);
            scan.marks.retain(|(_, hit)| hit.translucent);
        }
    }
    alpha_known
}

/// Cuts the markers' glyphs out of the content streams that drew them, so the
/// codes don't show up when the PDF's text is copied, searched or read aloud.
fn blank_markers(doc: &mut Document, scans: Vec<Walked>) {
    let mut covers: HashMap<Source, BTreeMap<usize, Vec<Range<usize>>>> = HashMap::new();
    let mut glyphs: HashMap<(Source, usize), OpGlyphs> = HashMap::new();
    for scan in scans {
        for cover in scan.cuts().flat_map(|hit| &hit.covers) {
            covers
                .entry(cover.source)
                .or_default()
                .entry(cover.op)
                .or_default()
                .push(cover.range.clone());
        }
        glyphs.extend(scan.glyphs);
    }

    for (source, ops) in covers {
        let cuts: Vec<(usize, Operation)> = ops
            .iter()
            .filter_map(|(op, ranges)| Some((*op, glyphs.get(&(source, *op))?.without(ranges))))
            .collect();
        // A stream that can't be rewritten keeps its (invisible) markers; the
        // page numbers still go on.
        if let Err(err) = cut_stream(doc, source, cuts) {
            eprintln!("Could not remove page-number markers: {err}");
        }
    }
}

/// Re-reads one content stream the way the scan read it, swaps in `cuts` by
/// operation index and writes it back.
fn cut_stream(
    doc: &mut Document,
    source: Source,
    cuts: Vec<(usize, Operation)>,
) -> lopdf::Result<()> {
    if cuts.is_empty() {
        return Ok(());
    }
    let bytes = match source {
        Source::Page(page_id) => doc.get_page_content(page_id),
        Source::Form(id) => {
            let stream = doc.get_object(id).and_then(Object::as_stream)?;
            stream
                .decompressed_content()
                .unwrap_or_else(|_| stream.content.clone())
        }
    };
    let mut content = Content::decode(&bytes)?;
    for (index, op) in cuts {
        if let Some(slot) = content.operations.get_mut(index) {
            *slot = op;
        }
    }
    let bytes = content.encode()?;
    match source {
        Source::Page(page_id) => doc.change_page_content(page_id, bytes)?,
        Source::Form(id) => doc.change_content_stream(id, bytes),
    }
    Ok(())
}

/// Finds the page-number slot marker on a page, if the footer was drawn there.
#[cfg(test)]
fn footer_slot(doc: &Document, page_id: ObjectId) -> Option<TextSlot> {
    let cache = cache_for_pages(doc, &[page_id]);
    scan_page(doc, &cache, page_id)
        .footers
        .first()
        .map(|hit| hit.slot)
}

// ---------------------------------------------------------------------------
// Stamping
// ---------------------------------------------------------------------------

/// A page attribute that the page may inherit from its parents in the page
/// tree (`/Resources`, `/MediaBox`, `/CropBox`).
fn inherited_attr(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut seen = HashSet::new();
    let mut node_id = page_id;
    while seen.insert(node_id) {
        let node = doc.get_dictionary(node_id).ok()?;
        if let Ok(value) = node.get(key) {
            return Some(value.clone());
        }
        node_id = node.get(b"Parent").and_then(Object::as_reference).ok()?;
    }
    None
}

fn page_media_box(doc: &Document, page_id: ObjectId) -> Result<(f32, f32), String> {
    let box_obj = inherited_attr(doc, page_id, b"MediaBox")
        .or_else(|| inherited_attr(doc, page_id, b"CropBox"))
        .ok_or_else(|| "Page is missing a media box.".to_string())?;
    let values = match deref(doc, &box_obj) {
        Object::Array(items) => items
            .iter()
            .map(|item| operand_f32(deref(doc, item)))
            .collect::<Vec<_>>(),
        _ => return Err("Page is missing a media box.".into()),
    };
    if values.len() < 4 {
        return Err("Page media box is invalid.".into());
    }
    Ok((values[2] - values[0], values[3] - values[1]))
}

fn same_size(a: (f32, f32), b: (f32, f32)) -> bool {
    (a.0 - b.0).abs() < 0.5 && (a.1 - b.1).abs() < 0.5
}

/// Where the footer's page number sits on the pages that drew it, and the size
/// of that page. Takes the lowest slot: a section's last page can leave its
/// footer part-way up the page.
fn footer_template(
    doc: &Document,
    pages: &[(u32, ObjectId)],
    scans: &[Walked],
) -> Option<(TextSlot, (f32, f32))> {
    let (page_id, slot) = pages
        .iter()
        .zip(scans)
        .filter_map(|((_, page_id), scan)| Some((*page_id, scan.footers.first()?.slot)))
        .min_by(|a, b| a.1.baseline.total_cmp(&b.1.baseline))?;
    Some((slot, page_media_box(doc, page_id).ok()?))
}

/// Registers `id` as `/category /name` in the page's resources, whether those
/// live inline on the page or behind a shared reference, without losing any
/// of the resources the page already uses.
fn ensure_page_resource(
    doc: &mut Document,
    page_id: ObjectId,
    category: &str,
    name: &str,
    id: ObjectId,
) -> Result<(), String> {
    let own = doc
        .get_dictionary(page_id)
        .map_err(|e| e.to_string())?
        .get(b"Resources")
        .ok()
        .cloned();
    let shared_id = match own {
        Some(Object::Reference(resources_id)) => Some(resources_id),
        Some(_) => None,
        None => {
            // Inherited from the page tree: copy them onto the page, so the new
            // entry doesn't hide the fonts and images the page already uses.
            let inherited = match inherited_attr(doc, page_id, b"Resources") {
                Some(Object::Reference(resources_id)) => {
                    doc.get_dictionary(resources_id).ok().cloned()
                }
                Some(Object::Dictionary(resources)) => Some(resources),
                _ => None,
            };
            doc.get_dictionary_mut(page_id)
                .map_err(|e| e.to_string())?
                .set("Resources", inherited.unwrap_or_default());
            None
        }
    };

    // The category (`/Font`, `/ExtGState`) can itself be a reference, often
    // shared with other pages: add to a copy of it rather than replacing it.
    let replacement = match page_resources_mut(doc, page_id, shared_id)?.get(category.as_bytes()) {
        Ok(Object::Dictionary(_)) => None,
        Ok(Object::Reference(entries_id)) => {
            let entries_id = *entries_id;
            Some(
                doc.get_dictionary(entries_id)
                    .ok()
                    .cloned()
                    .unwrap_or_default(),
            )
        }
        _ => Some(Dictionary::new()),
    };
    let resources = page_resources_mut(doc, page_id, shared_id)?;
    if let Some(entries) = replacement {
        resources.set(category, entries);
    }
    resources
        .get_mut(category.as_bytes())
        .and_then(Object::as_dict_mut)
        .map_err(|e| e.to_string())?
        .set(name, id);
    Ok(())
}

/// The page's own resources dictionary: `shared_id` when it's behind a
/// reference, otherwise the one inline on the page.
fn page_resources_mut(
    doc: &mut Document,
    page_id: ObjectId,
    shared_id: Option<ObjectId>,
) -> Result<&mut Dictionary, String> {
    match shared_id {
        Some(resources_id) => doc.get_dictionary_mut(resources_id),
        None => doc
            .get_dictionary_mut(page_id)
            .and_then(|page| page.get_mut(b"Resources"))
            .and_then(Object::as_dict_mut),
    }
    .map_err(|e| e.to_string())
}

/// Appends `bytes` as a new content stream that starts from the page's default
/// graphics state. Chromium leaves a y-flipping `cm` active at the end of its
/// content, so the existing content is wrapped in `q … Q` first.
fn overlay_page_content(
    doc: &mut Document,
    page_id: ObjectId,
    bytes: Vec<u8>,
) -> Result<(), String> {
    let existing = {
        let page = doc.get_object(page_id).map_err(|e| e.to_string())?;
        let dict = page.as_dict().map_err(|e| e.to_string())?;
        dict.get(b"Contents").ok().cloned()
    };

    let save_id = doc.add_object(Stream::new(dictionary! {}, b"q\n".to_vec()));
    // Leading newline: readers treat consecutive streams as whitespace-separated,
    // but not every one inserts that whitespace itself.
    let mut overlay = Vec::from(b"\nQ\nq\n".as_slice());
    overlay.extend(bytes);
    overlay.extend(b"\nQ\n");
    let overlay_id = doc.add_object(Stream::new(dictionary! {}, overlay));

    let mut items = vec![Object::Reference(save_id)];
    match existing {
        Some(Object::Reference(id)) => items.push(Object::Reference(id)),
        Some(Object::Array(refs)) => items.extend(refs),
        Some(other) => items.push(other),
        None => {}
    }
    items.push(Object::Reference(overlay_id));

    let page = doc.get_object_mut(page_id).map_err(|e| e.to_string())?;
    let dict = page.as_dict_mut().map_err(|e| e.to_string())?;
    dict.set("Contents", items);
    Ok(())
}

/// How a stamped label is painted: colour, and whether it goes through the alpha ExtGState.
#[derive(Clone, Copy)]
struct LabelPaint {
    rgb: Rgb,
    translucent: bool,
}

/// What a stamped label is. Both kinds are marked as artifacts (not part of the
/// document's reading order), so screen readers don't read them out of place.
#[derive(Clone, Copy)]
enum LabelRole {
    /// The footer's page number: page furniture.
    Footer,
    /// A TOC row's page number.
    Toc,
}

/// Characters that only print right after text shaping (joining, reordering,
/// combining marks) or that set the reading direction. The stamper draws one
/// glyph per character, left to right, so it leaves these to the Helvetica path.
fn needs_shaping(ch: char) -> bool {
    matches!(
        ch as u32,
        0x0300..=0x036F // combining diacritical marks
            | 0x0483..=0x0489 // combining Cyrillic marks
            | 0x0590..=0x08FF // Hebrew, Arabic, Syriac, Thaana, NKo and other right-to-left scripts
            | 0x0900..=0x0DFF // Indic scripts
            | 0x0E00..=0x0EFF // Thai, Lao
            | 0x0F00..=0x109F // Tibetan, Myanmar
            | 0x1780..=0x18AF // Khmer, Mongolian
            | 0x1A00..=0x1C4F // Buginese to Lepcha, with their combining marks
            | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF // more combining marks
            | 0x200B..=0x200F // zero-width joiners and direction marks
            | 0x202A..=0x202E | 0x2066..=0x2069 // direction embeddings and isolates
            | 0xA800..=0xABFF // more Indic and South-East Asian scripts
            | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF // Hebrew and Arabic presentation forms
            | 0xFE00..=0xFE0F | 0xFE20..=0xFE2F // variation selectors, combining half marks
            | 0x10800..=0x10FFF | 0x1E800..=0x1EFFF // right-to-left scripts
            | 0x11000..=0x11FFF // Brahmi and other shaped scripts
            | 0xE0100..=0xE01EF // variation selectors
    )
}

/// The label as 2-byte glyph codes in an embedded Type0 font (the kind Chromium
/// embeds), with its advance in thousandths of an em. `None` unless the font
/// has a glyph for every character: its ToUnicode map lists the glyphs its
/// subset holds.
fn embedded_label(font: &FontInfo<'_>, label: &str) -> Option<(Vec<u8>, f32)> {
    if !font.two_byte || label.is_empty() || label.chars().any(needs_shaping) {
        return None;
    }
    let Some(Encoding::UnicodeMapEncoding(cmap)) = font.encoding.as_ref() else {
        return None;
    };
    let mut codes = Vec::with_capacity(label.len() * 2);
    let mut width = 0.0;
    let mut units = [0_u16; 2];
    for ch in label.chars() {
        // Several glyphs can stand for one character (a tabular digit, say):
        // the lowest id is usually the font's default form.
        let code = cmap
            .get_source_codes_for_unicode(ch.encode_utf16(&mut units))?
            .iter()
            .filter(|entry| entry.code_len == 2)
            .map(|entry| entry.source_code)
            .min()?;
        codes.extend_from_slice(&(code as u16).to_be_bytes());
        width += font.width(code);
    }
    Some((codes, width))
}

/// What a stamped label is drawn with.
enum LabelGlyphs {
    /// Glyph codes in a font the PDF already embeds, registered on the page as
    /// `name`, with their advance in thousandths of an em.
    Embedded {
        name: String,
        font: ObjectId,
        codes: Vec<u8>,
        width: f32,
    },
    /// The stamper's own Helvetica, for a label the embedded font can't draw.
    Helvetica,
}

/// A label to stamp, and where: the page's position in the document and the
/// marker's slot on it.
struct PlacedLabel {
    position: usize,
    text: String,
    slot: TextSlot,
}

/// Picks the font labels are drawn in, and names the embedded fonts it reuses.
struct LabelFonts<'c, 'a> {
    cache: &'c FontCache<'a>,
    names: BTreeMap<ObjectId, String>,
}

impl<'c, 'a> LabelFonts<'c, 'a> {
    fn new(cache: &'c FontCache<'a>) -> Self {
        Self {
            cache,
            names: BTreeMap::new(),
        }
    }

    /// The fonts one role's labels (every footer number, or every TOC number)
    /// are drawn in, in order. They all use the font their markers were drawn
    /// in when it can draw every one of them, so the numbers match the text
    /// around them; otherwise they all use Helvetica. Choosing per label would
    /// mix the two on one document's pages and in one TOC column, because a
    /// subset font only has the glyphs the document drew in it (the 1, say,
    /// but not the 7).
    fn role_glyphs(&mut self, labels: &[PlacedLabel]) -> Vec<LabelGlyphs> {
        let embedded = labels.first().and_then(|first| {
            let id = first.slot.font?;
            let font = self.cache.by_id.get(&id)?;
            let drawn = labels
                .iter()
                .map(|label| {
                    if label.slot.font != Some(id) {
                        return None;
                    }
                    embedded_label(font, &label.text)
                })
                .collect::<Option<Vec<_>>>()?;
            Some((id, drawn))
        });
        let Some((font, drawn)) = embedded else {
            return labels.iter().map(|_| LabelGlyphs::Helvetica).collect();
        };
        let next = self.names.len() + 1;
        let name = self
            .names
            .entry(font)
            .or_insert_with(|| format!("{FONT_NAME}{next}"))
            .clone();
        drawn
            .into_iter()
            .map(|(codes, width)| LabelGlyphs::Embedded {
                name: name.clone(),
                font,
                codes,
                width,
            })
            .collect()
    }
}

fn label_operations(
    label: &str,
    slot: TextSlot,
    glyphs: &LabelGlyphs,
    paint: LabelPaint,
    role: LabelRole,
) -> Vec<Operation> {
    let font_size = slot.font_size.clamp(6.0, 24.0);
    let (font_name, x, shown) = match glyphs {
        LabelGlyphs::Embedded {
            name, codes, width, ..
        } => (
            name.as_str(),
            slot.right - width / 1000.0 * font_size,
            Object::String(codes.clone(), StringFormat::Hexadecimal),
        ),
        LabelGlyphs::Helvetica => (
            FONT_NAME,
            slot.right - label_width(label, font_size),
            Object::String(win_ansi_bytes(label), StringFormat::Literal),
        ),
    };
    let mut ops = Vec::with_capacity(11);
    // Each label gets its own graphics state, so a translucent footer's alpha
    // doesn't carry over to the TOC labels stamped after it on the same page.
    ops.push(Operation::new("q", vec![]));
    ops.push(match role {
        LabelRole::Footer => Operation::new(
            "BDC",
            vec![
                "Artifact".into(),
                Object::Dictionary(dictionary! { "Type" => "Pagination", "Subtype" => "Footer" }),
            ],
        ),
        LabelRole::Toc => Operation::new("BMC", vec!["Artifact".into()]),
    });
    if paint.translucent {
        ops.push(Operation::new("gs", vec![ALPHA_GS_NAME.into()]));
    }
    ops.extend([
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec![font_name.into(), font_size.into()]),
        Operation::new(
            "rg",
            vec![paint.rgb.0.into(), paint.rgb.1.into(), paint.rgb.2.into()],
        ),
        Operation::new("Td", vec![x.into(), slot.baseline.into()]),
        Operation::new("Tj", vec![shown]),
        Operation::new("ET", vec![]),
        Operation::new("EMC", vec![]),
        Operation::new("Q", vec![]),
    ]);
    ops
}

/// The labels stamped onto one page, and the fonts they are drawn in.
#[derive(Default)]
struct PageLabels {
    operations: Vec<Operation>,
    /// Embedded fonts the labels reuse, by the resource name they're drawn with.
    embedded: BTreeMap<String, ObjectId>,
    /// Whether any label is drawn in the stamper's Helvetica.
    helvetica: bool,
}

impl PageLabels {
    fn add(
        &mut self,
        label: &str,
        slot: TextSlot,
        glyphs: LabelGlyphs,
        paint: LabelPaint,
        role: LabelRole,
    ) {
        self.operations
            .extend(label_operations(label, slot, &glyphs, paint, role));
        match glyphs {
            LabelGlyphs::Embedded { name, font, .. } => {
                self.embedded.insert(name, font);
            }
            LabelGlyphs::Helvetica => self.helvetica = true,
        }
    }
}

struct TocEntry {
    page_id: ObjectId,
    slot: TextSlot,
    label: String,
}

/// Where each heading mark was found, by its four digits: the page's position
/// in the document and the mark's slot. The first one found wins.
fn heading_marks(scans: &[Walked]) -> BTreeMap<String, (usize, TextSlot)> {
    let mut found = BTreeMap::new();
    for (position, scan) in scans.iter().enumerate() {
        for (token, hit) in &scan.marks {
            if let Some(id) = token.strip_prefix(TOC_HEAD_PREFIX) {
                found.entry(id.to_string()).or_insert((position, hit.slot));
            }
        }
    }
    found
}

/// The four digits of the mark on the heading at `index` in the export's heading list.
fn heading_mark_id(index: usize) -> String {
    format!("{:0width$}", index + 1, width = TOC_ID_DIGITS)
}

/// How many pages come before the body, for numbering from the body: 0 when
/// numbering from the first page, or when the body's mark wasn't found.
fn front_pages(options: &PdfPrintOptions, marks: &BTreeMap<String, (usize, TextSlot)>) -> usize {
    if !options.number_from_body {
        return 0;
    }
    marks
        .get(&BODY_MARK[TOC_HEAD_PREFIX.len()..])
        .map_or(0, |(position, _)| *position)
}

/// The number shown for the page at `position` when `front` pages come before
/// page 1. A page before page 1 keeps its place in the document.
fn page_number(position: usize, front: usize) -> u32 {
    (position.checked_sub(front).unwrap_or(position) + 1) as u32
}

/// TOC rows whose heading mark was found, labelled with that heading's page.
fn toc_entries(
    pages: &[(u32, ObjectId)],
    scans: &[Walked],
    headings: &BTreeMap<String, (usize, TextSlot)>,
    front: usize,
) -> Vec<TocEntry> {
    let mut entries = Vec::new();
    for ((_, page_id), scan) in pages.iter().zip(scans) {
        for (token, hit) in &scan.marks {
            let Some(id) = token.strip_prefix(TOC_SLOT_PREFIX) else {
                continue;
            };
            if let Some((position, _)) = headings.get(id) {
                entries.push(TocEntry {
                    page_id: *page_id,
                    slot: hit.slot,
                    label: page_number(*position, front).to_string(),
                });
            }
        }
    }
    entries
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

/// How far above a heading's baseline its bookmark opens the page: room for an
/// H1 at the largest body size (1.64 × 24pt).
const BOOKMARK_HEADROOM_PT: f32 = 40.0;

/// A heading whose mark was found, for the PDF's bookmarks.
struct Bookmark<'a> {
    level: u8,
    title: &'a str,
    page_id: ObjectId,
    /// Where the page opens, in page space.
    top: f32,
}

/// The bookmarks for the export's headings whose marks were found. A heading
/// whose mark is missing is left out, and the headings under it move up a level.
fn bookmarks<'a>(
    doc: &Document,
    pages: &[(u32, ObjectId)],
    headings: &'a [PdfHeading],
    marks: &BTreeMap<String, (usize, TextSlot)>,
) -> Vec<Bookmark<'a>> {
    headings
        .iter()
        .enumerate()
        .filter_map(|(index, heading)| {
            let (position, slot) = marks.get(&heading_mark_id(index))?;
            let page_id = pages.get(*position)?.1;
            let height = page_media_box(doc, page_id).map_or(f32::MAX, |(_, height)| height);
            Some(Bookmark {
                level: heading.level,
                title: &heading.text,
                page_id,
                top: (slot.baseline + BOOKMARK_HEADROOM_PT).min(height),
            })
        })
        .collect()
}

/// Each item's parent: the nearest item before it with a lower level. A level
/// can be skipped (an H3 straight after an H1 still goes under that H1).
fn outline_parents(levels: &[u8]) -> Vec<Option<usize>> {
    let mut open: Vec<usize> = Vec::new();
    levels
        .iter()
        .enumerate()
        .map(|(index, level)| {
            while open.last().is_some_and(|&last| levels[last] >= *level) {
                open.pop();
            }
            let parent = open.last().copied();
            open.push(index);
            parent
        })
        .collect()
}

/// Writes the bookmarks as the PDF's outline, nested by heading level, with
/// every item open. Returns whether it added one.
fn write_outline(doc: &mut Document, bookmarks: &[Bookmark<'_>]) -> bool {
    if bookmarks.is_empty() || doc.catalog().is_err() {
        return false;
    }
    let count = bookmarks.len();
    let parents = outline_parents(&bookmarks.iter().map(|b| b.level).collect::<Vec<_>>());
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); count];
    let mut top_level = Vec::new();
    for (index, parent) in parents.iter().enumerate() {
        match parent {
            Some(parent) => children[*parent].push(index),
            None => top_level.push(index),
        }
    }
    let mut prev = vec![None; count];
    let mut next = vec![None; count];
    for siblings in std::iter::once(&top_level).chain(&children) {
        for pair in siblings.windows(2) {
            next[pair[0]] = Some(pair[1]);
            prev[pair[1]] = Some(pair[0]);
        }
    }
    // A child always comes after its parent, so going backwards totals each item's descendants.
    let mut descendants = vec![0_i64; count];
    for index in (0..count).rev() {
        if let Some(parent) = parents[index] {
            descendants[parent] += 1 + descendants[index];
        }
    }

    let root_id = doc.new_object_id();
    let ids: Vec<ObjectId> = (0..count).map(|_| doc.new_object_id()).collect();
    for (index, bookmark) in bookmarks.iter().enumerate() {
        let mut item = dictionary! {
            "Title" => lopdf::text_string(bookmark.title),
            "Parent" => parents[index].map_or(root_id, |parent| ids[parent]),
            // Null left and zoom keep the reader's own.
            "Dest" => vec![
                bookmark.page_id.into(),
                "XYZ".into(),
                Object::Null,
                bookmark.top.into(),
                Object::Null,
            ],
        };
        let links = [
            ("Prev", prev[index]),
            ("Next", next[index]),
            ("First", children[index].first().copied()),
            ("Last", children[index].last().copied()),
        ];
        for (key, other) in links {
            if let Some(other) = other {
                item.set(key, ids[other]);
            }
        }
        if descendants[index] > 0 {
            item.set("Count", descendants[index]);
        }
        doc.set_object(ids[index], item);
    }
    doc.set_object(
        root_id,
        dictionary! {
            "Type" => "Outlines",
            "First" => ids[top_level[0]],
            "Last" => ids[top_level[top_level.len() - 1]],
            "Count" => count as i64,
        },
    );
    match doc.catalog_mut() {
        Ok(catalog) => {
            catalog.set("Outlines", root_id);
            true
        }
        Err(_) => false,
    }
}

/// What numbering the pages did.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Stamped {
    /// The PDF was changed, and the numbered copy written to the output. When
    /// false there was nothing to change, and the output was left alone.
    pub changed: bool,
    /// Why some page numbers were left out, to tell the user.
    pub warning: Option<String>,
}

/// Why the page numbers were left out when the stamper failed. The technical
/// reason goes to the log; the user gets a plain sentence.
const COULD_NOT_READ: &str = "Scrivon couldn't read the printed PDF to add page numbers.";
const COULD_NOT_NUMBER: &str = "Scrivon couldn't add page numbers to this PDF.";
const COULD_NOT_SAVE: &str = "Scrivon couldn't save the numbered copy of this PDF.";

/// Logs `detail` and gives back `message` for the user.
fn plain_error(message: &str, detail: impl std::fmt::Display) -> String {
    eprintln!("PDF page numbers: {message} {detail}");
    message.to_string()
}

/// Numbers the pages of the PDF at `input` and writes the numbered copy to
/// `output` (which may be the same file). The copy goes to a temporary file
/// that is then swapped in, so a failed write never leaves a cut-off PDF.
pub fn stamp_page_numbers_to(
    input: &Path,
    output: &Path,
    options: &PdfPrintOptions,
) -> Result<Stamped, String> {
    let mut doc = Document::load(input).map_err(|e| plain_error(COULD_NOT_READ, e))?;
    let mut stamped =
        stamp_document(&mut doc, options).map_err(|e| plain_error(COULD_NOT_NUMBER, e))?;
    if set_document_properties(&mut doc, options) {
        stamped.changed = true;
    }
    if stamped.changed {
        save_replacing(&mut doc, output).map_err(|e| plain_error(COULD_NOT_SAVE, e))?;
    }
    Ok(stamped)
}

#[cfg(test)]
pub fn stamp_page_numbers(path: &str, options: &PdfPrintOptions) -> Result<(), String> {
    let path = Path::new(path);
    stamp_page_numbers_to(path, path, options).map(|_| ())
}

/// Saves the author and subject in the PDF's document properties (its Info
/// dictionary), next to the title Chromium put there. Returns whether it
/// changed anything.
fn set_document_properties(doc: &mut Document, options: &PdfPrintOptions) -> bool {
    let properties: Vec<(&str, &str)> = [
        ("Author", options.author.trim()),
        ("Subject", options.subject.trim()),
    ]
    .into_iter()
    .filter(|(_, value)| !value.is_empty())
    .collect();
    if properties.is_empty() {
        return false;
    }

    let existing = doc
        .trailer
        .get(b"Info")
        .and_then(Object::as_reference)
        .ok()
        .filter(|id| doc.get_dictionary(*id).is_ok());
    let info_id = existing.unwrap_or_else(|| {
        // None yet, or written into the trailer itself: keep its entries in a new one.
        let kept = doc
            .trailer
            .get(b"Info")
            .and_then(Object::as_dict)
            .cloned()
            .unwrap_or_default();
        let id = doc.add_object(kept);
        doc.trailer.set("Info", id);
        id
    });
    let Ok(info) = doc.get_dictionary_mut(info_id) else {
        return false;
    };
    for (key, value) in properties {
        // PDFDocEncoding for plain ASCII, else UTF-16BE with a byte order mark.
        info.set(key, lopdf::text_string(value));
    }
    true
}

/// Writes `doc` next to `output` and then renames it over `output`.
fn save_replacing(doc: &mut Document, output: &Path) -> std::io::Result<()> {
    let temp = TempFile(crate::pdf_export::temp_sibling(output));
    doc.save(&temp.0)
        .and_then(|file| file.sync_all())
        .and_then(|()| std::fs::rename(&temp.0, output))
}

/// A temporary file that is deleted when this is dropped, so a failed save
/// (or a panic part-way through one) doesn't leave it in the user's folder.
/// Once it has been renamed into place there's nothing left to delete.
struct TempFile(PathBuf);

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

/// Stamps the page numbers into `doc` and cuts the markers out.
fn stamp_document(doc: &mut Document, options: &PdfPrintOptions) -> Result<Stamped, String> {
    let format = options.page_number_format.as_str();
    let want_footer = format_page_label(format, 1, 1).is_some();
    let (footer_rgb, footer_alpha) =
        parse_hex_color(&options.page_number_color).unwrap_or((DEFAULT_LABEL_RGB, 1.0));
    let footer_paint = LabelPaint {
        rgb: footer_rgb,
        translucent: footer_alpha < 1.0,
    };
    let toc_paint = LabelPaint {
        rgb: DEFAULT_LABEL_RGB,
        translucent: false,
    };

    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    let total = pages.len() as u32;
    if total == 0 {
        return Ok(Stamped::default());
    }

    let cache = cache_for_pages(doc, &pages.iter().map(|(_, id)| *id).collect::<Vec<_>>());
    let mut scans: Vec<Walked> = pages
        .iter()
        .map(|(_, id)| scan_page(doc, &cache, *id))
        .collect();
    // Markers whose alpha couldn't be read may be the document's own text
    // (`SFPN` in a code sample), so those are never cut out.
    let real_markers = keep_real_markers(&mut scans);
    let headings = heading_marks(&scans);
    // With "number from body", page 1 is the first body page and the title and
    // contents pages before it get no number.
    let front = front_pages(options, &headings);
    let toc = toc_entries(&pages, &scans, &headings, front);
    let bookmarks = bookmarks(doc, &pages, &options.headings, &headings);
    if !want_footer && toc.is_empty() && bookmarks.is_empty() && !real_markers {
        return Ok(Stamped::default());
    }

    // The export only hides the footer on the title and TOC pages, which always
    // come first. So a page without a marker before the first drawn footer hid
    // it on purpose, but one after it lost its slot to the layout (content wider
    // than the page pushes it off the edge) and still needs a number.
    let first_footer = scans.iter().position(|scan| !scan.footers.is_empty());
    let footer_template = footer_template(doc, &pages, &scans);
    // With no footer on any page, the numbers go inside the print margins. In
    // bleed mode those are 0 (the CSS draws the margins), which would put the
    // numbers in the page corners: leave them out and say why instead.
    let footers_lost = want_footer
        && first_footer.is_none()
        && options.margin_right_mm <= 0.0
        && options.margin_bottom_mm <= 0.0;
    let warning = footers_lost.then(|| FOOTER_NOT_FOUND.to_string());

    // Each role's labels are all worked out first, so one font can be chosen
    // for all of them (see `LabelFonts::role_glyphs`).
    let mut footer_labels = Vec::new();
    if want_footer && !footers_lost {
        for (position, ((_, page_id), scan)) in pages.iter().zip(&scans).enumerate().skip(front) {
            let Some(label) =
                format_page_label(format, page_number(position, front), total - front as u32)
            else {
                continue;
            };
            let slot = match scan.footers.first() {
                Some(hit) => hit.slot,
                // The footer was hidden on this page (title / TOC): no number.
                None if first_footer.is_some_and(|first| position < first) => continue,
                None => {
                    let size = page_media_box(doc, *page_id);
                    match footer_template {
                        // The footer slot was lost to the layout: number the page
                        // where the other pages' footers put theirs.
                        Some((slot, template_size))
                            if size
                                .as_ref()
                                .ok()
                                .is_none_or(|size| same_size(*size, template_size)) =>
                        {
                            slot
                        }
                        // No footer marker to go by: number the page inside the bottom margin.
                        _ => {
                            let (width, _) = size?;
                            TextSlot {
                                right: width - mm_to_pt(options.margin_right_mm) - FALLBACK_PAD_PT,
                                baseline: mm_to_pt(options.margin_bottom_mm)
                                    + FALLBACK_BASELINE_OFFSET_PT,
                                font_size: FALLBACK_FONT_SIZE,
                                font: None,
                            }
                        }
                    }
                }
            };
            footer_labels.push(PlacedLabel {
                position,
                text: label,
                slot,
            });
        }
    }
    let page_at: HashMap<ObjectId, usize> = pages
        .iter()
        .enumerate()
        .map(|(position, (_, id))| (*id, position))
        .collect();
    let toc_labels: Vec<PlacedLabel> = toc
        .into_iter()
        .filter_map(|entry| {
            Some(PlacedLabel {
                position: page_at.get(&entry.page_id).copied()?,
                text: entry.label,
                slot: entry.slot,
            })
        })
        .collect();

    let mut fonts = LabelFonts::new(&cache);
    let mut labels: Vec<PageLabels> = pages.iter().map(|_| PageLabels::default()).collect();
    for (role, paint, placed) in [
        (LabelRole::Footer, footer_paint, footer_labels),
        (LabelRole::Toc, toc_paint, toc_labels),
    ] {
        let glyphs = fonts.role_glyphs(&placed);
        for (label, glyphs) in placed.iter().zip(glyphs) {
            labels[label.position].add(&label.text, label.slot, glyphs, paint, role);
        }
    }

    // Cut the markers out first: the overlay below splits each page's content
    // into several streams.
    if real_markers {
        blank_markers(doc, scans);
    }

    let helvetica_id = labels.iter().any(|page| page.helvetica).then(|| {
        doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
        })
    });
    let alpha_gs_id = footer_paint.translucent.then(|| {
        doc.add_object(dictionary! {
            "Type" => "ExtGState",
            "ca" => footer_alpha,
            "CA" => footer_alpha,
        })
    });

    let mut changed = real_markers;
    for (position, page) in labels.into_iter().enumerate() {
        if page.operations.is_empty() {
            continue;
        }
        changed = true;
        let page_id = pages[position].1;
        if let Some(font_id) = helvetica_id.filter(|_| page.helvetica) {
            ensure_page_resource(doc, page_id, "Font", FONT_NAME, font_id)?;
        }
        for (name, font_id) in &page.embedded {
            ensure_page_resource(doc, page_id, "Font", name, *font_id)?;
        }
        if let Some(gs_id) = alpha_gs_id {
            ensure_page_resource(doc, page_id, "ExtGState", ALPHA_GS_NAME, gs_id)?;
        }
        let content = Content {
            operations: page.operations,
        };
        overlay_page_content(doc, page_id, content.encode().map_err(|e| e.to_string())?)?;
    }
    if write_outline(doc, &bookmarks) {
        changed = true;
    }

    Ok(Stamped { changed, warning })
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHROMIUM_FLIP: [f32; 6] = [0.75, 0.0, 0.0, -0.75, 0.0, 842.0];

    fn options(format: &str, color: &str) -> PdfPrintOptions {
        PdfPrintOptions {
            page_width_mm: 210.0,
            page_height_mm: 297.0,
            landscape: false,
            margin_top_mm: 10.0,
            margin_right_mm: 10.0,
            margin_bottom_mm: 10.0,
            margin_left_mm: 10.0,
            page_number_format: format.into(),
            page_number_color: color.into(),
            author: String::new(),
            subject: String::new(),
            headings: Vec::new(),
            number_from_body: false,
        }
    }

    fn helvetica() -> Dictionary {
        dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Helvetica",
            "Encoding" => "WinAnsiEncoding",
            "FirstChar" => 32_i64,
            "Widths" => (32..=127).map(|c| Object::Integer(if c == b' ' as i64 { 278 } else { 600 })).collect::<Vec<_>>(),
        }
    }

    /// A Type0 font the way Skia emits it: Identity-H, 2-byte glyph ids, ToUnicode CMap.
    fn skia_type0(doc: &mut Document) -> Dictionary {
        let cmap = "\
/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CMapName /Adobe-Identity-UCS def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
4 beginbfchar
<0001> <0053>
<0002> <0046>
<0003> <0050>
<0004> <004E>
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end";
        let cmap_id = doc.add_object(Stream::new(dictionary! {}, cmap.as_bytes().to_vec()));
        let descendant_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "CIDFontType2",
            "BaseFont" => "SegoeUI",
            "DW" => 1000_i64,
            "W" => vec![1.into(), vec![Object::Integer(600), 500.into(), 700.into()].into(), 4.into(), 4.into(), 800.into()],
        });
        dictionary! {
            "Type" => "Font",
            "Subtype" => "Type0",
            "BaseFont" => "SegoeUI",
            "Encoding" => "Identity-H",
            "DescendantFonts" => vec![descendant_id.into()],
            "ToUnicode" => cmap_id,
        }
    }

    fn build_pdf(doc: &mut Document, pages: Vec<(Vec<Operation>, Dictionary)>) -> Vec<ObjectId> {
        let pages_id = doc.new_object_id();
        let mut kids = Vec::new();
        let mut ids = Vec::new();
        for (operations, resources) in pages {
            let content_id = doc.add_object(Stream::new(
                dictionary! {},
                Content { operations }.encode().unwrap(),
            ));
            let page_id = doc.add_object(dictionary! {
                "Type" => "Page",
                "Parent" => pages_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
                "Contents" => content_id,
                "Resources" => resources,
            });
            kids.push(page_id.into());
            ids.push(page_id);
        }
        let count = kids.len() as i64;
        doc.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! { "Type" => "Pages", "Kids" => kids, "Count" => count }),
        );
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        ids
    }

    fn flip() -> Operation {
        Operation::new(
            "cm",
            CHROMIUM_FLIP.iter().map(|v| Object::Real(*v)).collect(),
        )
    }

    fn text(font: &str, size: f32, x: f32, y: f32, s: Object) -> Vec<Operation> {
        vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec![font.into(), size.into()]),
            Operation::new(
                "Tm",
                vec![
                    1.into(),
                    0.into(),
                    0.into(),
                    (-1).into(),
                    x.into(),
                    y.into(),
                ],
            ),
            Operation::new("Tj", vec![s]),
            Operation::new("ET", vec![]),
        ]
    }

    fn save_temp(doc: &mut Document, name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(name);
        doc.save(&path).unwrap();
        path
    }

    #[test]
    fn formats_supported_labels() {
        assert_eq!(format_page_label("number", 3, 10).as_deref(), Some("3"));
        assert_eq!(
            format_page_label("page-n", 3, 10).as_deref(),
            Some("Page 3")
        );
        assert_eq!(
            format_page_label("n-of-total", 3, 10).as_deref(),
            Some("3 / 10")
        );
        assert_eq!(format_page_label("none", 3, 10), None);
    }

    #[test]
    fn fills_custom_templates() {
        assert_eq!(
            format_page_label("custom:Page {{page}} of {{total}}", 3, 10).as_deref(),
            Some("Page 3 of 10")
        );
        assert_eq!(
            format_page_label("custom:{{ page }} – Acme", 7, 9).as_deref(),
            Some("7 – Acme")
        );
        assert_eq!(
            format_page_label("custom:{{title}} {{page}}", 1, 1).as_deref(),
            Some("{{title}} 1"),
            "unknown placeholders pass through untouched"
        );
        assert_eq!(
            format_page_label("custom:{{page", 1, 1).as_deref(),
            Some("{{page")
        );
        assert_eq!(format_page_label("custom:", 1, 1), None);
        assert_eq!(format_page_label("bogus", 1, 1), None);
    }

    #[test]
    fn encodes_labels_as_win_ansi() {
        assert_eq!(win_ansi_bytes("Page 3"), b"Page 3");
        assert_eq!(win_ansi_bytes("3 – 4"), vec![b'3', b' ', 0x96, b' ', b'4']);
        assert_eq!(win_ansi_bytes("é"), vec![0xE9]);
        assert_eq!(win_ansi_bytes("→"), b"?");
    }

    #[test]
    fn measures_labels_with_helvetica_metrics() {
        // "Page 3": 667 + 556 + 556 + 556 + 278 + 556 = 3169 per 1000 em.
        assert!((label_width("Page 3", 10.0) - 31.69).abs() < 0.01);
        assert!((label_width("il", 10.0) - 4.44).abs() < 0.01);
    }

    #[test]
    fn parses_hex_colours_and_rejects_junk() {
        assert_eq!(parse_hex_color("#ffffff"), Some(((1.0, 1.0, 1.0), 1.0)));
        assert_eq!(parse_hex_color(" #FFF "), Some(((1.0, 1.0, 1.0), 1.0)));
        assert_eq!(parse_hex_color("#0000"), Some(((0.0, 0.0, 0.0), 0.0)));
        let ((r, g, b), a) = parse_hex_color("#40404080").unwrap();
        assert!(
            (r - 0.251).abs() < 0.001 && (g - 0.251).abs() < 0.001 && (b - 0.251).abs() < 0.001
        );
        assert!((a - 0.502).abs() < 0.001);
        assert_eq!(parse_hex_color(""), None);
        assert_eq!(parse_hex_color("red"), None);
        assert_eq!(parse_hex_color("#12345"), None);
        assert_eq!(parse_hex_color("#gggggg"), None);
    }

    #[test]
    fn matrix_composition_follows_pdf_order() {
        let flip = Matrix::from_operands(
            &CHROMIUM_FLIP
                .iter()
                .map(|v| Object::Real(*v))
                .collect::<Vec<_>>(),
        )
        .unwrap();
        let ctm = flip.then(Matrix::IDENTITY);
        let (x, y) = Matrix::translate(100.0, 50.0).then(ctm).apply(0.0, 0.0);
        assert!((x - 75.0).abs() < 0.01);
        assert!((y - 804.5).abs() < 0.01);
    }

    #[test]
    fn finds_marker_drawn_with_skia_glyph_ids() {
        let mut doc = Document::with_version("1.5");
        let font = skia_type0(&mut doc);
        let mut ops = vec![flip()];
        // Skia style: Tf size 1, scale folded into Tm. Glyph ids 1..4 spell SFPN.
        ops.extend(vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec!["F1".into(), 1.into()]),
            Operation::new(
                "Tm",
                vec![
                    12.into(),
                    0.into(),
                    0.into(),
                    (-12).into(),
                    500.into(),
                    1080.into(),
                ],
            ),
            Operation::new(
                "Tj",
                vec![Object::String(
                    vec![0, 1, 0, 2, 0, 3, 0, 4],
                    lopdf::StringFormat::Hexadecimal,
                )],
            ),
            Operation::new("ET", vec![]),
        ]);
        let ids = build_pdf(
            &mut doc,
            vec![(ops, dictionary! { "Font" => dictionary! { "F1" => font } })],
        );

        let slot = footer_slot(&doc, ids[0]).expect("marker should be found");
        // Start: (500, 1080) through the flip → (375, 32). Advance: (600+500+700+800)/1000 * 12 = 31.2 text units → 23.4pt.
        assert!(
            (slot.right - 398.4).abs() < 0.05,
            "right was {}",
            slot.right
        );
        assert!(
            (slot.baseline - 32.0).abs() < 0.05,
            "baseline was {}",
            slot.baseline
        );
        assert!(
            (slot.font_size - 9.0).abs() < 0.05,
            "font size was {}",
            slot.font_size
        );
    }

    #[test]
    fn finds_marker_split_across_kerned_runs() {
        let mut doc = Document::with_version("1.5");
        let mut ops = vec![flip()];
        ops.extend(vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec!["F1".into(), 10.into()]),
            Operation::new(
                "Tm",
                vec![
                    1.into(),
                    0.into(),
                    0.into(),
                    (-1).into(),
                    600.into(),
                    1000.into(),
                ],
            ),
            Operation::new("Tj", vec![Object::string_literal("SF")]),
            Operation::new("Td", vec![13.into(), 0.into()]),
            Operation::new("Tj", vec![Object::string_literal("PN")]),
            Operation::new("ET", vec![]),
        ]);
        let ids = build_pdf(
            &mut doc,
            vec![(
                ops,
                dictionary! { "Font" => dictionary! { "F1" => helvetica() } },
            )],
        );

        let slot = footer_slot(&doc, ids[0]).expect("marker should be found");
        // Second run starts at 613 (text space) and advances 2 × 600/1000 × 10 = 12 → 625 → ×0.75 = 468.75.
        assert!(
            (slot.right - 468.75).abs() < 0.05,
            "right was {}",
            slot.right
        );
        assert!(
            (slot.baseline - 92.0).abs() < 0.05,
            "baseline was {}",
            slot.baseline
        );
    }

    #[test]
    fn finds_marker_inside_form_xobject() {
        let mut doc = Document::with_version("1.5");
        let inner = Content {
            operations: text(
                "F1",
                10.0,
                400.0,
                1000.0,
                Object::string_literal(FOOTER_MARK),
            ),
        };
        let form_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 1000.into(), 1200.into()],
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => helvetica() } },
            },
            inner.encode().unwrap(),
        ));
        let ops = vec![flip(), Operation::new("Do", vec!["X1".into()])];
        let ids = build_pdf(
            &mut doc,
            vec![(
                ops,
                dictionary! { "XObject" => dictionary! { "X1" => form_id } },
            )],
        );

        let slot = footer_slot(&doc, ids[0]).expect("marker inside XObject should be found");
        assert!(
            (slot.baseline - 92.0).abs() < 0.05,
            "baseline was {}",
            slot.baseline
        );
        assert!(
            (slot.right - (400.0 + 24.0) * 0.75).abs() < 0.05,
            "right was {}",
            slot.right
        );
    }

    #[test]
    fn ignores_pages_without_marker() {
        let mut doc = Document::with_version("1.5");
        let ops = [
            vec![flip()],
            text("F1", 10.0, 100.0, 100.0, Object::string_literal("Contents")),
        ]
        .concat();
        let ids = build_pdf(
            &mut doc,
            vec![(
                ops,
                dictionary! { "Font" => dictionary! { "F1" => helvetica() } },
            )],
        );
        assert!(footer_slot(&doc, ids[0]).is_none());
    }

    #[test]
    fn numbers_only_pages_whose_footer_was_drawn_and_right_aligns_to_slot() {
        let mut doc = Document::with_version("1.5");
        let fonts = || dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        let title = [
            vec![flip()],
            text("F1", 14.0, 100.0, 300.0, Object::string_literal("Title")),
        ]
        .concat();
        let toc = [
            vec![flip()],
            text("F1", 10.0, 100.0, 300.0, Object::string_literal("Contents")),
        ]
        .concat();
        let body = [
            vec![flip()],
            text(
                "F1",
                9.0,
                700.0,
                1060.0,
                Object::string_literal(FOOTER_MARK),
            ),
        ]
        .concat();
        let ids = build_pdf(
            &mut doc,
            vec![
                (title, fonts()),
                (toc, fonts()),
                (body.clone(), fonts()),
                (body, fonts()),
            ],
        );
        let expected_slot = footer_slot(&doc, ids[2]).unwrap();
        let path = save_temp(&mut doc, "scrivon-page-numbers-footer.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("n-of-total", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(
            !stamped.extract_text(&[1]).unwrap().contains("1 / 4"),
            "title page must not be numbered"
        );
        assert!(
            !stamped.extract_text(&[2]).unwrap().contains("2 / 4"),
            "toc page must not be numbered"
        );
        assert!(stamped.extract_text(&[3]).unwrap().contains("3 / 4"));
        assert!(stamped.extract_text(&[4]).unwrap().contains("4 / 4"));

        // The stamped label must end exactly where the footer slot ends, on its baseline, upright.
        let page_ids: Vec<ObjectId> = stamped.get_pages().into_values().collect();
        let (right, baseline, flipped) = stamped_label_extent(&stamped, page_ids[2], "3 / 4");
        assert!(!flipped, "label was drawn upside down");
        assert!(
            (right - expected_slot.right).abs() < 0.1,
            "right {right} vs slot {}",
            expected_slot.right
        );
        assert!(
            (baseline - expected_slot.baseline).abs() < 0.1,
            "baseline {baseline} vs slot {}",
            expected_slot.baseline
        );
    }

    #[test]
    fn numbers_body_pages_whose_footer_slot_was_pushed_off_the_page() {
        // The title page hides its footer and the TOC pages draw theirs (the
        // last one part-way up the page), but content wider than the page
        // pushed the body's footer slot off the edge.
        let mut doc = Document::with_version("1.5");
        let fonts = || dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        let title = [
            vec![flip()],
            text("F1", 14.0, 100.0, 300.0, Object::string_literal("Title")),
        ]
        .concat();
        let toc = |footer_y: f32| {
            [
                vec![flip()],
                text("F1", 10.0, 100.0, 300.0, Object::string_literal("Contents")),
                text(
                    "F1",
                    9.0,
                    700.0,
                    footer_y,
                    Object::string_literal(FOOTER_MARK),
                ),
            ]
            .concat()
        };
        let body = [
            vec![flip()],
            text("F1", 10.0, 100.0, 300.0, Object::string_literal("Body")),
        ]
        .concat();
        let ids = build_pdf(
            &mut doc,
            vec![
                (title, fonts()),
                (toc(1060.0), fonts()),
                (toc(500.0), fonts()),
                (body.clone(), fonts()),
                (body, fonts()),
            ],
        );
        let expected_slot = footer_slot(&doc, ids[1]).unwrap();
        let path = save_temp(&mut doc, "scrivon-page-numbers-lost-slot.pdf");
        // Bleed mode prints with no margins, so the margin fallback would sit in the corner.
        let mut bleed = options("n-of-total", "");
        bleed.margin_right_mm = 0.0;
        bleed.margin_bottom_mm = 0.0;

        stamp_page_numbers(path.to_str().unwrap(), &bleed).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(
            !stamped.extract_text(&[1]).unwrap().contains("1 / 5"),
            "title page must not be numbered"
        );
        assert!(stamped.extract_text(&[2]).unwrap().contains("2 / 5"));
        assert!(stamped.extract_text(&[3]).unwrap().contains("3 / 5"));
        let page_ids: Vec<ObjectId> = stamped.get_pages().into_values().collect();
        for (page, label) in [(4, "4 / 5"), (5, "5 / 5")] {
            assert!(
                stamped.extract_text(&[page]).unwrap().contains(label),
                "body page {page} was not numbered"
            );
            let (right, baseline, _) =
                stamped_label_extent(&stamped, page_ids[page as usize - 1], label);
            assert!(
                (right - expected_slot.right).abs() < 0.1,
                "right {right} vs slot {}",
                expected_slot.right
            );
            assert!(
                (baseline - expected_slot.baseline).abs() < 0.1,
                "baseline {baseline} vs slot {}",
                expected_slot.baseline
            );
        }
    }

    #[test]
    fn stamps_custom_templates_right_aligned_to_the_slot() {
        let mut doc = Document::with_version("1.5");
        let fonts = || dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        let body = [
            vec![flip()],
            text(
                "F1",
                9.0,
                700.0,
                1060.0,
                Object::string_literal(FOOTER_MARK),
            ),
        ]
        .concat();
        let ids = build_pdf(&mut doc, vec![(body.clone(), fonts()), (body, fonts())]);
        let expected_slot = footer_slot(&doc, ids[1]).unwrap();
        let path = save_temp(&mut doc, "scrivon-page-numbers-custom.pdf");

        stamp_page_numbers(
            path.to_str().unwrap(),
            &options("custom:Sheet {{page}} of {{total}} – Acme", "#ff000080"),
        )
        .unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(stamped.extract_text(&[1]).unwrap().contains("Sheet 1 of 2"));
        assert!(stamped.extract_text(&[2]).unwrap().contains("Sheet 2 of 2"));
        let page_ids: Vec<ObjectId> = stamped.get_pages().into_values().collect();
        let (right, baseline, flipped) =
            stamped_label_extent(&stamped, page_ids[1], "Sheet 2 of 2 – Acme");
        assert!(!flipped);
        assert!((right - expected_slot.right).abs() < 0.1);
        assert!((baseline - expected_slot.baseline).abs() < 0.1);

        // A translucent colour paints through an ExtGState registered on the page.
        let content = Content::decode(&stamped.get_page_content(page_ids[1])).unwrap();
        assert!(content.operations.iter().any(|op| {
            op.operator == "gs" && op.operands.first() == Some(&Object::Name(ALPHA_GS_NAME.into()))
        }));
        let resources = stamped.get_page_resources(page_ids[1]).unwrap().0.unwrap();
        let gs = resources.get(b"ExtGState").unwrap().as_dict().unwrap();
        let state = stamped
            .get_object(
                gs.get(ALPHA_GS_NAME.as_bytes())
                    .unwrap()
                    .as_reference()
                    .unwrap(),
            )
            .unwrap()
            .as_dict()
            .unwrap();
        assert!((state.get(b"ca").unwrap().as_float().unwrap() - 0.502).abs() < 0.001);
    }

    #[test]
    fn opaque_colours_do_not_add_an_extgstate() {
        let mut doc = Document::with_version("1.5");
        build_pdf(&mut doc, vec![(vec![], dictionary! {})]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-opaque.pdf");
        stamp_page_numbers(path.to_str().unwrap(), &options("page-n", "#ff0000")).unwrap();
        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let page_id = *stamped.get_pages().values().next().unwrap();
        let content = Content::decode(&stamped.get_page_content(page_id)).unwrap();
        assert!(!content.operations.iter().any(|op| op.operator == "gs"));
        let resources = stamped.get_page_resources(page_id).unwrap().0.unwrap();
        assert!(resources.get(b"ExtGState").is_err());
    }

    #[test]
    fn falls_back_to_margin_position_when_no_page_has_a_footer() {
        let mut doc = Document::with_version("1.5");
        let fonts = || dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        let page = [
            vec![flip()],
            text("F1", 10.0, 100.0, 300.0, Object::string_literal("Body")),
        ]
        .concat();
        build_pdf(&mut doc, vec![(page.clone(), fonts()), (page, fonts())]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-fallback.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("page-n", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(stamped.extract_text(&[1]).unwrap().contains("Page 1"));
        assert!(stamped.extract_text(&[2]).unwrap().contains("Page 2"));
    }

    #[test]
    fn says_in_plain_words_when_the_numbered_copy_cannot_be_saved() {
        let mut doc = Document::with_version("1.5");
        let fonts = || dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        let page = [
            vec![flip()],
            text("F1", 10.0, 100.0, 300.0, Object::string_literal("Body")),
        ]
        .concat();
        build_pdf(&mut doc, vec![(page, fonts())]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-unsaved.pdf");
        let gone = std::env::temp_dir()
            .join(format!("scrivon-gone-{}", uuid::Uuid::new_v4()))
            .join("Report.pdf");

        let result = stamp_page_numbers_to(&path, &gone, &options("page-n", ""));

        let _ = std::fs::remove_file(&path);
        assert_eq!(result, Err(COULD_NOT_SAVE.to_string()));
    }

    #[test]
    fn leaves_numbers_out_of_the_page_corners_when_no_footer_was_found_in_bleed_mode() {
        let mut doc = Document::with_version("1.5");
        let fonts = || dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        let page = [
            vec![flip()],
            text("F1", 10.0, 100.0, 300.0, Object::string_literal("Body")),
        ]
        .concat();
        build_pdf(&mut doc, vec![(page.clone(), fonts()), (page, fonts())]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-bleed-no-footer.pdf");
        let printed = std::fs::read(&path).unwrap();
        // Bleed mode prints with no margins.
        let mut bleed = options("page-n", "");
        bleed.margin_right_mm = 0.0;
        bleed.margin_bottom_mm = 0.0;

        let result = stamp_page_numbers_to(&path, &path, &bleed);

        let after = std::fs::read(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let stamped = result.unwrap();
        assert!(!stamped.changed);
        assert!(
            stamped
                .warning
                .as_deref()
                .is_some_and(|w| w.contains("page numbers out")),
            "{stamped:?}"
        );
        assert!(after == printed, "the PDF was changed");
    }

    #[test]
    fn skips_stamping_when_format_is_none() {
        let mut doc = Document::with_version("1.5");
        build_pdf(&mut doc, vec![(vec![], dictionary! {})]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-none.pdf");
        stamp_page_numbers(path.to_str().unwrap(), &options("none", "")).unwrap();
        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(stamped.extract_text(&[1]).unwrap().trim(), "");
    }

    fn info_entry(doc: &Document, key: &[u8]) -> Option<String> {
        let id = doc.trailer.get(b"Info").ok()?.as_reference().ok()?;
        lopdf::decode_text_string(doc.get_dictionary(id).ok()?.get(key).ok()?).ok()
    }

    #[test]
    fn saves_the_author_and_subject_in_the_document_properties() {
        let mut doc = Document::with_version("1.5");
        build_pdf(&mut doc, vec![(vec![], dictionary! {})]);
        // Chromium writes the page's <title> into the Info dictionary.
        let info_id = doc.add_object(dictionary! { "Title" => Object::string_literal("Report") });
        doc.trailer.set("Info", info_id);
        let path = save_temp(&mut doc, "scrivon-page-numbers-properties.pdf");
        let mut with_properties = options("none", "");
        with_properties.author = " Zoë Ångström ".into();
        with_properties.subject = "Quarterly figures".into();

        let result = stamp_page_numbers_to(&path, &path, &with_properties);

        let saved = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        // Saved even with no page numbers to add.
        assert!(result.unwrap().changed);
        assert_eq!(
            info_entry(&saved, b"Author").as_deref(),
            Some("Zoë Ångström")
        );
        assert_eq!(
            info_entry(&saved, b"Subject").as_deref(),
            Some("Quarterly figures")
        );
        assert_eq!(info_entry(&saved, b"Title").as_deref(), Some("Report"));
    }

    #[test]
    fn adds_document_properties_to_a_pdf_without_any() {
        let mut doc = Document::with_version("1.5");
        build_pdf(&mut doc, vec![(vec![], dictionary! {})]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-new-properties.pdf");
        let mut with_author = options("none", "");
        with_author.author = "Ada".into();

        let result = stamp_page_numbers_to(&path, &path, &with_author);

        let saved = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(result.unwrap().changed);
        assert_eq!(info_entry(&saved, b"Author").as_deref(), Some("Ada"));
        assert_eq!(info_entry(&saved, b"Subject"), None);
    }

    #[test]
    fn stamps_the_heading_page_into_the_toc_slot() {
        let mut doc = Document::with_version("1.5");
        let fonts = || dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        let toc = [
            vec![flip()],
            text("F1", 11.0, 700.0, 400.0, Object::string_literal("SFT0001")),
        ]
        .concat();
        let body = [
            vec![flip()],
            text("F1", 11.0, 100.0, 200.0, Object::string_literal("SFH0001")),
        ]
        .concat();
        build_pdf(
            &mut doc,
            vec![(toc, fonts()), (vec![flip()], fonts()), (body, fonts())],
        );
        let path = save_temp(&mut doc, "scrivon-toc-pages.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("none", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(
            stamped.extract_text(&[1]).unwrap().contains('3'),
            "toc should show the heading's page"
        );
        assert!(!stamped.extract_text(&[2]).unwrap().contains('3'));
    }

    #[test]
    fn a_translucent_footer_does_not_fade_the_toc_numbers() {
        let mut doc = Document::with_version("1.5");
        let fonts = || dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        let footer = text(
            "F1",
            9.0,
            700.0,
            1060.0,
            Object::string_literal(FOOTER_MARK),
        );
        let toc = [
            vec![flip()],
            text("F1", 11.0, 700.0, 400.0, Object::string_literal("SFT0001")),
            footer.clone(),
        ]
        .concat();
        let body = [
            vec![flip()],
            text("F1", 11.0, 100.0, 200.0, Object::string_literal("SFH0001")),
            footer,
        ]
        .concat();
        build_pdf(&mut doc, vec![(toc, fonts()), (body, fonts())]);
        let path = save_temp(&mut doc, "scrivon-toc-translucent-footer.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("page-n", "#40404040")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        // Each drawn label, and whether the alpha state is in force for it (following q/Q).
        let mut translucent = false;
        let mut saved = Vec::new();
        let mut drawn = Vec::new();
        for op in page_operations(&stamped, 1) {
            match op.operator.as_str() {
                "q" => saved.push(translucent),
                "Q" => translucent = saved.pop().unwrap_or(false),
                "gs" => {
                    translucent = op.operands.first() == Some(&Object::Name(ALPHA_GS_NAME.into()));
                }
                "Tj" => {
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        drawn.push((bytes.clone(), translucent));
                    }
                }
                _ => {}
            }
        }
        assert!(drawn.contains(&(b"Page 1".to_vec(), true)), "{drawn:?}");
        assert!(
            drawn.contains(&(b"2".to_vec(), false)),
            "the toc number took the footer's alpha: {drawn:?}"
        );
    }

    /// Resources whose `/G1` state paints at 1% fill alpha, like the export CSS's markers.
    fn marker_resources() -> Dictionary {
        dictionary! {
            "Font" => dictionary! { "F1" => helvetica() },
            "ExtGState" => dictionary! { "G1" => dictionary! { "ca" => 0.01_f32 } },
        }
    }

    /// A marker drawn nearly transparent, the way the export draws it.
    fn marker_text(size: f32, x: f32, y: f32, mark: &str) -> Vec<Operation> {
        [
            vec![
                Operation::new("q", vec![]),
                Operation::new("gs", vec!["G1".into()]),
            ],
            text("F1", size, x, y, Object::string_literal(mark)),
            vec![Operation::new("Q", vec![])],
        ]
        .concat()
    }

    fn page_operations(doc: &Document, page_number: u32) -> Vec<Operation> {
        let page_id = doc.get_pages()[&page_number];
        Content::decode(&doc.get_page_content(page_id))
            .unwrap()
            .operations
    }

    /// Every string a text operation shows.
    fn shown_strings(operations: &[Operation]) -> Vec<Vec<u8>> {
        let mut strings = Vec::new();
        for operand in operations.iter().flat_map(|op| &op.operands) {
            match operand {
                Object::String(bytes, _) => strings.push(bytes.clone()),
                Object::Array(items) => {
                    for item in items {
                        if let Object::String(bytes, _) = item {
                            strings.push(bytes.clone());
                        }
                    }
                }
                _ => {}
            }
        }
        strings
    }

    #[test]
    fn removes_marker_text_but_keeps_the_document_text() {
        let mut doc = Document::with_version("1.5");
        let footer = || {
            [
                text(
                    "F1",
                    9.0,
                    100.0,
                    1060.0,
                    Object::string_literal("6 November 2026"),
                ),
                marker_text(9.0, 700.0, 1060.0, FOOTER_MARK),
            ]
            .concat()
        };
        let toc = [
            vec![flip()],
            text(
                "F1",
                11.0,
                100.0,
                400.0,
                Object::string_literal("Chapter One"),
            ),
            marker_text(11.0, 700.0, 400.0, "SFT0001"),
        ]
        .concat();
        let chapter = [
            vec![flip()],
            marker_text(1.0, 100.0, 200.0, "SFH0001"),
            text(
                "F1",
                18.0,
                101.0,
                200.0,
                Object::string_literal("Chapter One"),
            ),
            footer(),
        ]
        .concat();
        let body = [vec![flip()], footer()].concat();
        build_pdf(
            &mut doc,
            vec![
                (toc, marker_resources()),
                (chapter, marker_resources()),
                (body, marker_resources()),
            ],
        );
        let path = save_temp(&mut doc, "scrivon-page-numbers-blank.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("n-of-total", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        for page in 1..=3 {
            let text = stamped.extract_text(&[page]).unwrap();
            for mark in [TOC_SLOT_PREFIX, TOC_HEAD_PREFIX, FOOTER_MARK] {
                assert!(
                    !text.contains(mark),
                    "page {page} still reads {mark}: {text:?}"
                );
            }
            let strings = shown_strings(&page_operations(&stamped, page));
            assert!(!strings.iter().any(|s| s.starts_with(b"SF")));
        }
        let toc_text = stamped.extract_text(&[1]).unwrap();
        assert!(toc_text.contains("Chapter One"), "{toc_text:?}");
        assert!(toc_text.contains('2'), "toc shows the heading's page");
        let chapter_text = stamped.extract_text(&[2]).unwrap();
        assert!(chapter_text.contains("Chapter One"), "{chapter_text:?}");
        assert!(chapter_text.contains("6 November 2026"));
        assert!(chapter_text.contains("2 / 3"));
        assert!(stamped.extract_text(&[3]).unwrap().contains("3 / 3"));

        // The TOC number is an artifact too, so it isn't read out of order.
        assert!(page_operations(&stamped, 1).iter().any(|op| {
            op.operator == "BMC" && op.operands.first() == Some(&Object::Name(b"Artifact".to_vec()))
        }));
    }

    #[test]
    fn cutting_a_marker_out_of_a_run_keeps_the_text_after_it_in_place() {
        let mut doc = Document::with_version("1.5");
        let page = [vec![flip()], marker_text(10.0, 100.0, 1000.0, "ab SFPN cd")].concat();
        build_pdf(&mut doc, vec![(page, marker_resources())]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-cut.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("number", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let operations = page_operations(&stamped, 1);
        let cut = operations
            .iter()
            .find(|op| op.operator == "TJ")
            .expect("the marker's run is rewritten as a TJ");
        let Some(Object::Array(parts)) = cut.operands.first() else {
            panic!("TJ without an array: {cut:?}");
        };
        // S, F, P and N are 600 wide in the test font: the gap keeps " cd" where it was.
        assert_eq!(parts.len(), 3, "{parts:?}");
        assert_eq!(parts[0], Object::string_literal("ab "));
        assert!((operand_f32(&parts[1]) + 2400.0).abs() < 0.01);
        assert_eq!(parts[2], Object::string_literal(" cd"));
    }

    #[test]
    fn leaves_document_text_that_spells_a_marker_alone() {
        let mut doc = Document::with_version("1.5");
        let page = [
            vec![flip()],
            text(
                "F1",
                10.0,
                100.0,
                300.0,
                Object::string_literal("Type SFPN here"),
            ),
            marker_text(9.0, 700.0, 1060.0, FOOTER_MARK),
        ]
        .concat();
        let ids = build_pdf(&mut doc, vec![(page, marker_resources())]);
        let expected_right = (700.0 + 4.0 * 0.6 * 9.0) * 0.75;
        let path = save_temp(&mut doc, "scrivon-page-numbers-lookalike.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("page-n", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let text = stamped.extract_text(&[1]).unwrap();
        assert!(text.contains("Type SFPN here"), "{text:?}");
        let (right, _, _) = stamped_label_extent(&stamped, ids[0], "Page 1");
        assert!(
            (right - expected_right).abs() < 0.1,
            "label belongs at the real marker, right was {right}"
        );
    }

    #[test]
    fn never_cuts_document_text_when_no_real_marker_was_drawn() {
        // No page numbers and no TOC, so the export drew no markers at all; the
        // document itself mentions the codes.
        let mut doc = Document::with_version("1.5");
        let page = [
            vec![flip()],
            text(
                "F1",
                10.0,
                100.0,
                300.0,
                Object::string_literal("Codes: SFPN SFT2024 SFH1234"),
            ),
        ]
        .concat();
        let fonts = || dictionary! { "Font" => dictionary! { "F1" => helvetica() } };
        build_pdf(&mut doc, vec![(page, fonts())]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-lookalike-only.pdf");
        let printed = std::fs::read(&path).unwrap();

        stamp_page_numbers(path.to_str().unwrap(), &options("none", "")).unwrap();

        let after = std::fs::read(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(after == printed, "the PDF was rewritten");

        // With numbers on, the look-alike still only places the label: its text stays.
        let mut doc = Document::with_version("1.5");
        let page = [
            vec![flip()],
            text(
                "F1",
                10.0,
                100.0,
                300.0,
                Object::string_literal("Type SFPN here"),
            ),
        ]
        .concat();
        build_pdf(&mut doc, vec![(page, fonts())]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-lookalike-numbered.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("page-n", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let text = stamped.extract_text(&[1]).unwrap();
        assert!(text.contains("Type SFPN here"), "{text:?}");
        assert!(text.contains("Page 1"), "{text:?}");
    }

    #[test]
    fn removes_markers_drawn_with_skia_glyph_ids() {
        let mut doc = Document::with_version("1.5");
        let font = skia_type0(&mut doc);
        let ops = vec![
            flip(),
            Operation::new("gs", vec!["G1".into()]),
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec!["F1".into(), 1.into()]),
            Operation::new(
                "Tm",
                vec![
                    12.into(),
                    0.into(),
                    0.into(),
                    (-12).into(),
                    500.into(),
                    1080.into(),
                ],
            ),
            Operation::new(
                "Tj",
                vec![Object::String(
                    vec![0, 1, 0, 2, 0, 3, 0, 4],
                    lopdf::StringFormat::Hexadecimal,
                )],
            ),
            Operation::new("ET", vec![]),
        ];
        let mut resources = marker_resources();
        resources.set("Font", dictionary! { "F1" => font });
        build_pdf(&mut doc, vec![(ops, resources)]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-skia-blank.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("number", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let strings = shown_strings(&page_operations(&stamped, 1));
        assert!(!strings
            .iter()
            .any(|s| s.as_slice() == [0, 1, 0, 2, 0, 3, 0, 4]));
        assert!(strings.contains(&b"1".to_vec()), "page is still numbered");
    }

    /// Glyphs of the embedded test font: id, the character it draws, advance width.
    const EMBEDDED_GLYPHS: [(u16, char, i64); 10] = [
        (1, 'S', 600),
        (2, 'F', 500),
        (3, 'P', 700),
        (4, 'N', 800),
        (5, '1', 550),
        (6, ' ', 250),
        (7, 'и', 520),
        (8, 'з', 480),
        (9, '2', 550),
        (10, 'ע', 600),
    ];

    /// A Type0 font object the way Chromium embeds one: a subset whose ToUnicode
    /// map lists the glyphs it holds, Cyrillic and Hebrew among them.
    fn embedded_type0(doc: &mut Document) -> ObjectId {
        let chars: String = EMBEDDED_GLYPHS
            .iter()
            .map(|(id, ch, _)| format!("<{id:04X}> <{:04X}>\n", *ch as u32))
            .collect();
        let cmap = format!(
            "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n\
             /CMapName /Adobe-Identity-UCS def\n1 begincodespacerange\n<0000> <FFFF>\n\
             endcodespacerange\n{} beginbfchar\n{chars}endbfchar\nendcmap\n\
             CMapName currentdict /CMap defineresource pop\nend\nend",
            EMBEDDED_GLYPHS.len()
        );
        let cmap_id = doc.add_object(Stream::new(dictionary! {}, cmap.into_bytes()));
        let widths: Vec<Object> = EMBEDDED_GLYPHS
            .iter()
            .map(|(_, _, width)| Object::Integer(*width))
            .collect();
        let descendant_id = doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "CIDFontType2",
            "BaseFont" => "AAAAAA+SegoeUI",
            "DW" => 1000_i64,
            "W" => vec![1.into(), widths.into()],
        });
        doc.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type0",
            "BaseFont" => "AAAAAA+SegoeUI",
            "Encoding" => "Identity-H",
            "DescendantFonts" => vec![descendant_id.into()],
            "ToUnicode" => cmap_id,
        })
    }

    /// Glyph ids as the 2-byte codes an Identity-H font shows.
    fn glyph_codes(ids: &[u16]) -> Vec<u8> {
        ids.iter().flat_map(|id| id.to_be_bytes()).collect()
    }

    /// One page whose footer marker is drawn the way Chromium draws it: in an
    /// embedded font (`F1`), at 9px through Skia's text matrix, nearly transparent.
    /// `extra` is drawn after it.
    fn page_with_embedded_marker(
        doc: &mut Document,
        extra: Vec<Operation>,
    ) -> (ObjectId, ObjectId) {
        let (pages, font_id) = pages_with_embedded_marker(doc, vec![extra]);
        (pages[0], font_id)
    }

    /// One page per entry of `extras`, each built like `page_with_embedded_marker`
    /// and all sharing one embedded font, the way Chromium shares it.
    fn pages_with_embedded_marker(
        doc: &mut Document,
        extras: Vec<Vec<Operation>>,
    ) -> (Vec<ObjectId>, ObjectId) {
        let font_id = embedded_type0(doc);
        let pages = extras
            .into_iter()
            .map(|extra| {
                let mut resources = marker_resources();
                resources.set("Font", dictionary! { "F1" => font_id });
                (embedded_marker_operations(extra), resources)
            })
            .collect();
        (build_pdf(doc, pages), font_id)
    }

    fn embedded_marker_operations(extra: Vec<Operation>) -> Vec<Operation> {
        [
            vec![
                flip(),
                Operation::new("q", vec![]),
                Operation::new("gs", vec!["G1".into()]),
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec!["F1".into(), 1.into()]),
                Operation::new(
                    "Tm",
                    vec![
                        9.into(),
                        0.into(),
                        0.into(),
                        (-9).into(),
                        700.into(),
                        1060.into(),
                    ],
                ),
                Operation::new(
                    "Tj",
                    vec![Object::String(
                        glyph_codes(&[1, 2, 3, 4]),
                        StringFormat::Hexadecimal,
                    )],
                ),
                Operation::new("ET", vec![]),
            ],
            extra,
            vec![Operation::new("Q", vec![])],
        ]
        .concat()
    }

    /// The font, position and shown string of the last label stamped on the page.
    fn last_label(doc: &Document, page: u32) -> (Vec<u8>, f32, Object) {
        let operations = page_operations(doc, page);
        let tf = operations
            .iter()
            .rposition(|op| op.operator == "Tf")
            .unwrap();
        let td = &operations[tf..]
            .iter()
            .find(|op| op.operator == "Td")
            .unwrap()
            .operands;
        let tj = operations[tf..]
            .iter()
            .find(|op| op.operator == "Tj")
            .unwrap();
        (
            operations[tf].operands[0].as_name().unwrap().to_vec(),
            operand_f32(&td[0]),
            tj.operands[0].clone(),
        )
    }

    #[test]
    fn draws_the_label_in_the_markers_embedded_font() {
        let mut doc = Document::with_version("1.5");
        let (_, font_id) = page_with_embedded_marker(&mut doc, vec![]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-embedded-font.pdf");

        stamp_page_numbers(
            path.to_str().unwrap(),
            &options("custom:{{page}} из {{total}}", ""),
        )
        .unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let (font, x, shown) = last_label(&stamped, 1);
        // Glyph ids for "1 из 1", not '?' in Helvetica.
        assert_eq!(
            shown,
            Object::String(glyph_codes(&[5, 6, 7, 8, 6, 5]), StringFormat::Hexadecimal)
        );
        let fonts = own_fonts(&stamped, 1);
        assert_eq!(
            fonts.get(&font).unwrap().as_reference().unwrap(),
            font_id,
            "the label reuses the marker's font"
        );
        assert!(
            !fonts.has(FONT_NAME.as_bytes()),
            "no Helvetica when nothing uses it"
        );
        // The marker ends at (700 + 2.6 × 9) × 0.75 = 542.55 and is 6.75pt tall.
        // "1 из 1" is 2600 units wide: 2.6 × 6.75 = 17.55.
        assert!((x - 525.0).abs() < 0.01, "x was {x}");
        let text = stamped.extract_text(&[1]).unwrap();
        assert!(text.contains("1 из 1"), "{text:?}");
        assert!(
            !text.contains('?') && !text.contains(FOOTER_MARK),
            "{text:?}"
        );
    }

    #[test]
    fn falls_back_to_helvetica_when_the_embedded_font_lacks_a_glyph() {
        let mut doc = Document::with_version("1.5");
        page_with_embedded_marker(&mut doc, vec![]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-embedded-missing.pdf");

        // The subset has no 'o' or 'f'.
        stamp_page_numbers(
            path.to_str().unwrap(),
            &options("custom:{{page}} of {{total}}", ""),
        )
        .unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let (font, _, shown) = last_label(&stamped, 1);
        assert_eq!(font, FONT_NAME.as_bytes());
        assert_eq!(shown, Object::string_literal("1 of 1"));
        assert!(own_fonts(&stamped, 1).has(FONT_NAME.as_bytes()));
    }

    #[test]
    fn draws_every_footer_number_in_helvetica_when_the_font_lacks_one_pages_digits() {
        let mut doc = Document::with_version("1.5");
        // The subset has the 1 and the 2 but not the 3.
        pages_with_embedded_marker(&mut doc, vec![vec![], vec![], vec![]]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-embedded-one-role.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("number", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        for page in 1..=3 {
            let (font, _, shown) = last_label(&stamped, page);
            assert_eq!(font, FONT_NAME.as_bytes(), "page {page}");
            assert_eq!(shown, Object::string_literal(page.to_string()));
        }
    }

    #[test]
    fn draws_every_footer_number_in_the_embedded_font_when_it_has_them_all() {
        let mut doc = Document::with_version("1.5");
        let (_, font_id) = pages_with_embedded_marker(&mut doc, vec![vec![], vec![]]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-embedded-all-pages.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("number", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        for (page, glyph) in [(1, 5), (2, 9)] {
            let (font, _, shown) = last_label(&stamped, page);
            assert_eq!(
                own_fonts(&stamped, page)
                    .get(&font)
                    .unwrap()
                    .as_reference()
                    .unwrap(),
                font_id,
                "page {page}"
            );
            assert_eq!(
                shown,
                Object::String(glyph_codes(&[glyph]), StringFormat::Hexadecimal)
            );
        }
    }

    #[test]
    fn leaves_text_that_needs_shaping_to_the_helvetica_path() {
        let mut doc = Document::with_version("1.5");
        let font_id = embedded_type0(&mut doc);
        let font = font_info(&doc, doc.get_dictionary(font_id).unwrap());
        let (codes, width) = embedded_label(&font, "12 из 21").unwrap();
        assert_eq!(codes, glyph_codes(&[5, 9, 6, 7, 8, 6, 9, 5]));
        assert!((width - 3700.0).abs() < 0.01, "width was {width}");
        // The font has the Hebrew letter, but one glyph per character, left to
        // right, would print the words backwards.
        assert_eq!(embedded_label(&font, "1 ע 2"), None);
        assert_eq!(embedded_label(&font, ""), None);
    }

    #[test]
    fn cuts_the_glyph_samples_out_of_the_page_text() {
        let mut doc = Document::with_version("1.5");
        // The export's hidden sample: the label's characters at 1px, nearly transparent.
        let sample = vec![
            Operation::new("BT", vec![]),
            Operation::new("Tf", vec!["F1".into(), 1.into()]),
            Operation::new(
                "Tm",
                vec![
                    1.into(),
                    0.into(),
                    0.into(),
                    (-1).into(),
                    690.into(),
                    1060.into(),
                ],
            ),
            Operation::new(
                "Tj",
                vec![Object::String(
                    glyph_codes(&[5, 9, 6, 7, 8]),
                    StringFormat::Hexadecimal,
                )],
            ),
            Operation::new("ET", vec![]),
        ];
        page_with_embedded_marker(&mut doc, sample);
        let path = save_temp(&mut doc, "scrivon-page-numbers-glyph-sample.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("number", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let strings = shown_strings(&page_operations(&stamped, 1));
        assert!(
            !strings
                .iter()
                .any(|s| s.as_slice() == glyph_codes(&[5, 9, 6, 7, 8])),
            "{strings:?}"
        );
        let text = stamped.extract_text(&[1]).unwrap();
        assert!(!text.contains("из"), "{text:?}");
        let (_, _, shown) = last_label(&stamped, 1);
        assert_eq!(
            shown,
            Object::String(glyph_codes(&[5]), StringFormat::Hexadecimal)
        );
    }

    #[test]
    fn removes_markers_drawn_inside_form_xobjects() {
        let mut doc = Document::with_version("1.5");
        let inner = Content {
            operations: text(
                "F1",
                10.0,
                400.0,
                1000.0,
                Object::string_literal(FOOTER_MARK),
            ),
        };
        let form_id = doc.add_object(Stream::new(
            dictionary! {
                "Type" => "XObject",
                "Subtype" => "Form",
                "BBox" => vec![0.into(), 0.into(), 1000.into(), 1200.into()],
                "Resources" => dictionary! { "Font" => dictionary! { "F1" => helvetica() } },
            },
            inner.encode().unwrap(),
        ));
        // The form inherits the nearly transparent fill the page sets before drawing it.
        let ops = vec![
            flip(),
            Operation::new("gs", vec!["G1".into()]),
            Operation::new("Do", vec!["X1".into()]),
        ];
        let mut resources = marker_resources();
        resources.set("XObject", dictionary! { "X1" => form_id });
        build_pdf(&mut doc, vec![(ops, resources)]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-form-blank.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("number", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let form = stamped.get_object(form_id).unwrap().as_stream().unwrap();
        let form_ops =
            Content::decode(&form.decompressed_content().unwrap_or(form.content.clone()))
                .unwrap()
                .operations;
        assert!(!shown_strings(&form_ops).contains(&FOOTER_MARK.as_bytes().to_vec()));
        assert!(stamped.extract_text(&[1]).unwrap().contains('1'));
    }

    #[test]
    fn footer_labels_are_marked_as_pagination_artifacts() {
        let mut doc = Document::with_version("1.5");
        let page = [vec![flip()], marker_text(9.0, 700.0, 1060.0, FOOTER_MARK)].concat();
        build_pdf(&mut doc, vec![(page, marker_resources())]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-artifact.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("page-n", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let operations = page_operations(&stamped, 1);
        let begin = operations
            .iter()
            .position(|op| {
                op.operator == "BDC"
                    && op.operands.first() == Some(&Object::Name(b"Artifact".to_vec()))
            })
            .expect("label opens an artifact");
        let label = operations
            .iter()
            .position(|op| {
                op.operator == "Tj"
                    && op.operands.first() == Some(&Object::string_literal("Page 1"))
            })
            .expect("label is drawn");
        let end = operations
            .iter()
            .rposition(|op| op.operator == "EMC")
            .expect("artifact is closed");
        assert!(begin < label && label < end);
        let properties = operations[begin].operands[1].as_dict().unwrap();
        assert_eq!(
            properties.get(b"Type").unwrap().as_name().unwrap(),
            b"Pagination"
        );
    }

    /// Like `build_pdf`, but the `/Pages` node carries `inherited` (attributes
    /// its pages inherit) and each page dict only has the entries given.
    fn build_tree(
        doc: &mut Document,
        inherited: Dictionary,
        pages: Vec<(Vec<Operation>, Dictionary)>,
    ) -> Vec<ObjectId> {
        let pages_id = doc.new_object_id();
        let mut kids = Vec::new();
        let mut ids = Vec::new();
        for (operations, mut page) in pages {
            let content_id = doc.add_object(Stream::new(
                dictionary! {},
                Content { operations }.encode().unwrap(),
            ));
            page.set("Type", "Page");
            page.set("Parent", pages_id);
            page.set("Contents", content_id);
            let page_id = doc.add_object(page);
            kids.push(page_id.into());
            ids.push(page_id);
        }
        let mut node = inherited;
        node.set("Type", "Pages");
        node.set("Count", kids.len() as i64);
        node.set("Kids", kids);
        doc.objects.insert(pages_id, Object::Dictionary(node));
        let catalog_id = doc.add_object(dictionary! { "Type" => "Catalog", "Pages" => pages_id });
        doc.trailer.set("Root", catalog_id);
        ids
    }

    fn a4() -> Object {
        vec![0.into(), 0.into(), 595.into(), 842.into()].into()
    }

    fn body_text() -> Vec<Operation> {
        [
            vec![flip()],
            text("F1", 10.0, 100.0, 300.0, Object::string_literal("Body")),
        ]
        .concat()
    }

    /// The fonts listed in the page's own `/Resources`.
    fn own_fonts(doc: &Document, page_number: u32) -> Dictionary {
        let page = doc.get_dictionary(doc.get_pages()[&page_number]).unwrap();
        let resources = match page.get(b"Resources").unwrap() {
            Object::Reference(id) => doc.get_dictionary(*id).unwrap(),
            other => other.as_dict().unwrap(),
        };
        match resources.get(b"Font").unwrap() {
            Object::Reference(id) => doc.get_dictionary(*id).unwrap().clone(),
            other => other.as_dict().unwrap().clone(),
        }
    }

    #[test]
    fn keeps_the_fonts_a_page_inherits_from_the_page_tree() {
        let mut doc = Document::with_version("1.5");
        build_tree(
            &mut doc,
            dictionary! { "Resources" => dictionary! { "Font" => dictionary! { "F1" => helvetica() } } },
            vec![(body_text(), dictionary! { "MediaBox" => a4() })],
        );
        let path = save_temp(&mut doc, "scrivon-page-numbers-inherited-resources.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("page-n", "#ff000080")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        let fonts = own_fonts(&stamped, 1);
        assert!(fonts.has(b"F1"), "the page lost the font its text uses");
        assert!(fonts.has(FONT_NAME.as_bytes()));
        let text = stamped.extract_text(&[1]).unwrap();
        assert!(text.contains("Body") && text.contains("Page 1"), "{text}");
    }

    #[test]
    fn adds_to_a_shared_font_dictionary_without_dropping_its_fonts() {
        let mut doc = Document::with_version("1.5");
        let shared_fonts = doc.add_object(dictionary! { "F1" => helvetica() });
        build_pdf(
            &mut doc,
            vec![
                (body_text(), dictionary! { "Font" => shared_fonts }),
                (body_text(), dictionary! { "Font" => shared_fonts }),
            ],
        );
        let path = save_temp(&mut doc, "scrivon-page-numbers-shared-fonts.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("page-n", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        for page in [1, 2] {
            let fonts = own_fonts(&stamped, page);
            assert!(fonts.has(b"F1"), "page {page} lost the font its text uses");
            assert!(fonts.has(FONT_NAME.as_bytes()));
            assert!(stamped.extract_text(&[page]).unwrap().contains("Body"));
        }
    }

    #[test]
    fn numbers_pages_that_inherit_their_media_box() {
        let mut doc = Document::with_version("1.5");
        build_tree(
            &mut doc,
            dictionary! { "MediaBox" => a4() },
            vec![(
                body_text(),
                dictionary! { "Resources" => dictionary! { "Font" => dictionary! { "F1" => helvetica() } } },
            )],
        );
        let path = save_temp(&mut doc, "scrivon-page-numbers-inherited-media-box.pdf");

        stamp_page_numbers(path.to_str().unwrap(), &options("page-n", "")).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(stamped.extract_text(&[1]).unwrap().contains("Page 1"));
    }

    fn heading(level: u8, text: &str) -> PdfHeading {
        PdfHeading {
            level,
            text: text.into(),
        }
    }

    /// A page drawing the given heading marks, each at its y (in Chromium's flipped space).
    fn marked_page(marks: &[(&str, f32)]) -> (Vec<Operation>, Dictionary) {
        let mut ops = vec![flip()];
        for (mark, y) in marks {
            ops.extend(marker_text(1.0, 100.0, *y, mark));
        }
        (ops, marker_resources())
    }

    /// Stamps `pages` with `options` and gives back the numbered PDF.
    fn stamp_pages(
        name: &str,
        pages: Vec<(Vec<Operation>, Dictionary)>,
        options: &PdfPrintOptions,
    ) -> Document {
        let mut doc = Document::with_version("1.5");
        build_pdf(&mut doc, pages);
        let path = save_temp(&mut doc, name);
        let result = stamp_page_numbers(path.to_str().unwrap(), options);
        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        result.unwrap();
        stamped
    }

    /// The outline item at `id` and its siblings after it.
    fn outline_items(doc: &Document, first: Option<ObjectId>) -> Vec<&Dictionary> {
        let mut items = Vec::new();
        let mut next = first;
        while let Some(id) = next {
            let item = doc.get_dictionary(id).unwrap();
            items.push(item);
            next = item.get(b"Next").and_then(Object::as_reference).ok();
        }
        items
    }

    fn outline_root(doc: &Document) -> Option<&Dictionary> {
        let id = doc
            .catalog()
            .ok()?
            .get(b"Outlines")
            .and_then(Object::as_reference)
            .ok()?;
        doc.get_dictionary(id).ok()
    }

    /// Every bookmark as (depth, title, page number), in reading order.
    fn bookmarks(doc: &Document) -> Vec<(usize, String, u32)> {
        let page_numbers: HashMap<ObjectId, u32> =
            doc.get_pages().into_iter().map(|(n, id)| (id, n)).collect();
        let mut found = Vec::new();
        let mut stack: Vec<(usize, &Dictionary)> = outline_root(doc)
            .map(|root| {
                outline_items(doc, root.get(b"First").and_then(Object::as_reference).ok())
                    .into_iter()
                    .rev()
                    .map(|item| (0, item))
                    .collect()
            })
            .unwrap_or_default();
        while let Some((depth, item)) = stack.pop() {
            let title = lopdf::decode_text_string(item.get(b"Title").unwrap()).unwrap();
            let dest = item.get(b"Dest").unwrap().as_array().unwrap();
            found.push((depth, title, page_numbers[&dest[0].as_reference().unwrap()]));
            let children =
                outline_items(doc, item.get(b"First").and_then(Object::as_reference).ok());
            stack.extend(children.into_iter().rev().map(|child| (depth + 1, child)));
        }
        found
    }

    #[test]
    fn adds_bookmarks_nested_by_heading_level() {
        let mut with_headings = options("none", "");
        with_headings.headings = vec![
            heading(1, "Intro"),
            heading(2, "Setup"),
            heading(2, "Usage"),
            heading(1, "Zoë's end"),
        ];

        let stamped = stamp_pages(
            "scrivon-bookmarks-nested.pdf",
            vec![
                marked_page(&[("SFH0001", 200.0)]),
                marked_page(&[("SFH0002", 200.0), ("SFH0003", 600.0)]),
                marked_page(&[("SFH0004", 300.0)]),
            ],
            &with_headings,
        );

        assert_eq!(
            bookmarks(&stamped),
            vec![
                (0, "Intro".to_string(), 1),
                (1, "Setup".to_string(), 2),
                (1, "Usage".to_string(), 2),
                (0, "Zoë's end".to_string(), 3),
            ]
        );
        // Every bookmark starts open, so the root counts all of them.
        let root = outline_root(&stamped).unwrap();
        assert_eq!(root.get(b"Count").unwrap().as_i64().unwrap(), 4);
        let intro = outline_items(
            &stamped,
            root.get(b"First").and_then(Object::as_reference).ok(),
        )[0];
        assert_eq!(intro.get(b"Count").unwrap().as_i64().unwrap(), 2);
        // The marks themselves are cut out of the page text.
        assert!(!stamped.extract_text(&[2]).unwrap().contains("SFH"));
    }

    #[test]
    fn a_bookmark_opens_its_page_just_above_the_heading() {
        let mut with_headings = options("none", "");
        with_headings.headings = vec![heading(2, "Usage")];

        let stamped = stamp_pages(
            "scrivon-bookmarks-position.pdf",
            vec![marked_page(&[("SFH0001", 600.0)])],
            &with_headings,
        );

        let root = outline_root(&stamped).unwrap();
        let usage = outline_items(
            &stamped,
            root.get(b"First").and_then(Object::as_reference).ok(),
        )[0];
        let dest = usage.get(b"Dest").unwrap().as_array().unwrap();
        assert_eq!(dest[1], Object::Name(b"XYZ".to_vec()));
        // The mark's baseline: 842 - 0.75 × 600 = 392. The view starts a little above it.
        let top = operand_f32(&dest[3]);
        assert!(
            (392.0..=842.0).contains(&top) && top > 400.0,
            "top was {top}"
        );
        assert_eq!(dest[2], Object::Null, "keeps the reader's left edge");
        assert_eq!(dest[4], Object::Null, "keeps the reader's zoom");
    }

    #[test]
    fn leaves_out_bookmarks_whose_heading_was_not_found() {
        let mut with_headings = options("none", "");
        // B's mark is missing, so C moves up under A. D skips a level and still nests under C.
        with_headings.headings = vec![
            heading(1, "A"),
            heading(2, "B"),
            heading(3, "C"),
            heading(5, "D"),
            heading(2, "E"),
        ];

        let stamped = stamp_pages(
            "scrivon-bookmarks-missing.pdf",
            vec![marked_page(&[
                ("SFH0001", 100.0),
                ("SFH0003", 200.0),
                ("SFH0004", 300.0),
                ("SFH0005", 400.0),
            ])],
            &with_headings,
        );

        assert_eq!(
            bookmarks(&stamped),
            vec![
                (0, "A".to_string(), 1),
                (1, "C".to_string(), 1),
                (2, "D".to_string(), 1),
                (1, "E".to_string(), 1),
            ]
        );
    }

    #[test]
    fn adds_no_bookmarks_without_headings() {
        let stamped = stamp_pages(
            "scrivon-bookmarks-none.pdf",
            vec![marked_page(&[("SFH0001", 100.0)])],
            &options("none", ""),
        );
        assert!(outline_root(&stamped).is_none());
    }

    /// A page with the given marks, each drawn the way the export draws it, at its y.
    fn page_with(marks: &[(&str, f32)]) -> (Vec<Operation>, Dictionary) {
        let mut ops = vec![flip()];
        for (mark, y) in marks {
            let size = if *mark == FOOTER_MARK { 9.0 } else { 1.0 };
            ops.extend(marker_text(size, 700.0, *y, mark));
        }
        (ops, marker_resources())
    }

    fn from_body(format: &str) -> PdfPrintOptions {
        let mut numbered = options(format, "");
        numbered.number_from_body = true;
        numbered
    }

    #[test]
    fn numbers_pages_from_the_first_body_page() {
        // A title page without a footer, a contents page that shows it, then the body.
        let stamped = stamp_pages(
            "scrivon-number-from-body.pdf",
            vec![
                page_with(&[]),
                page_with(&[(FOOTER_MARK, 1060.0)]),
                page_with(&[(BODY_MARK, 100.0), (FOOTER_MARK, 1060.0)]),
                page_with(&[(FOOTER_MARK, 1060.0)]),
            ],
            &from_body("n-of-total"),
        );

        assert!(stamped.extract_text(&[1]).unwrap().trim().is_empty());
        assert!(
            stamped.extract_text(&[2]).unwrap().trim().is_empty(),
            "the contents page must not be numbered"
        );
        assert!(stamped.extract_text(&[3]).unwrap().contains("1 / 2"));
        assert!(stamped.extract_text(&[4]).unwrap().contains("2 / 2"));
    }

    #[test]
    fn numbers_the_contents_from_the_first_body_page() {
        let stamped = stamp_pages(
            "scrivon-number-toc-from-body.pdf",
            vec![
                page_with(&[("SFT0001", 300.0), ("SFT0002", 400.0)]),
                page_with(&[(BODY_MARK, 100.0), ("SFH0001", 100.0)]),
                page_with(&[("SFH0002", 100.0)]),
            ],
            &from_body("none"),
        );

        let labels = shown_strings(&page_operations(&stamped, 1));
        assert!(labels.contains(&b"1".to_vec()), "{labels:?}");
        assert!(labels.contains(&b"2".to_vec()), "{labels:?}");
        assert!(!labels.contains(&b"3".to_vec()), "{labels:?}");
    }

    #[test]
    fn numbers_every_page_when_the_body_start_was_not_found() {
        let stamped = stamp_pages(
            "scrivon-number-from-body-unmarked.pdf",
            vec![
                page_with(&[(FOOTER_MARK, 1060.0)]),
                page_with(&[(FOOTER_MARK, 1060.0)]),
            ],
            &from_body("page-n"),
        );

        assert!(stamped.extract_text(&[1]).unwrap().contains("Page 1"));
        assert!(stamped.extract_text(&[2]).unwrap().contains("Page 2"));
    }

    #[test]
    fn counts_the_front_pages_unless_numbering_from_the_body() {
        let stamped = stamp_pages(
            "scrivon-number-from-first-page.pdf",
            vec![
                page_with(&[(FOOTER_MARK, 1060.0)]),
                page_with(&[(BODY_MARK, 100.0), (FOOTER_MARK, 1060.0)]),
            ],
            &options("n-of-total", ""),
        );

        assert!(stamped.extract_text(&[1]).unwrap().contains("1 / 2"));
        assert!(stamped.extract_text(&[2]).unwrap().contains("2 / 2"));
        // The body mark is cut out either way.
        assert!(!stamped.extract_text(&[2]).unwrap().contains("SFH"));
    }

    /// Device-space right edge, baseline and flip state of the stamped label on a page.
    fn stamped_label_extent(doc: &Document, page_id: ObjectId, label: &str) -> (f32, f32, bool) {
        let bytes = doc.get_page_content(page_id);
        let content = Content::decode(&bytes).unwrap();
        let mut ctm = Matrix::IDENTITY;
        let mut stack = Vec::new();
        let mut tm = Matrix::IDENTITY;
        let mut size = 0.0;
        let mut result = None;
        for op in content.operations {
            match op.operator.as_str() {
                "q" => stack.push(ctm),
                "Q" => ctm = stack.pop().unwrap_or(ctm),
                "cm" => ctm = Matrix::from_operands(&op.operands).unwrap().then(ctm),
                "BT" => tm = Matrix::IDENTITY,
                "Tf" => size = operand_f32(&op.operands[1]),
                "Td" => {
                    tm = Matrix::translate(
                        operand_f32(&op.operands[0]),
                        operand_f32(&op.operands[1]),
                    )
                    .then(tm)
                }
                "Tm" => tm = Matrix::from_operands(&op.operands).unwrap(),
                "Tj" => {
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if *bytes == win_ansi_bytes(label) {
                            let trm = tm.then(ctm);
                            let end = trm.apply(label_width(label, size), 0.0);
                            result = Some((end.0, trm.apply(0.0, 0.0).1, trm.d < 0.0));
                        }
                    }
                }
                _ => {}
            }
        }
        result.expect("stamped label not found")
    }
}
