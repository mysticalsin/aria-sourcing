package extract

import (
	"bytes"
	"strconv"
	"unicode"
)

// Raster and page caps applied before pdftoppm runs. DPI is ours, not the
// PDF's: a file cannot ask for a higher resolution. The longest side of a
// rendered page is MaxRasterSide pixels, so the pixel count stays at or
// under MaxRasterSide squared. A MediaBox edge longer than MaxPagePoints
// (20 inches) is refused before Poppler is started.
const (
	RasterDPI        = 150
	MaxRasterSide    = 2200
	MaxPagePoints    = 1440
	MaxRenderedBytes = 8 << 20
)

// MaxRasterPixels is the pixel budget for one page or one uploaded image.
const MaxRasterPixels = MaxRasterSide * MaxRasterSide

// ErrPageTooLarge means the PDF page box or a rendered image exceeds the cap.
// The error string is a code, not a piece of the file.
var ErrPageTooLarge = errPageTooLarge{}

type errPageTooLarge struct{}

func (errPageTooLarge) Error() string { return "page_too_large" }

// PageTooLarge reports whether any page box is larger than MaxPagePoints
// on either edge, after that page's UserUnit. A file with no page box is
// not large; the raster step still scales into MaxRasterSide.
func PageTooLarge(pdf []byte) bool {
	limit := float64(MaxPagePoints)
	for _, key := range [][]byte{[]byte("/MediaBox"), []byte("/CropBox"), []byte("/BleedBox")} {
		from := 0
		for {
			rel := bytes.Index(pdf[from:], key)
			if rel < 0 {
				break
			}
			at := from + rel
			from = at + len(key)
			nums, ok := boxNumbers(pdf[from:])
			if !ok {
				continue
			}
			w := nums[2] - nums[0]
			h := nums[3] - nums[1]
			if w < 0 {
				w = -w
			}
			if h < 0 {
				h = -h
			}
			scale := userUnitInObject(pdf, at)
			if w*scale > limit || h*scale > limit {
				return true
			}
		}
	}
	return false
}

// userUnitInObject reads /UserUnit from the PDF object that contains at.
// The default scale is 1. A missing or unusable value stays 1.
func userUnitInObject(pdf []byte, at int) float64 {
	start := 0
	if i := bytes.LastIndex(pdf[:at], []byte("obj")); i >= 0 {
		start = i
	}
	end := len(pdf)
	if i := bytes.Index(pdf[at:], []byte("endobj")); i >= 0 {
		end = at + i
	}
	chunk := pdf[start:end]
	key := []byte("/UserUnit")
	k := bytes.Index(chunk, key)
	if k < 0 {
		return 1
	}
	rest := chunk[k+len(key):]
	i := 0
	for i < len(rest) && (rest[i] == ' ' || rest[i] == '\t' || rest[i] == '\n' || rest[i] == '\r') {
		i++
	}
	s := i
	for i < len(rest) && (rest[i] == '+' || rest[i] == '-' || rest[i] == '.' || (rest[i] >= '0' && rest[i] <= '9')) {
		i++
	}
	if s == i {
		return 1
	}
	v, err := strconv.ParseFloat(string(rest[s:i]), 64)
	if err != nil || v <= 0 || v > 1e6 {
		return 1
	}
	return v
}

func boxNumbers(s []byte) ([4]float64, bool) {
	var out [4]float64
	i := 0
	for i < len(s) && unicode.IsSpace(rune(s[i])) {
		i++
	}
	if i < len(s) && s[i] == '[' {
		i++
	}
	for n := 0; n < 4; n++ {
		for i < len(s) && (unicode.IsSpace(rune(s[i])) || s[i] == ',') {
			i++
		}
		start := i
		for i < len(s) && (s[i] == '+' || s[i] == '-' || s[i] == '.' || (s[i] >= '0' && s[i] <= '9')) {
			i++
		}
		if start == i {
			return out, false
		}
		v, err := strconv.ParseFloat(string(s[start:i]), 64)
		if err != nil {
			return out, false
		}
		out[n] = v
	}
	return out, true
}

// PixelsOK is the shared pixel budget for a rendered page and an uploaded image.
func PixelsOK(w, h int) bool {
	if w <= 0 || h <= 0 {
		return false
	}
	if w > MaxRasterSide || h > MaxRasterSide {
		return false
	}
	if w*h > MaxRasterPixels {
		return false
	}
	return true
}
