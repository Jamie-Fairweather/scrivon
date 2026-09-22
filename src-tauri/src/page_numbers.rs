//! Stamps real page numbers into a PrintToPdf output.
//!
//! WebView2 never resolves CSS `counter(page)`, so the export HTML renders an
//! (almost) invisible marker text inside the footer's page-number slot instead.
//! After printing we locate that marker on every page, which tells us both
//! *whether* the footer was drawn on that page (title/TOC pages hide it) and
//! *exactly where* the number belongs, then draw the label right-aligned to it.

use std::collections::{BTreeMap, HashMap};

use lopdf::content::{Content, Operation};
use lopdf::{dictionary, Dictionary, Document, Encoding, Object, ObjectId, Stream, StringFormat};

pub const FOOTER_MARK: &str = "SFPN";

const FONT_NAME: &str = "ScrivonPN";
const FALLBACK_FONT_SIZE: f32 = 9.0;
const FALLBACK_PAD_PT: f32 = 6.0;
const FALLBACK_BASELINE_OFFSET_PT: f32 = 8.0;
const MAX_XOBJECT_DEPTH: usize = 4;

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

/// Matches the `#404040` chrome text colour in the export CSS.
const DEFAULT_LABEL_RGB: (f32, f32, f32) = (0.25, 0.25, 0.25);

/// `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha ignored) → PDF `rg` components.
pub fn parse_hex_color(value: &str) -> Option<(f32, f32, f32)> {
    let hex = value.trim().strip_prefix('#')?;
    let digits: Vec<u32> = hex.chars().map(|c| c.to_digit(16)).collect::<Option<_>>()?;
    let (r, g, b) = match digits.len() {
        3 | 4 => (digits[0] * 17, digits[1] * 17, digits[2] * 17),
        6 | 8 => (
            digits[0] * 16 + digits[1],
            digits[2] * 16 + digits[3],
            digits[4] * 16 + digits[5],
        ),
        _ => return None,
    };
    Some((r as f32 / 255.0, g as f32 / 255.0, b as f32 / 255.0))
}

/// Helvetica advance widths (per 1000 em) from the standard AFM metrics.
fn helvetica_width(ch: char) -> f32 {
    match ch {
        ' ' | '!' | ',' | '.' | '/' | ':' | ';' | 'I' | '[' | '\\' | ']' | 'f' | 't' => 278.0,
        '"' => 355.0,
        '#' | '$' | '?' | '_' | 'L' | 'a' | 'b' | 'd' | 'e' | 'g' | 'h' | 'n' | 'o' | 'p' | 'q'
        | 'u' | '0'..='9' => 556.0,
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

#[derive(Clone, Copy, Debug)]
pub struct FooterSlot {
    /// Right edge of the page-number slot, in page space.
    pub right: f32,
    /// Text baseline of the footer text, in page space.
    pub baseline: f32,
    /// Footer font size as rendered on the page.
    pub font_size: f32,
}

struct Run {
    text: String,
    start: (f32, f32),
    end: (f32, f32),
    font_size: f32,
}

struct TextState {
    font: Option<FontSlot>,
    size: f32,
    leading: f32,
    tm: Matrix,
    tlm: Matrix,
}

fn slot_span(runs: &[Run], mark_start: usize, mark_end: usize) -> Option<FooterSlot> {
    let mut offset = 0;
    let mut first = None;
    let mut last = None;
    for run in runs {
        let run_end = offset + run.text.len();
        if first.is_none() && run_end > mark_start {
            first = Some(run);
        }
        if run_end >= mark_end {
            last = Some(run);
            break;
        }
        offset = run_end;
    }
    let (first, last) = (first?, last?);
    Some(FooterSlot {
        right: last.end.0,
        baseline: first.start.1,
        font_size: first.font_size,
    })
}

fn find_marker_in_runs(runs: &[Run]) -> Option<FooterSlot> {
    let joined: String = runs.iter().map(|run| run.text.as_str()).collect();
    let mark_start = joined.find(FOOTER_MARK)?;
    slot_span(runs, mark_start, mark_start + FOOTER_MARK.len())
}

const TOC_SLOT_PREFIX: &str = "SFT";
const TOC_HEAD_PREFIX: &str = "SFH";
const TOC_ID_DIGITS: usize = 4;

/// `SFT0001` / `SFH0001` tokens inside one text block, paired by their four digits.
fn find_toc_tokens(runs: &[Run]) -> Vec<(String, FooterSlot)> {
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
                if let Some(slot) = slot_span(runs, start, after + TOC_ID_DIGITS) {
                    hits.push((format!("{prefix}{digits}"), slot));
                }
            }
            from = start + prefix.len();
        }
    }
    hits
}

struct Walked {
    footer: Option<FooterSlot>,
    marks: Vec<(String, FooterSlot)>,
}

fn show_text(
    state: &mut TextState,
    fonts: &PageFonts<'_>,
    cache: &FontCache<'_>,
    ctm: Matrix,
    operands: &[Object],
    runs: &mut Vec<Run>,
) {
    let Some(font) = state.font.and_then(|slot| fonts.resolve(slot, cache)) else {
        return;
    };
    let trm = state.tm.then(ctm);
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
    });
}

fn walk_content(
    doc: &Document,
    cache: &FontCache<'_>,
    bytes: &[u8],
    base_ctm: Matrix,
    resources: Option<&Dictionary>,
    depth: usize,
) -> Walked {
    let Some(content) = Content::decode(bytes).ok() else {
        return Walked {
            footer: None,
            marks: Vec::new(),
        };
    };
    let fonts = page_fonts(doc, cache, resources);

    let mut ctm = base_ctm;
    let mut stack = Vec::new();
    let mut state = TextState {
        font: None,
        size: 0.0,
        leading: 0.0,
        tm: Matrix::IDENTITY,
        tlm: Matrix::IDENTITY,
    };
    let mut runs: Vec<Run> = Vec::new();
    let mut found = Walked {
        footer: None,
        marks: Vec::new(),
    };

    for op in &content.operations {
        match op.operator.as_str() {
            "q" => stack.push(ctm),
            "Q" => {
                if let Some(saved) = stack.pop() {
                    ctm = saved;
                }
            }
            "cm" => {
                if let Some(m) = Matrix::from_operands(&op.operands) {
                    ctm = m.then(ctm);
                }
            }
            "BT" => {
                state.tm = Matrix::IDENTITY;
                state.tlm = Matrix::IDENTITY;
                runs.clear();
            }
            "ET" => {
                if found.footer.is_none() {
                    found.footer = find_marker_in_runs(&runs);
                }
                found.marks.extend(find_toc_tokens(&runs));
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
            "Tj" | "TJ" => show_text(&mut state, &fonts, cache, ctm, &op.operands, &mut runs),
            "'" | "\"" => {
                state.tlm = Matrix::translate(0.0, -state.leading).then(state.tlm);
                state.tm = state.tlm;
                let text_operand = op.operands.last().into_iter().cloned().collect::<Vec<_>>();
                show_text(&mut state, &fonts, cache, ctm, &text_operand, &mut runs);
            }
            "Do" if depth < MAX_XOBJECT_DEPTH => {
                let inner = walk_xobject(doc, cache, op, ctm, resources, depth);
                if found.footer.is_none() {
                    found.footer = inner.footer;
                }
                found.marks.extend(inner.marks);
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
    ctm: Matrix,
    resources: Option<&Dictionary>,
    depth: usize,
) -> Walked {
    let empty = Walked {
        footer: None,
        marks: Vec::new(),
    };
    let Some(name) = op.operands.first().and_then(|o| o.as_name().ok()) else {
        return empty;
    };
    let Some(xobjects) = resources
        .and_then(|r| r.get_deref(b"XObject", doc).ok())
        .and_then(|o| o.as_dict().ok())
    else {
        return empty;
    };
    let Some(stream) = xobjects
        .get(name)
        .ok()
        .map(|o| deref(doc, o))
        .and_then(|o| o.as_stream().ok())
    else {
        return empty;
    };
    if stream.dict.get(b"Subtype").and_then(Object::as_name).ok() != Some(b"Form") {
        return empty;
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
        matrix.then(ctm),
        inner_resources.or(resources),
        depth + 1,
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
    let Ok(bytes) = doc.get_page_content(page_id) else {
        return Walked {
            footer: None,
            marks: Vec::new(),
        };
    };
    walk_content(
        doc,
        cache,
        &bytes,
        Matrix::IDENTITY,
        page_resources(doc, page_id),
        0,
    )
}

/// Finds the page-number slot marker on a page, if the footer was drawn there.
pub fn footer_slot(doc: &Document, page_id: ObjectId) -> Option<FooterSlot> {
    let cache = cache_for_pages(doc, &[page_id]);
    scan_page(doc, &cache, page_id).footer
}

fn page_marks(doc: &Document, page_id: ObjectId) -> Vec<(String, FooterSlot)> {
    let cache = cache_for_pages(doc, &[page_id]);
    scan_page(doc, &cache, page_id).marks
}

// ---------------------------------------------------------------------------
// Stamping
// ---------------------------------------------------------------------------

fn page_media_box(doc: &Document, page_id: ObjectId) -> Result<(f32, f32), String> {
    let page = doc
        .get_object(page_id)
        .and_then(Object::as_dict)
        .map_err(|e| e.to_string())?;
    let box_obj = page
        .get(b"MediaBox")
        .or_else(|_| page.get(b"CropBox"))
        .map_err(|e| e.to_string())?;
    let values = match deref(doc, box_obj) {
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

fn ensure_page_font(
    doc: &mut Document,
    page_id: ObjectId,
    font_id: ObjectId,
) -> Result<(), String> {
    let resource_ref = {
        let page = doc.get_object(page_id).map_err(|e| e.to_string())?;
        let dict = page.as_dict().map_err(|e| e.to_string())?;
        dict.get(b"Resources")
            .ok()
            .and_then(|obj| obj.as_reference().ok())
    };

    if let Some(id) = resource_ref {
        let resources_obj = doc.get_object_mut(id).map_err(|e| e.to_string())?;
        let resources_dict = resources_obj.as_dict_mut().map_err(|e| e.to_string())?;
        insert_font(resources_dict, font_id);
        return Ok(());
    }

    let page = doc.get_object_mut(page_id).map_err(|e| e.to_string())?;
    let dict = page.as_dict_mut().map_err(|e| e.to_string())?;
    if dict.get(b"Resources").is_err() {
        dict.set("Resources", dictionary! {});
    }
    let resources_dict = dict
        .get_mut(b"Resources")
        .map_err(|e| e.to_string())?
        .as_dict_mut()
        .map_err(|e| e.to_string())?;
    insert_font(resources_dict, font_id);
    Ok(())
}

fn insert_font(resources: &mut Dictionary, font_id: ObjectId) {
    match resources.get_mut(b"Font") {
        Ok(Object::Dictionary(fonts)) => {
            fonts.set(FONT_NAME, font_id);
        }
        _ => {
            resources.set("Font", dictionary! { FONT_NAME => font_id });
        }
    }
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

fn label_operations(
    label: &str,
    right: f32,
    baseline: f32,
    font_size: f32,
    rgb: (f32, f32, f32),
) -> Vec<Operation> {
    let x = right - label_width(label, font_size);
    vec![
        Operation::new("BT", vec![]),
        Operation::new("Tf", vec![FONT_NAME.into(), font_size.into()]),
        Operation::new("rg", vec![rgb.0.into(), rgb.1.into(), rgb.2.into()]),
        Operation::new("Td", vec![x.into(), baseline.into()]),
        Operation::new(
            "Tj",
            vec![Object::String(win_ansi_bytes(label), StringFormat::Literal)],
        ),
        Operation::new("ET", vec![]),
    ]
}

struct TocEntry {
    page_id: ObjectId,
    slot: FooterSlot,
    label: String,
}

/// TOC rows whose heading mark was found, labelled with that heading's page.
fn toc_entries(pages: &[(u32, ObjectId)], scans: &[Walked]) -> Vec<TocEntry> {
    let mut slots = Vec::new();
    let mut heading_pages: BTreeMap<String, u32> = BTreeMap::new();
    for ((index, page_id), scan) in pages.iter().zip(scans) {
        for (token, slot) in &scan.marks {
            if let Some(id) = token.strip_prefix(TOC_SLOT_PREFIX) {
                slots.push((id.to_string(), *page_id, *slot));
            } else if let Some(id) = token.strip_prefix(TOC_HEAD_PREFIX) {
                heading_pages.entry(id.to_string()).or_insert(*index);
            }
        }
    }
    slots
        .into_iter()
        .filter_map(|(id, page_id, slot)| {
            heading_pages.get(&id).map(|page| TocEntry {
                page_id,
                slot,
                label: page.to_string(),
            })
        })
        .collect()
}

pub fn stamp_page_numbers(
    path: &str,
    format: &str,
    color: &str,
    margin_right_mm: f64,
    margin_bottom_mm: f64,
) -> Result<(), String> {
    let want_footer = format_page_label(format, 1, 1).is_some();
    let footer_rgb = parse_hex_color(color).unwrap_or(DEFAULT_LABEL_RGB);

    let mut doc =
        Document::load(path).map_err(|e| format!("Could not open PDF to number pages: {e}"))?;
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    let total = pages.len() as u32;
    if total == 0 {
        return Ok(());
    }

    let cache = cache_for_pages(&doc, &pages.iter().map(|(_, id)| *id).collect::<Vec<_>>());
    let scans: Vec<Walked> = pages
        .iter()
        .map(|(_, id)| scan_page(&doc, &cache, *id))
        .collect();
    let toc = toc_entries(&pages, &scans);
    if !want_footer && toc.is_empty() {
        return Ok(());
    }

    let any_footer = scans.iter().any(|scan| scan.footer.is_some());

    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
        "Encoding" => "WinAnsiEncoding",
    });

    let mut operations = vec![Vec::new(); pages.len()];
    if want_footer {
        for (position, ((page_index, page_id), scan)) in pages.iter().zip(&scans).enumerate() {
            let Some(label) = format_page_label(format, *page_index, total) else {
                continue;
            };
            let (right, baseline, font_size) = match scan.footer {
                Some(slot) => (slot.right, slot.baseline, slot.font_size.clamp(6.0, 24.0)),
                // The footer was hidden on this page (title / TOC): no number.
                None if any_footer => continue,
                // No footer markers anywhere: number every page inside the bottom margin.
                None => {
                    let (width, _) = page_media_box(&doc, *page_id)?;
                    (
                        width - mm_to_pt(margin_right_mm) - FALLBACK_PAD_PT,
                        mm_to_pt(margin_bottom_mm) + FALLBACK_BASELINE_OFFSET_PT,
                        FALLBACK_FONT_SIZE,
                    )
                }
            };
            operations[position].extend(label_operations(
                &label, right, baseline, font_size, footer_rgb,
            ));
        }
    }
    let page_at: HashMap<ObjectId, usize> = pages
        .iter()
        .enumerate()
        .map(|(position, (_, id))| (*id, position))
        .collect();
    for entry in toc {
        let Some(position) = page_at.get(&entry.page_id).copied() else {
            continue;
        };
        operations[position].extend(label_operations(
            &entry.label,
            entry.slot.right,
            entry.slot.baseline,
            entry.slot.font_size.clamp(6.0, 24.0),
            DEFAULT_LABEL_RGB,
        ));
    }

    for (position, page_ops) in operations.into_iter().enumerate() {
        if page_ops.is_empty() {
            continue;
        }
        let page_id = pages[position].1;
        ensure_page_font(&mut doc, page_id, font_id)?;
        let content = Content {
            operations: page_ops,
        };
        overlay_page_content(
            &mut doc,
            page_id,
            content.encode().map_err(|e| e.to_string())?,
        )?;
    }

    doc.save(path)
        .map_err(|e| format!("Could not save numbered PDF: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CHROMIUM_FLIP: [f32; 6] = [0.75, 0.0, 0.0, -0.75, 0.0, 842.0];

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
        assert_eq!(parse_hex_color("#ffffff"), Some((1.0, 1.0, 1.0)));
        assert_eq!(parse_hex_color(" #FFF "), Some((1.0, 1.0, 1.0)));
        assert_eq!(parse_hex_color("#00000080"), Some((0.0, 0.0, 0.0)));
        let (r, g, b) = parse_hex_color("#404040").unwrap();
        assert!((r - 0.251).abs() < 0.001 && (g - 0.251).abs() < 0.001 && (b - 0.251).abs() < 0.001);
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

        stamp_page_numbers(path.to_str().unwrap(), "n-of-total", "", 10.0, 10.0).unwrap();

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
            "custom:Sheet {{page}} of {{total}} – Acme",
            "#ff0000",
            10.0,
            10.0,
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

        stamp_page_numbers(path.to_str().unwrap(), "page-n", "", 10.0, 10.0).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(stamped.extract_text(&[1]).unwrap().contains("Page 1"));
        assert!(stamped.extract_text(&[2]).unwrap().contains("Page 2"));
    }

    #[test]
    fn skips_stamping_when_format_is_none() {
        let mut doc = Document::with_version("1.5");
        build_pdf(&mut doc, vec![(vec![], dictionary! {})]);
        let path = save_temp(&mut doc, "scrivon-page-numbers-none.pdf");
        stamp_page_numbers(path.to_str().unwrap(), "none", "", 10.0, 10.0).unwrap();
        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert_eq!(stamped.extract_text(&[1]).unwrap().trim(), "");
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

        stamp_page_numbers(path.to_str().unwrap(), "none", "", 10.0, 10.0).unwrap();

        let stamped = Document::load(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(
            stamped.extract_text(&[1]).unwrap().contains('3'),
            "toc should show the heading's page"
        );
        assert!(!stamped.extract_text(&[2]).unwrap().contains('3'));
    }

    /// Device-space right edge, baseline and flip state of the stamped label on a page.
    fn stamped_label_extent(doc: &Document, page_id: ObjectId, label: &str) -> (f32, f32, bool) {
        let bytes = doc.get_page_content(page_id).unwrap();
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
