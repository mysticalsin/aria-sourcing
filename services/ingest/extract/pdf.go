// Package extract reads a PDF text layer and sniffs upload bytes.
//
// The reader is pure Go (literal strings, hex strings, Tj/TJ, FlateDecode).
// It does not call the network or a paid API. Encrypted files are refused.
// A valid PDF with no text layer returns an empty string so the worker can
// OCR it.
package extract

import (
	"bytes"
	"compress/flate"
	"compress/zlib"
	"errors"
	"fmt"
	"io"
	"strings"
	"unicode"
)

// Kind is the file class the worker branches on. It comes from magic bytes,
// never from the file name (a name can carry a person).
type Kind int

const (
	KindUnknown Kind = iota
	KindPDF
	KindPNG
	KindJPEG
)

// ErrUnreadable means the bytes are not a PDF this reader can trust.
// The error string is a code, not a piece of the file.
var ErrUnreadable = errors.New("unreadable_document")

const maxStream = 2 << 20

// EnoughText reports whether s is a text layer rather than a scrap such as
// "Page 1". Twelve letters distinguishes a CV line from a page number, and
// a scanned page with no text layer still falls through to OCR.
func EnoughText(s string) bool {
	n := 0
	for _, r := range s {
		if unicode.IsLetter(r) {
			n++
			if n >= 12 {
				return true
			}
		}
	}
	return false
}

// Sniff classifies an upload from its prefix.
func Sniff(b []byte) Kind {
	switch {
	case bytes.HasPrefix(b, []byte("%PDF-")):
		return KindPDF
	case bytes.HasPrefix(b, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}):
		return KindPNG
	case bytes.HasPrefix(b, []byte{0xFF, 0xD8, 0xFF}):
		return KindJPEG
	default:
		return KindUnknown
	}
}

// PDF is the default text-layer reader.
type PDF struct{}

// ExtractText implements the worker text-layer port.
func (PDF) ExtractText(data []byte) (string, error) {
	return ExtractText(data)
}

// ExtractText returns the text layer. A structurally valid PDF with no text
// returns ("", nil). Corrupt bytes return ErrUnreadable.
func ExtractText(data []byte) (string, error) {
	if !bytes.HasPrefix(data, []byte("%PDF-")) {
		return "", ErrUnreadable
	}
	if bytes.Contains(data, []byte("/Encrypt")) {
		return "", ErrUnreadable
	}
	if !bytes.Contains(data, []byte(" obj")) {
		return "", ErrUnreadable
	}
	streams, err := contentStreams(data)
	if err != nil {
		return "", ErrUnreadable
	}
	parts := make([]string, 0, len(streams))
	for _, s := range streams {
		parts = append(parts, contentText(string(s)))
	}
	return strings.TrimRight(strings.Join(parts, "\n"), "\r\n"), nil
}

// BuildTextPDF writes a one-page PDF whose text layer is lines, one per
// line. Fixtures and the throughput bench use it. The file is uncompressed
// so a test can also round-trip the compressed form via buildTextPDF.
func BuildTextPDF(lines []string) []byte {
	return buildTextPDF(lines, false)
}

func buildTextPDF(lines []string, compress bool) []byte {
	content := renderContent(lines)
	stream := content
	dict := fmt.Sprintf("<< /Length %d >>", len(stream))
	if compress {
		stream = zlibWrap(content)
		dict = fmt.Sprintf("<< /Length %d /Filter /FlateDecode >>", len(stream))
	}
	return assemblePDF(dict, stream)
}

func assemblePDF(dict string, stream []byte) []byte {
	var buf bytes.Buffer
	buf.WriteString("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n")
	offsets := make([]int, 6)
	writeObj := func(n int, body string) {
		offsets[n] = buf.Len()
		fmt.Fprintf(&buf, "%d 0 obj\n%s\nendobj\n", n, body)
	}
	writeObj(1, "<< /Type /Catalog /Pages 2 0 R >>")
	writeObj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
	writeObj(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>")

	offsets[4] = buf.Len()
	fmt.Fprintf(&buf, "4 0 obj\n%s\nstream\n", dict)
	buf.Write(stream)
	buf.WriteString("\nendstream\nendobj\n")

	writeObj(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

	xref := buf.Len()
	buf.WriteString("xref\n0 6\n")
	fmt.Fprintf(&buf, "%010d %05d f \n", 0, 65535)
	for i := 1; i <= 5; i++ {
		fmt.Fprintf(&buf, "%010d %05d n \n", offsets[i], 0)
	}
	fmt.Fprintf(&buf, "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", xref)
	return buf.Bytes()
}

func renderContent(lines []string) []byte {
	var b strings.Builder
	b.WriteString("BT\n/F1 11 Tf\n72 760 Td\n14 TL\n")
	for i, line := range lines {
		if i > 0 {
			b.WriteString("T*\n")
		}
		b.WriteByte('(')
		b.WriteString(escapeLiteral(line))
		b.WriteString(") Tj\n")
	}
	b.WriteString("ET\n")
	return []byte(b.String())
}

func escapeLiteral(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '\\', '(', ')':
			b.WriteByte('\\')
			b.WriteByte(s[i])
		default:
			if s[i] < 32 || s[i] > 126 {
				fmt.Fprintf(&b, "\\%03o", s[i])
			} else {
				b.WriteByte(s[i])
			}
		}
	}
	return b.String()
}

func zlibWrap(b []byte) []byte {
	var buf bytes.Buffer
	zw := zlib.NewWriter(&buf)
	_, _ = zw.Write(b)
	_ = zw.Close()
	return buf.Bytes()
}

func contentStreams(data []byte) ([][]byte, error) {
	var out [][]byte
	from := 0
	for len(out) < 50 {
		rel := bytes.Index(data[from:], []byte("stream"))
		if rel < 0 {
			break
		}
		abs := from + rel
		if abs > 0 && isWordByte(data[abs-1]) {
			from = abs + len("stream")
			continue
		}
		j := abs
		for j > 0 && isWS(data[j-1]) {
			j--
		}
		if j < 2 || data[j-1] != '>' || data[j-2] != '>' {
			from = abs + len("stream")
			continue
		}
		dictStart := bytes.LastIndex(data[:j-2], []byte("<<"))
		if dictStart < 0 {
			return nil, ErrUnreadable
		}
		dict := data[dictStart:j]
		length, ok := directLength(dict)
		if !ok || length < 0 || length > maxStream {
			return nil, ErrUnreadable
		}
		p := abs + len("stream")
		if p < len(data) && data[p] == '\r' {
			p++
		}
		if p >= len(data) || data[p] != '\n' {
			return nil, ErrUnreadable
		}
		p++
		if p+length > len(data) {
			return nil, ErrUnreadable
		}
		payload := data[p : p+length]
		rest := p + length
		if rest < len(data) && data[rest] == '\r' {
			rest++
		}
		if rest < len(data) && data[rest] == '\n' {
			rest++
		}
		if !bytes.HasPrefix(data[rest:], []byte("endstream")) {
			return nil, ErrUnreadable
		}
		from = rest + len("endstream")

		// Image XObjects are not a text layer. Rasterization handles them.
		if bytes.Contains(dict, []byte("/Subtype")) && bytes.Contains(dict, []byte("/Image")) {
			continue
		}
		if bytes.Contains(dict, []byte("/FlateDecode")) {
			decoded, err := inflate(payload)
			if err != nil {
				if bytes.Contains(dict, []byte("/Image")) {
					continue
				}
				return nil, ErrUnreadable
			}
			payload = decoded
		}
		if looksLikeContent(payload) {
			out = append(out, append([]byte(nil), payload...))
		}
	}
	return out, nil
}

func directLength(dict []byte) (int, bool) {
	key := []byte("/Length")
	i := bytes.Index(dict, key)
	if i < 0 {
		return 0, false
	}
	rest := dict[i+len(key):]
	k := 0
	for k < len(rest) && isWS(rest[k]) {
		k++
	}
	if k >= len(rest) || rest[k] < '0' || rest[k] > '9' {
		return 0, false
	}
	n := 0
	for k < len(rest) && rest[k] >= '0' && rest[k] <= '9' {
		n = n*10 + int(rest[k]-'0')
		k++
	}
	// An indirect reference (/Length 4 0 R) is not a direct length.
	for k < len(rest) && isWS(rest[k]) {
		k++
	}
	if k < len(rest) && rest[k] >= '0' && rest[k] <= '9' {
		return 0, false
	}
	return n, true
}

func looksLikeContent(b []byte) bool {
	return bytes.Contains(b, []byte("Tj")) ||
		bytes.Contains(b, []byte("TJ")) ||
		bytes.Contains(b, []byte("T*")) ||
		bytes.Contains(b, []byte("BT"))
}

func inflate(b []byte) ([]byte, error) {
	if out, err := inflateReader(func() (io.ReadCloser, error) {
		return zlib.NewReader(bytes.NewReader(b))
	}); err == nil {
		return out, nil
	}
	return inflateReader(func() (io.ReadCloser, error) {
		return flate.NewReader(bytes.NewReader(b)), nil
	})
}

func inflateReader(open func() (io.ReadCloser, error)) ([]byte, error) {
	r, err := open()
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out, err := io.ReadAll(io.LimitReader(r, maxStream+1))
	if err != nil || len(out) > maxStream {
		return nil, ErrUnreadable
	}
	return out, nil
}

func isWS(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\f'
}

func isWordByte(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

type piece struct {
	text  string
	space bool
}

func contentText(s string) string {
	var lines []string
	var cur strings.Builder
	flush := func() {
		lines = append(lines, strings.TrimRight(cur.String(), " "))
		cur.Reset()
	}
	show := func(text string) { cur.WriteString(text) }

	i := 0
	for i < len(s) {
		i = skipWS(s, i)
		if i >= len(s) {
			break
		}
		switch s[i] {
		case '%':
			for i < len(s) && s[i] != '\n' {
				i++
			}
		case '(':
			lit, next := parseLiteral(s, i)
			op, after := peekOp(s, next)
			if op == "'" || op == "\"" {
				flush()
			}
			if op == "Tj" || op == "TJ" || op == "'" || op == "\"" {
				show(lit)
				i = after
				continue
			}
			i = next
		case '<':
			if i+1 < len(s) && s[i+1] == '<' {
				i = skipDict(s, i)
				continue
			}
			lit, next := parseHex(s, i)
			op, after := peekOp(s, next)
			if op == "'" || op == "\"" {
				flush()
			}
			if op == "Tj" || op == "'" || op == "\"" {
				show(lit)
				i = after
				continue
			}
			i = next
		case '[':
			parts, next := parseArray(s, i)
			op, after := peekOp(s, next)
			if op == "TJ" {
				for _, p := range parts {
					if p.space {
						cur.WriteByte(' ')
					} else {
						cur.WriteString(p.text)
					}
				}
				i = after
				continue
			}
			i = next
		default:
			op, after := readToken(s, i)
			if op == "T*" || op == "'" {
				flush()
			}
			i = after
		}
	}
	if cur.Len() > 0 {
		lines = append(lines, cur.String())
	}
	return strings.Join(lines, "\n")
}

func skipWS(s string, i int) int {
	for i < len(s) && isWS(s[i]) {
		i++
	}
	return i
}

func skipDict(s string, i int) int {
	// i points at the first '<'. Nested dicts are not expected in a content
	// stream; skip to the matching ">>".
	depth := 0
	for i+1 < len(s) {
		if s[i] == '<' && s[i+1] == '<' {
			depth++
			i += 2
			continue
		}
		if s[i] == '>' && s[i+1] == '>' {
			depth--
			i += 2
			if depth == 0 {
				return i
			}
			continue
		}
		i++
	}
	return len(s)
}

func peekOp(s string, i int) (string, int) {
	i = skipWS(s, i)
	if i >= len(s) {
		return "", i
	}
	if s[i] == '\'' || s[i] == '"' {
		return string(s[i]), i + 1
	}
	if !isOpStart(s[i]) {
		return "", i
	}
	j := i + 1
	for j < len(s) && isOpCont(s[j]) {
		j++
	}
	return s[i:j], j
}

func readToken(s string, i int) (string, int) {
	if i < len(s) && (s[i] == '\'' || s[i] == '"') {
		return string(s[i]), i + 1
	}
	j := i
	if j < len(s) && s[j] == '/' {
		j++
	}
	for j < len(s) && !isWS(s[j]) && s[j] != '(' && s[j] != '<' && s[j] != '[' && s[j] != ']' {
		j++
	}
	if j == i {
		return "", i + 1
	}
	return s[i:j], j
}

func isOpStart(b byte) bool {
	return (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z')
}

func isOpCont(b byte) bool {
	return isOpStart(b) || b == '*'
}

func parseLiteral(s string, i int) (string, int) {
	// i points at '('.
	var b strings.Builder
	depth := 0
	i++
	for i < len(s) {
		c := s[i]
		if c == '\\' && i+1 < len(s) {
			n := s[i+1]
			switch n {
			case 'n':
				b.WriteByte('\n')
				i += 2
			case 'r':
				b.WriteByte('\r')
				i += 2
			case 't':
				b.WriteByte('\t')
				i += 2
			case 'b':
				b.WriteByte('\b')
				i += 2
			case 'f':
				b.WriteByte('\f')
				i += 2
			case '(', ')', '\\':
				b.WriteByte(n)
				i += 2
			case '\n':
				i += 2
			case '\r':
				i += 2
				if i < len(s) && s[i] == '\n' {
					i++
				}
			default:
				if n >= '0' && n <= '7' {
					oct := 0
					k := 0
					for k < 3 && i+1+k < len(s) && s[i+1+k] >= '0' && s[i+1+k] <= '7' {
						oct = oct*8 + int(s[i+1+k]-'0')
						k++
					}
					b.WriteByte(byte(oct))
					i += 1 + k
				} else {
					b.WriteByte(n)
					i += 2
				}
			}
			continue
		}
		if c == '(' {
			depth++
			b.WriteByte(c)
			i++
			continue
		}
		if c == ')' {
			if depth == 0 {
				return b.String(), i + 1
			}
			depth--
			b.WriteByte(c)
			i++
			continue
		}
		b.WriteByte(c)
		i++
	}
	return b.String(), i
}

func parseHex(s string, i int) (string, int) {
	i++ // skip '<'
	var hexdigits []byte
	for i < len(s) && s[i] != '>' {
		c := s[i]
		if !isWS(c) {
			hexdigits = append(hexdigits, c)
		}
		i++
	}
	if i < len(s) && s[i] == '>' {
		i++
	}
	if len(hexdigits)%2 == 1 {
		hexdigits = append(hexdigits, '0')
	}
	out := make([]byte, 0, len(hexdigits)/2)
	for k := 0; k+1 < len(hexdigits); k += 2 {
		hi, ok1 := fromHex(hexdigits[k])
		lo, ok2 := fromHex(hexdigits[k+1])
		if !ok1 || !ok2 {
			continue
		}
		out = append(out, hi<<4|lo)
	}
	return string(out), i
}

func fromHex(b byte) (byte, bool) {
	switch {
	case b >= '0' && b <= '9':
		return b - '0', true
	case b >= 'a' && b <= 'f':
		return b - 'a' + 10, true
	case b >= 'A' && b <= 'F':
		return b - 'A' + 10, true
	default:
		return 0, false
	}
}

func parseArray(s string, i int) ([]piece, int) {
	// i points at '['.
	i++
	var parts []piece
	pendingSpace := false
	for i < len(s) && s[i] != ']' {
		i = skipWS(s, i)
		if i >= len(s) || s[i] == ']' {
			break
		}
		switch s[i] {
		case '(':
			lit, next := parseLiteral(s, i)
			if pendingSpace {
				parts = append(parts, piece{space: true})
				pendingSpace = false
			}
			parts = append(parts, piece{text: lit})
			i = next
		case '<':
			lit, next := parseHex(s, i)
			if pendingSpace {
				parts = append(parts, piece{space: true})
				pendingSpace = false
			}
			parts = append(parts, piece{text: lit})
			i = next
		default:
			tok, next := readToken(s, i)
			if tok != "" && (tok[0] == '-' || (tok[0] >= '0' && tok[0] <= '9')) {
				if adjustment(tok) <= -80 {
					pendingSpace = true
				}
			}
			i = next
		}
	}
	if i < len(s) && s[i] == ']' {
		i++
	}
	return parts, i
}

func adjustment(tok string) int {
	n := 0
	sign := 1
	k := 0
	if tok[0] == '-' {
		sign = -1
		k++
	}
	for ; k < len(tok); k++ {
		if tok[k] < '0' || tok[k] > '9' {
			break
		}
		n = n*10 + int(tok[k]-'0')
	}
	return sign * n
}
